import { Router } from 'express';

import { BadRequest } from '../errors';
import { Database } from '../types';
import { wrap } from '../express-async';

export async function create(db: Database): Promise<Router> {
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
      if (!req.body.actor) {
        throw new BadRequest('No actor specified');
      }
      await db.addActor(req.body.actor);
      return {
        data: await db.getActors(),
      };
    }),
  );

  router.delete(
    '/:actor',
    wrap(async ({ req }) => {
      await db.removeActor(req.params.actor);
      return {
        data: await db.getActors(),
      };
    }),
  );

  return router;
}
