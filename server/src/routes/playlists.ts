import { Router } from 'express';

import { BadRequest } from '../errors';
import { Validator } from '../utils/validator';
import { wrap } from '../express-async';
import type { Database } from '../types';

const PLAYLIST_CREATE_VALIDATOR = Validator.load('PlaylistCreate');
const PLAYLIST_UPDATE_VALIDATOR = Validator.load('PlaylistUpdate');

export async function create(db: Database): Promise<Router> {
  const router = Router();

  router.get(
    '/',
    wrap(async () => {
      return {
        data: await db.getPlaylists(),
      };
    }),
  );

  router.post(
    '/',
    wrap(async ({ req }) => {
      const result = PLAYLIST_CREATE_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      return {
        data: await db.addPlaylist(req.body),
      };
    }),
  );

  router.delete(
    '/:id',
    wrap(async ({ req }) => {
      await db.removePlaylist(req.params.id);
    }),
  );

  router.patch(
    '/:id',
    wrap(async ({ req }) => {
      const result = PLAYLIST_UPDATE_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      await db.updatePlaylist(req.params.id, req.body);
    }),
  );

  router.get(
    '/:id',
    wrap(async ({ req }) => {
      return {
        data: await db.getPlaylist(req.params.id),
      };
    }),
  );

  return router;
}
