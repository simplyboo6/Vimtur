import type { PlaylistCreate, PlaylistUpdate } from '@vimtur/common';
import { Router } from 'express';

import { NotFound } from '../errors';
import type { Database } from '../types';
import { singleParam } from '../utils';
import { sendResponse } from '../utils/send-response';
import { Validator } from '../utils/validator';

const PLAYLIST_CREATE_VALIDATOR = Validator.load<PlaylistCreate>('PlaylistCreate');
const PLAYLIST_UPDATE_VALIDATOR = Validator.load<PlaylistUpdate>('PlaylistUpdate');

export function create(db: Database): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    sendResponse(req, res, 200, await db.getPlaylists());
  });

  router.post('/', async (req, res) => {
    const create = PLAYLIST_CREATE_VALIDATOR.validate(req.body);
    sendResponse(req, res, 200, await db.addPlaylist(create));
  });

  router.delete('/:id', async (req, res) => {
    await db.removePlaylist(singleParam(req.params.id));
    res.sendStatus(204);
  });

  router.patch('/:id', async (req, res) => {
    const update = PLAYLIST_UPDATE_VALIDATOR.validate(req.body);
    await db.updatePlaylist(singleParam(req.params.id), update);
    res.sendStatus(204);
  });

  router.get('/:id', async (req, res) => {
    const id = singleParam(req.params.id);
    const playlist = await db.getPlaylist(id);
    if (!playlist) {
      throw new NotFound(`No playlist found with id: ${id}`);
    }
    sendResponse(req, res, 200, playlist);
  });

  return router;
}
