import Path from 'path';

import type { BulkUpdate, MediaResolution, PlaylistEntryUpdate, SubsetConstraints, UpdateMedia } from '@vimtur/common';
import type { Response } from 'express';
import { Router } from 'express';
import PathIsInside from 'path-is-inside';
import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import Config from '../config';
import { BadRequest, NotFound } from '../errors';
import { wrap } from '../express-async';
import type { Database } from '../types';
import { asError, deleteCache, deleteMedia, singleParam } from '../utils';
import { Validator } from '../utils/validator';

const SUBSET_VALIDATOR = Validator.load('SubsetConstraints');
const BULK_UPDATE_VALIDATOR = Validator.load('BulkUpdate');
const MEDIA_UPDATE_VALIDATOR = Validator.load('UpdateMedia');
const RESOLUTION_VALIDATOR = Validator.load('MediaResolution');
const PLAYLIST_ENTRY_UPDATE_VALIDATOR = Validator.load('PlaylistEntryUpdate');

// The UpdateMedia schema is all-optional, so an update can pass schema
// validation while carrying nothing writable (e.g. an empty `metadata`
// object — its sub-fields are what actually get persisted). Arrays and nulls
// count as writable because clearing a field is a real update; nested plain
// objects only count when they contain something writable themselves.
function hasWritableUpdate(value: unknown): boolean {
  if (Array.isArray(value) || value === null) {
    return true;
  }
  if (typeof value !== 'object') {
    return true;
  }
  return Object.values(value).some((child) => hasWritableUpdate(child));
}

// Streaming endpoints write the response body directly, so errors are only reportable
// before the first byte is sent. After that the connection can only be ended early.
function respondStreamError(res: Response, status: number, message: string): void {
  if (!res.headersSent) {
    // The stream routes set a video/mp2t content type before streaming, which
    // express's res.json() would keep for an error body. Force the JSON
    // content type so error responses are parseable by clients.
    res.set('Content-Type', 'application/json');
    res.status(status).json({ message });
  } else {
    res.end();
  }
}

