import { Request, Response, Router } from 'express';
import { execute } from 'proper-job';
import Path from 'path';
import PathIsInside from 'path-is-inside';

import { BadRequest, NotFound } from '../errors';
import { BulkUpdate, Database, MediaResolution, SubsetConstraints } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import { Validator } from '../utils/validator';
import { deleteCache, deleteMedia } from '../utils';
import { wrap } from '../express-async';
import Config from '../config';

const SUBSET_VALIDATOR = Validator.load('SubsetConstraints');
const BULK_UPDATE_VALIDATOR = Validator.load('BulkUpdate');
const MEDIA_UPDATE_VALIDATOR = Validator.load('UpdateMedia');
const RESOLUTION_VALIDATOR = Validator.load('MediaResolution');
const PLAYLIST_ENTRY_UPDATE_VALIDATOR = Validator.load('PlaylistEntryUpdate');

export async function create(db: Database): Promise<Router> {
  const router = Router();

  const transcoder = new Transcoder(db);

  const parseSubsetBody = (body: object): SubsetConstraints => {
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
      const constraints = parseSubsetBody(req.body);

      console.log('Search request.', constraints);
      return {
        data: await db.subset(constraints),
      };
    }),
  );

  router.put(
    '/subset/playlists/:playlistId',
    wrap(async ({ req }) => {
      const constraints = parseSubsetBody(req.body);
      const subset = await db.subset(constraints);

      // Do sequentially to preserve sort order
      for (const hash of subset) {
        await db.addMediaToPlaylist(hash, req.params.playlistId);
      }
    }),
  );

  router.delete(
    '/subset/playlists/:playlistId',
    wrap(async ({ req }) => {
      const constraints = parseSubsetBody(req.body);
      const subset = await db.subset(constraints);

      await execute(
        subset,
        async hash => {
          await db.removeMediaFromPlaylist(hash, req.params.playlistId);
        },
        { parallel: 8 },
      );
    }),
  );

  router.patch(
    '/bulk-update',
    wrap(async ({ req }) => {
      const result = BULK_UPDATE_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      const request: BulkUpdate = req.body;
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
      const media = await db.getMedia(req.params.hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${req.params.hash}`);
      }
      return {
        data: media,
      };
    }),
  );

  router.delete(
    '/:hash',
    wrap(async ({ req }) => {
      const media = await db.getMedia(req.params.hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${req.params.hash}`);
      }
      await deleteMedia(media);
      await db.removeMedia(req.params.hash);
    }),
  );

  router.patch(
    '/:hash',
    wrap(async ({ req }) => {
      const result = MEDIA_UPDATE_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      return {
        data: await db.saveMedia(req.params.hash, req.body),
      };
    }),
  );

  router.put(
    '/:hash/playlists/:playlistId',
    wrap(async ({ req }) => {
      return {
        data: await db.addMediaToPlaylist(req.params.hash, req.params.playlistId),
      };
    }),
  );

  router.patch(
    '/:hash/playlists/:playlistId',
    wrap(async ({ req }) => {
      const result = PLAYLIST_ENTRY_UPDATE_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      await db.updateMediaPlaylistOrder(req.params.hash, req.params.playlistId, req.body);
    }),
  );

  router.delete(
    '/:hash/playlists/:playlistId',
    wrap(async ({ req }) => {
      await db.removeMediaFromPlaylist(req.params.hash, req.params.playlistId);
    }),
  );

  router.post(
    '/:hash/tags',
    wrap(async ({ req }) => {
      if (typeof req.body.name !== 'string') {
        throw new BadRequest('name not specified');
      }
      await db.addMediaTag(req.params.hash, req.body.name);
    }),
  );

  router.delete(
    '/:hash/tags/:name',
    wrap(async ({ req }) => {
      await db.removeMediaTag(req.params.hash, req.params.name);
    }),
  );

  router.post(
    '/:hash/actors',
    wrap(async ({ req }) => {
      if (typeof req.body.name !== 'string') {
        throw new BadRequest('name not specified');
      }
      await db.addMediaActor(req.params.hash, req.body.name);
    }),
  );

  router.delete(
    '/:hash/actors/:name',
    wrap(async ({ req }) => {
      await db.removeMediaActor(req.params.hash, req.params.name);
    }),
  );

  router.get('/:hash/file', async (req: Request, res: Response) => {
    try {
      const media = await db.getMedia(req.params.hash);
      if (!media) {
        return res.status(404).json({
          message: `No media found with hash: ${req.params.hash}`,
        });
      }
      const absPath = Path.resolve(Config.get().libraryPath, media.path);
      if (media.type === 'gif' || media.type === 'still') {
        const isRotated = await ImportUtils.isExifRotated(absPath);
        if (isRotated) {
          try {
            const image = await ImportUtils.loadImageAutoOrient(absPath);
            res.set('Content-Type', image.contentType);
            return res.end(image.buffer, 'binary');
          } catch (err) {
            console.error('Failed to send rotated image', absPath, err);
          }
        }
      }
      return res.sendFile(absPath);
    } catch (err) {
      console.error('Error reading file', err);
      return res.status(503).json({ message: err.message });
    }
  });

  router.post(
    '/:hash/resolve',
    wrap(async ({ req }) => {
      const media = await db.getMedia(req.params.hash);
      if (!media) {
        throw new NotFound(`No media found with hash: ${req.params.hash}`);
      }

      if (!media.clones) {
        throw new BadRequest('Media has no clones');
      }

      const result = RESOLUTION_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      const request = req.body as MediaResolution;
      // Verify that aliases + unrelated contains everything in clones.
      const allRequested = [...request.aliases, ...request.unrelated];
      // If we can find a clone that isn't in the request body...
      if (media.clones.find(c => !allRequested.includes(c))) {
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

  router.get('/:hash/stream/index.m3u8', (req: Request, res: Response) => {
    db.getMedia(req.params.hash)
      .then(media => {
        if (media) {
          const master = ImportUtils.generateStreamMasterPlaylist(media);
          res.set('Content-Type', 'application/vnd.apple.mpegurl');
          res.end(Buffer.from(master));
        } else {
          res.status(404).json({
            message: `No media found with hash: ${req.params.hash}`,
          });
        }
      })
      .catch(err => {
        res.status(503).json({ message: err.message });
      });
  });

  router.get('/:hash/stream/:quality/index.m3u8', (req: Request, res: Response) => {
    const quality = Number(req.params.quality);
    if (isNaN(quality)) {
      res.status(400).json({ message: 'Quality must be a number' });
      return;
    }

    db.getMedia(req.params.hash)
      .then(media => {
        if (media) {
          res.set('Content-Type', 'application/vnd.apple.mpegurl');
          transcoder
            .getStreamPlaylist(media, quality)
            .then(pl => {
              res.end(Buffer.from(pl));
            })
            .catch(err => {
              // Nothing to be done here because it was probably cancelled during streaming.
              console.warn(err);
            });
        } else {
          res.status(404).json({
            message: `No media found with hash: ${req.params.hash}`,
          });
        }
      })
      .catch(err => {
        res.status(503).json({ message: err.message });
      });
  });

  router.get('/:hash/stream/:quality/:file', (req: Request, res: Response) => {
    const file = req.params.file;
    const quality = Number(req.params.quality);
    if (isNaN(quality)) {
      res.status(400).json({ message: 'Quality must be a number' });
      return;
    }

    if (file === 'data.ts') {
      const start = Number(req.query.start);
      const end = Number(req.query.end);

      if (isNaN(start) || isNaN(end)) {
        res.status(400).json({ message: 'Start and end must be set to numbers' });
        return;
      }

      db.getMedia(req.params.hash)
        .then(media => {
          if (media) {
            res.set('Cache-Control', 'public, max-age=604800, immutable');
            res.set('Content-Type', 'video/mp2t');
            transcoder.streamMedia(media, start, end, res, quality).catch(err => {
              console.error('Error streaming media', err);
              // Can't send headers
              res.end();
            });
          } else {
            res.status(404).json({
              message: `No media found with hash: ${req.params.hash}`,
            });
          }
        })
        .catch(err => {
          res.status(503).json({ message: err.message });
        });
    } else {
      if (!file.startsWith('index') || !file.endsWith('.ts')) {
        res.status(400).json({ message: 'Invalid filename to fetch from cache' });
        return;
      }
      const absPath = Path.resolve(Config.get().cachePath, req.params.hash, `${quality}p`, file);
      if (!PathIsInside(absPath, Path.resolve(Config.get().cachePath))) {
        res.status(400).json({ message: 'Requested file not inside cache' });
        return;
      }
      res.sendFile(absPath);
    }
  });

  return router;
}
