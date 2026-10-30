import { Router } from 'express';

import { BadRequest } from '../errors';
import type { Database } from '../types';
import { singleParam } from '../utils';
import { sendResponse } from '../utils/send-response';

export function create(db: Database): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    sendResponse(req, res, 200, await db.getActors());
  });

  router.post('/', async (req, res) => {
    // The request body is free-form JSON with the actor under `actor`.
    const { actor } = req.body as { actor?: unknown };
    if (typeof actor !== 'string' || !actor) {
      throw new BadRequest('No actor specified');
    }
    await db.addActor(actor);
    sendResponse(req, res, 200, await db.getActors());
  });

  router.delete('/:actor', async (req, res) => {
    await db.removeActor(singleParam(req.params.actor));
    sendResponse(req, res, 200, await db.getActors());
  });

  return router;
}
