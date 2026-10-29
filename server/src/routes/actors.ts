import { Router } from 'express';

import { BadRequest } from '../errors';
import { wrap } from '../express-async';
import type { Database } from '../types';
import { singleParam } from '../utils';

export function create(db: Database): Router {
  const router = Router();

  router.get(
    '/',
    wrap(async () => {
      return {
        data: await db.getActors(),
      };
    }),
  );

  router.post(
    '/',
    wrap(async ({ req }) => {
      // The request body is free-form JSON with the actor under `actor`.
      const actor = req.body.actor as string;
      if (!actor) {
        throw new BadRequest('No actor specified');
      }
      await db.addActor(actor);
      return {
        data: await db.getActors(),
      };
    }),
  );

  router.delete(
    '/:actor',
    wrap(async ({ req }) => {
      await db.removeActor(singleParam(req.params.actor));
      return {
        data: await db.getActors(),
      };
    }),
  );

  return router;
}