export function create(db: Database): Router {
  const router = Router();

  const transcoder = new Transcoder(db);

  // The bodies mirror this helper's (SUBSET_VALIDATOR's) generated schema; the
  // calls cast the free-form JSON body over to it.
  const parseSubsetBody = (body: SubsetConstraints): SubsetConstraints => {
    const result = SUBSET_VALIDATOR.validate(body);
    if (!result.success) {
      throw new BadRequest(result.errorText!);
    }

    const constraints: SubsetConstraints = body;
    constraints.corrupted = false;
    constraints.indexed = true;
    constraints.duplicateOf = { exists: false };

    return constraints;
  };

  router.post(
    '/subset',
    wrap(async ({ req }) => {
      const constraints = parseSubsetBody(req.body as SubsetConstraints);

      console.log('Search request.', constraints);
      return {
        data: await db.subset(constraints),
      };
    }),
  );

  router.put(
    '/subset/playlists/:playlistId',
    wrap(async ({ req }) => {
      const playlistId = singleParam(req.params.playlistId);
      const playlist = await db.getPlaylist(playlistId);
      if (!playlist) {
        throw new NotFound(`No playlist found with id: ${playlistId}`);
      }

      const constraints = parseSubsetBody(req.body as SubsetConstraints);
      const subset = await db.subset(constraints);

      // Do sequentially to preserve sort order
      for (const hash of subset) {
        await db.addMediaToPlaylist(hash, playlistId);
      }
    }),
  );

  router.delete(
    '/subset/playlists/:playlistId',
    wrap(async ({ req }) => {
      const constraints = parseSubsetBody(req.body as SubsetConstraints);
      const subset = await db.subset(constraints);

      await execute(
        subset,
        async (hash) => {
          await db.removeMediaFromPlaylist(hash, singleParam(req.params.playlistId));
        },
        { parallel: 8 },
      );
    }),
  );

  router.patch(
    '/bulk-update',
    wrap(async ({ req }) => {
      // The update is given in both directions by the generated schema, so the
      // cast body mirrors BULK_UPDATE_VALIDATOR's schema.
      const body = req.body as BulkUpdate;
      const result = BULK_UPDATE_VALIDATOR.validate(body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      const request: BulkUpdate = body;
      if (!hasWritableUpdate(request.update)) {
        throw new BadRequest('No fields to update');
      }
      request.constraints.corrupted = false;
      request.constraints.indexed = true;

      console.log('Bulk update', request);
      return {
        data: await db.saveBulkMedia(request.constraints, request.update),
      };
    }),
  );

  router.get(
    '/:hash',
    wrap(async ({ req }) => {
      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        throw new NotFound(`No media found with hash: ${singleParam(req.params.hash)}`);
      }
      return {
        data: media,
      };
    }),
  );

  router.delete(
    '/:hash',
    wrap(async ({ req }) => {
      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        throw new NotFound(`No media found with hash: ${singleParam(req.params.hash)}`);
      }
      await deleteMedia(media);
      await db.removeMedia(singleParam(req.params.hash), true);
    }),
  );

  router.patch(
    '/:hash',
    wrap(async ({ req }) => {
      const hash = singleParam(req.params.hash);
      const media = await db.getMedia(hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${hash}`);
      }

      // The body mirrors the generated MEDIA_UPDATE_VALIDATOR schema (UpdateMedia).
      const body = req.body as UpdateMedia;
      const result = MEDIA_UPDATE_VALIDATOR.validate(body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }
      // An update that carries nothing writable would reach the connector as
      // an empty change set (a raw SQL error on SQLite, an empty $set on
      // MongoDB); reject it here where the request is still known.
      if (!hasWritableUpdate(body)) {
        throw new BadRequest('No fields to update');
      }

      return {
        data: await db.saveMedia(hash, body),
      };
    }),
  );

  router.put(
    '/:hash/playlists/:playlistId',
    wrap(async ({ req }) => {
      const hash = singleParam(req.params.hash);
      const playlistId = singleParam(req.params.playlistId);
      const media = await db.getMedia(hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${hash}`);
      }
      const playlist = await db.getPlaylist(playlistId);
      if (!playlist) {
        throw new NotFound(`No playlist found with id: ${playlistId}`);
      }

      return {
        data: await db.addMediaToPlaylist(hash, playlistId),
      };
    }),
  );

  router.patch(
    '/:hash/playlists/:playlistId',
    wrap(async ({ req }) => {
      // The body mirrors the generated PLAYLIST_ENTRY_UPDATE_VALIDATOR schema.
      const body = req.body as PlaylistEntryUpdate;
      const result = PLAYLIST_ENTRY_UPDATE_VALIDATOR.validate(body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      await db.updateMediaPlaylistOrder(singleParam(req.params.hash), singleParam(req.params.playlistId), body);
    }),
  );

  router.delete(
    '/:hash/playlists/:playlistId',
    wrap(async ({ req }) => {
      await db.removeMediaFromPlaylist(singleParam(req.params.hash), singleParam(req.params.playlistId));
    }),
  );

  router.post(
    '/:hash/tags',
    wrap(async ({ req }) => {
      // The request body is free-form JSON with the tag under `name`.
      const { name } = req.body as { name?: string };
      if (typeof name !== 'string') {
        throw new BadRequest('name not specified');
      }

      const hash = singleParam(req.params.hash);
      const media = await db.getMedia(hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${hash}`);
      }

      if (!(await db.hasTag(name))) {
        throw new NotFound(`No tag found with name: ${name}`);
      }

      await db.addMediaTag(hash, name);
    }),
  );

  router.delete(
    '/:hash/tags/:name',
    wrap(async ({ req }) => {
      await db.removeMediaTag(singleParam(req.params.hash), singleParam(req.params.name));
    }),
  );

  router.post(
    '/:hash/actors',
    wrap(async ({ req }) => {
      // The request body is free-form JSON with the actor under `name`.
      const { name } = req.body as { name?: string };
      if (typeof name !== 'string') {
        throw new BadRequest('name not specified');
      }

      const hash = singleParam(req.params.hash);
      const media = await db.getMedia(hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${hash}`);
      }

      if (!(await db.hasActor(name))) {
        throw new NotFound(`No actor found with name: ${name}`);
      }

      await db.addMediaActor(hash, name);
    }),
  );

  router.delete(
    '/:hash/actors/:name',
    wrap(async ({ req }) => {
      await db.removeMediaActor(singleParam(req.params.hash), singleParam(req.params.name));
    }),
  );

  router.get(
    '/:hash/file',
    wrap(async ({ req, res }) => {
      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        return res.status(404).json({
          message: `No media found with hash: ${singleParam(req.params.hash)}`,
        });
      }

      if (req.query.download) {
        const filename = media.path.split('/').pop();
        res.set('Content-Disposition', `attachment; filename="${filename}"`);
      }

      try {
        const absPath = Path.resolve(Config.get().libraryPath, media.path);
        if (media.type === 'gif' || media.type === 'still') {
          const maxWidth = req.query.maxWidth ? Number(req.query.maxWidth) : undefined;
          const resize = maxWidth && media.metadata && media.metadata.width > maxWidth;
          const manipulate = resize || (await ImportUtils.isExifRotated(absPath));
          if (manipulate) {
            const scale =
              resize && media.metadata && maxWidth
                ? {
                    width: maxWidth,
                    height: (media.metadata.height / media.metadata.width) * maxWidth,
                  }
                : undefined;
            try {
              ImportUtils.loadImageAutoOrient(absPath, res, scale);
              return;
            } catch (err) {
              console.error('Failed to send rotated image', absPath, err);
            }
          }
        }
        return res.sendFile(absPath);
      } catch (errUnknown: unknown) {
        const err = asError(errUnknown);
        console.error('Error reading file', err);
        return res.status(503).json({ message: err.message });
      }
    }, false),
  );

  router.post(
    '/:hash/resolve',
    wrap(async ({ req }) => {
      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        throw new NotFound(`No media found with hash: ${singleParam(req.params.hash)}`);
      }

      if (!media.clones) {
        throw new BadRequest('Media has no clones');
      }

      // The body mirrors the generated RESOLUTION_VALIDATOR schema.
      const request = req.body as MediaResolution;
      const result = RESOLUTION_VALIDATOR.validate(request);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      // Verify that aliases + unrelated contains everything in clones.
      const allRequested = [...request.aliases, ...request.unrelated];
      // If we can find a clone that isn't in the request body...
      if (media.clones.find((c) => !allRequested.includes(c))) {
        throw new BadRequest('Resolver body does not resolve all clones');
      }

      for (const hash of request.aliases) {
        // For each alias set duplicateOf to this media, mark the cache as not cached
        // and delete the cache for it.
        await deleteCache(hash);

        // In some cases this may replace an image that already has duplicates.
        // So for each of the aliases update any media the have duplicateOf pointing
        // as the alias to this media.
        await db.saveBulkMedia({ duplicateOf: { equalsAll: [hash] } }, { duplicateOf: media.hash });

        // Update the clone to mark it as a duplicate.
        await db.saveMedia(hash, { duplicateOf: media.hash });
      }

      // Update the media to set clones to undefined and add unrelated to unrelated.
      await db.saveMedia(media.hash, { clones: [], unrelated: request.unrelated });
    }),
  );

  router.get(
    '/:hash/stream/index.m3u8',
    wrap(async ({ req, res }) => {
      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        throw new NotFound('media not found');
      }
      if (media.type !== 'video') {
        throw new BadRequest('Cannot stream non-video media');
      }

      const masterPlaylist = ImportUtils.generateStreamMasterPlaylist(media);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(Buffer.from(masterPlaylist));
    }, false),
  );

  router.get(
    '/:hash/stream/:quality/index.m3u8',
    wrap(async ({ req, res }) => {
      const quality = Number(req.params.quality);
      if (isNaN(quality)) {
        throw new BadRequest('quality must be a number');
      }

      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        throw new NotFound('media not found');
      }
      if (media.type !== 'video') {
        throw new BadRequest('Cannot stream non-video media');
      }

      const playlist = await transcoder.getStreamPlaylist(media, quality);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(Buffer.from(playlist));
    }, false),
  );

  router.get(
    '/:hash/stream/:quality/:file',
    wrap(async ({ req, res }) => {
      const file = singleParam(req.params.file);
      const quality = Number(req.params.quality);
      if (isNaN(quality)) {
        throw new BadRequest('quality must be a number');
      }

      const media = await db.getMedia(singleParam(req.params.hash));
      if (!media) {
        throw new NotFound('media not found');
      }
      if (media.type !== 'video') {
        throw new BadRequest('Cannot stream non-video media');
      }

      // data.ts is the newer cache/streaming method.
      if (file === 'data.ts') {
        const start = Number(req.query.start);
        const end = Number(req.query.end);

        if (isNaN(start) || isNaN(end)) {
          throw new BadRequest('start and end must be set to numbers');
        }

        // This is the new cache method.
        if (media.metadata?.qualityCache?.includes(quality)) {
          const absPath = `${Config.get().cachePath}/${media.hash}/${quality}p/data.ts?start=${start}&end=${end}`;

          res.set('Cache-Control', 'public, max-age=604800, immutable');
          res.set('Content-Type', 'video/mp2t');

          // Callback so a file deleted from the cache mid-send doesn't fall through to
          // express returning a HTML error page.
          res.sendFile(absPath, (sendErr?: Error) => {
            if (!sendErr) {
              return;
            }
            console.error('Failed to send cached segment', absPath, sendErr);
            respondStreamError(res, 404, `Failed to send segment: ${sendErr.message}`);
          });
        } else {
          // On-demand transcodes may be truncated if the transcode fails, so they aren't cached
          // by the browser. hls.js caches the fragments it has loaded for the session anyway.
          res.set('Cache-Control', 'no-store');
          res.set('Content-Type', 'video/mp2t');

          transcoder.streamMedia(media, start, end, res, quality, true).catch((err) => {
            console.error('Error streaming media', err);
            respondStreamError(res, 503, err instanceof Error ? err.message : 'Failed to stream media');
          });
        }
      } else {
        // This is support for the old cache method.
        if (!file.startsWith('index') || !file.endsWith('.ts')) {
          throw new BadRequest('Invalid filename to fetch from cache');
        }
        const absPath = Path.resolve(Config.get().cachePath, singleParam(req.params.hash), `${quality}p`, file);
        if (!PathIsInside(absPath, Path.resolve(Config.get().cachePath))) {
          throw new BadRequest('Requested file not inside cache');
        }
        res.sendFile(absPath);
      }
    }, false),
  );

  return router;
}
