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
import type { Database } from '../types';
import { asError, deleteCache, deleteMedia, singleParam } from '../utils';
import { Validator } from '../utils/validator';

const SUBSET_VALIDATOR = Validator.load<SubsetConstraints>('SubsetConstraints');
const BULK_UPDATE_VALIDATOR = Validator.load<BulkUpdate>('BulkUpdate');
const MEDIA_UPDATE_VALIDATOR = Validator.load<UpdateMedia>('UpdateMedia');
const RESOLUTION_VALIDATOR = Validator.load<MediaResolution>('MediaResolution');
const PLAYLIST_ENTRY_UPDATE_VALIDATOR = Validator.load<PlaylistEntryUpdate>('PlaylistEntryUpdate');

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
// This deliberately coexists with the central error middleware
// (middleware/error-handler.ts): middleware-level errors delegate to
// next(err) once headers are sent, which ends the whole response, while a
// stream that failed mid-body can only end its own truncated body here.
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

  // The bodies come in as free-form parsed JSON; validate() takes unknown and
  // SUBSET_VALIDATOR's schema claims the shape. It needs to stay in sync with
  // SubsetConstraints.
  function parseSubsetBody(body: unknown): SubsetConstraints {
    const constraints = SUBSET_VALIDATOR.validate(body);
    constraints.corrupted = false;
    constraints.indexed = true;
    constraints.duplicateOf = { exists: false };

    return constraints;
  }

  router.post('/subset', async (req, res) => {
    const constraints = parseSubsetBody(req.body);

    console.log('Search request.', constraints);
    res.status(200).json(await db.subset(constraints));
  });

  router.put('/subset/playlists/:playlistId', async (req, res) => {
    const playlistId = singleParam(req.params.playlistId);
    const playlist = await db.getPlaylist(playlistId);
    if (!playlist) {
      throw new NotFound(`No playlist found with id: ${playlistId}`);
    }

    const constraints = parseSubsetBody(req.body);
    const subset = await db.subset(constraints);

    // Do sequentially to preserve sort order
    for (const hash of subset) {
      await db.addMediaToPlaylist(hash, playlistId);
    }
    res.sendStatus(204);
  });

  router.delete('/subset/playlists/:playlistId', async (req, res) => {
    const constraints = parseSubsetBody(req.body);
    const subset = await db.subset(constraints);

    await execute(
      subset,
      async (hash) => {
        await db.removeMediaFromPlaylist(hash, singleParam(req.params.playlistId));
      },
      { parallel: 8 },
    );
    res.sendStatus(204);
  });

  router.patch('/bulk-update', async (req, res) => {
    const request = BULK_UPDATE_VALIDATOR.validate(req.body);
    if (!hasWritableUpdate(request.update)) {
      throw new BadRequest('No fields to update');
    }
    request.constraints.corrupted = false;
    request.constraints.indexed = true;

    console.log('Bulk update', request);
    res.status(200).json(await db.saveBulkMedia(request.constraints, request.update));
  });

  router.get('/:hash', async (req, res) => {
    const hash = singleParam(req.params.hash);
    const media = await db.getMedia(hash);
    if (!media) {
      throw new NotFound(`No media found with hash: ${hash}`);
    }
    res.status(200).json(media);
  });

  router.delete('/:hash', async (req, res) => {
    const hash = singleParam(req.params.hash);
    const media = await db.getMedia(hash);
    if (!media) {
      throw new NotFound(`No media found with hash: ${hash}`);
    }
    await deleteMedia(media);
    await db.removeMedia(hash, true);
    res.sendStatus(204);
  });

  router.patch('/:hash', async (req, res) => {
    const hash = singleParam(req.params.hash);
    const media = await db.getMedia(hash);
    if (!media) {
      throw new NotFound(`No media found with hash: ${hash}`);
    }

    const update = MEDIA_UPDATE_VALIDATOR.validate(req.body);
    // An update that carries nothing writable would reach the connector as
    // an empty change set (a raw SQL error on SQLite, an empty $set on
    // MongoDB); reject it here where the request is still known.
    if (!hasWritableUpdate(update)) {
      throw new BadRequest('No fields to update');
    }

    res.status(200).json(await db.saveMedia(hash, update));
  });

  router.put('/:hash/playlists/:playlistId', async (req, res) => {
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

    // Returns the playlist entry: the client parses this response into
    // mediaService.addPlaylist (and the PUT is an idempotent add, so the
    // repeat case cannot claim 201).
    res.status(200).json(await db.addMediaToPlaylist(hash, playlistId));
  });

  router.patch('/:hash/playlists/:playlistId', async (req, res) => {
    const update = PLAYLIST_ENTRY_UPDATE_VALIDATOR.validate(req.body);
    await db.updateMediaPlaylistOrder(singleParam(req.params.hash), singleParam(req.params.playlistId), update);
    res.sendStatus(204);
  });

  router.delete('/:hash/playlists/:playlistId', async (req, res) => {
    await db.removeMediaFromPlaylist(singleParam(req.params.hash), singleParam(req.params.playlistId));
    res.sendStatus(204);
  });

  router.post('/:hash/tags', async (req, res) => {
    // The request body is free-form JSON with the tag under `name`.
    const { name } = req.body as { name?: unknown };
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
    res.sendStatus(204);
  });

  router.delete('/:hash/tags/:name', async (req, res) => {
    await db.removeMediaTag(singleParam(req.params.hash), singleParam(req.params.name));
    res.sendStatus(204);
  });

  router.post('/:hash/actors', async (req, res) => {
    // The request body is free-form JSON with the actor under `name`.
    const { name } = req.body as { name?: unknown };
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
    res.sendStatus(204);
  });

  router.delete('/:hash/actors/:name', async (req, res) => {
    await db.removeMediaActor(singleParam(req.params.hash), singleParam(req.params.name));
    res.sendStatus(204);
  });

  router.get('/:hash/file', async (req, res) => {
    const media = await db.getMedia(singleParam(req.params.hash));
    if (!media) {
      throw new NotFound(`No media found with hash: ${singleParam(req.params.hash)}`);
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
      res.sendFile(absPath);
    } catch (errUnknown: unknown) {
      // The image manipulation path can throw before the response starts;
      // anything after that is stream-capable file sending, whose failures
      // are handled by express on the response itself.
      const err = asError(errUnknown);
      console.error('Error reading file', err);
      // Same reasoning as the stream routes: the status is only changeable
      // before the first byte, and respondStreamError handles both cases.
      respondStreamError(res, 503, err.message);
    }
  });

  router.post('/:hash/resolve', async (req, res) => {
    const media = await db.getMedia(singleParam(req.params.hash));
    if (!media) {
      throw new NotFound(`No media found with hash: ${singleParam(req.params.hash)}`);
    }

    if (!media.clones) {
      throw new BadRequest('Media has no clones');
    }

    const resolution = RESOLUTION_VALIDATOR.validate(req.body);

    // Verify that aliases + unrelated contains everything in clones.
    const allRequested = [...resolution.aliases, ...resolution.unrelated];
    // If we can find a clone that isn't in the request body...
    if (media.clones.find((c) => !allRequested.includes(c))) {
      throw new BadRequest('Resolver body does not resolve all clones');
    }

    for (const hash of resolution.aliases) {
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
    await db.saveMedia(media.hash, { clones: [], unrelated: resolution.unrelated });
    res.sendStatus(204);
  });

  router.get('/:hash/stream/index.m3u8', async (req, res) => {
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
  });

  router.get('/:hash/stream/:quality/index.m3u8', async (req, res) => {
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
  });

  router.get('/:hash/stream/:quality/:file', async (req, res) => {
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
  });

  return router;
}
