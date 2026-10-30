import { Router } from 'express';

import { BadRequest } from '../errors';
import type { Database } from '../types';
import { singleParam } from '../utils';
import { sendResponse } from '../utils/send-response';

export function create(db: Database): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    sendResponse(req, res, 200, await db.getTags());
  });

  router.post('/', async (req, res) => {
    // The request body is free-form JSON with the tag under `tag`.
    const { tag } = req.body as { tag?: unknown };
    if (typeof tag !== 'string' || !tag) {
      throw new BadRequest('No tag specified');
    }
    await db.addTag(tag);
    sendResponse(req, res, 200, await db.getTags());
  });

  router.delete('/:tag', async (req, res) => {
    await db.removeTag(singleParam(req.params.tag));
    sendResponse(req, res, 200, await db.getTags());
  });

  return router;
}
