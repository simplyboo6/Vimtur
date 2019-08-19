import { Request, Response, Router } from 'express';
import Path from 'path';

import { BadRequest, NotFound } from '../errors';
import { Database, SubsetConstraints } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import { Validator } from '../utils/validator';
import { deleteMedia } from '../utils';
import { wrap } from '../express-async';
import Config from '../config';

export async function create(db: Database): Promise<Router> {
  const router = Router();

  const subsetValidator = await Validator.load(`${__dirname}/../subset.schema.json`);
  const mediaUpdateValidator = await Validator.load(`${__dirname}/../media-update.schema.json`);
  const transcoder = new Transcoder(db);

  router.post(
    '/subset',
    wrap(async ({ req }) => {
      const result = subsetValidator.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      const constraints: SubsetConstraints = req.body;
      constraints.corrupted = false;
      constraints.cached = true;

      console.log('Search request.', constraints);
      return {
        data: await db.subset(constraints),
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

  router.post(
    '/:hash',
    wrap(async ({ req }) => {
      // TODO Validate this against the schema.
      const result = mediaUpdateValidator.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      return {
        data: await db.saveMedia(req.params.hash, req.body),
      };
    }),
  );

  router.get('/:hash/file', (req: Request, res: Response) => {
    db.getMedia(req.params.hash)
      .then(media => {
        if (media) {
          res.sendFile(Path.resolve(Config.get().libraryPath, media.path));
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

  router.get('/:hash/stream/index.m3u8', (req: Request, res: Response) => {
    console.log(`Sending master playlist for ${req.params.hash}`);
    const master = ImportUtils.generateStreamMasterPlaylist();
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(Buffer.from(master));
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
          ImportUtils.generateStreamPlaylist(media, quality)
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

  router.get('/:hash/stream/:quality/data.ts', (req: Request, res: Response) => {
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const quality = Number(req.params.quality);
    if (isNaN(start) || isNaN(end)) {
      res.status(400).json({ message: 'Start and end must be set to numbers' });
      return;
    }

    if (quality && isNaN(quality)) {
      res.status(400).json({ message: 'Quality must be a number' });
      return;
    }

    db.getMedia(req.params.hash)
      .then(media => {
        if (media) {
          transcoder.streamMedia(media, start, end, res, quality).catch(err => {
            res.set('Content-Type', 'video/mp2t');
            res.status(503).json({ message: err.message });
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

  return router;
}
