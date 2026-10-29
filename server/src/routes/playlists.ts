import type { PlaylistCreate, PlaylistUpdate } from '@vimtur/common';
import { Router } from 'express';

import { BadRequest, NotFound } from '../errors';
import { wrap } from '../express-async';
import type { Database } from '../types';
import { singleParam } from '../utils';
import { Validator } from '../utils/validator';

const PLAYLIST_CREATE_VALIDATOR = Validator.load<PlaylistCreate>('PlaylistCreate');
const PLAYLIST_UPDATE_VALIDATOR = Validator.load<PlaylistUpdate>('PlaylistUpdate');

export function create(db: Database): Router {
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
        throw new BadRequest(result.errorText);
      }

      return {
        data: await db.addPlaylist(result.data),
      };
    }),
  );

  router.delete(
    '/:id',
    wrap(async ({ req }) => {
      await db.removePlaylist(singleParam(req.params.id));
    }),
  );

  router.patch(
    '/:id',
    wrap(async ({ req }) => {
      const result = PLAYLIST_UPDATE_VALIDATOR.validate(req.body);
      if (!result.success) {
        throw new BadRequest(result.errorText);
      }

      await db.updatePlaylist(singleParam(req.params.id), result.data);
    }),
  );

  router.get(
    '/:id',
    wrap(async ({ req }) => {
      const id = singleParam(req.params.id);
      const playlist = await db.getPlaylist(id);
      if (!playlist) {
        throw new NotFound(`No playlist found with id: ${id}`);
      }
      return {
        data: playlist,
      };
    }),
  );

  return router;
}
