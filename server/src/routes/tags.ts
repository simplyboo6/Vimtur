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
        data: await db.getTags(),
      };
    }),
  );

  router.post(
    '/',
    wrap(async ({ req }) => {
      if (!req.body.tag) {
        throw new BadRequest('No tag specified');
      }
      await db.addTag(req.body.tag);
      return {
        data: await db.getTags(),
      };
    }),
  );

  router.delete(
    '/:tag',
    wrap(async ({ req }) => {
      await db.removeTag(req.params.tag);
      return {
        data: await db.getTags(),
      };
    }),
  );

  return router;
}
