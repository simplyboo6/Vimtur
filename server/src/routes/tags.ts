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
        data: await db.getTags(),
      };
    }),
  );

  router.post(
    '/',
    wrap(async ({ req }) => {
      // The request body is free-form JSON with the tag under `tag`.
      const tag = req.body.tag as string;
      if (!tag) {
        throw new BadRequest('No tag specified');
      }
      await db.addTag(tag);
      return {
        data: await db.getTags(),
      };
    }),
  );

  router.delete(
    '/:tag',
    wrap(async ({ req }) => {
      await db.removeTag(singleParam(req.params.tag));
      return {
        data: await db.getTags(),
      };
    }),
  );

  return router;
}
