import { Router } from 'express';

import { BadRequest } from '../errors';
import type { Database } from '../types';
import { singleParam } from '../utils';

export function create(db: Database): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.status(200).json(await db.getTags());
  });

  router.post('/', async (req, res) => {
    // The request body is free-form JSON with the tag under `tag`.
    const { tag } = req.body as { tag?: unknown };
    if (typeof tag !== 'string' || !tag) {
      throw new BadRequest('No tag specified');
    }
    await db.addTag(tag);
    res.status(200).json(await db.getTags());
  });

  router.delete('/:tag', async (req, res) => {
    await db.removeTag(singleParam(req.params.tag));
    res.status(200).json(await db.getTags());
  });

  return router;
}
