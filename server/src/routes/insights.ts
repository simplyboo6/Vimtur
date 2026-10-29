import { Router } from 'express';

import { wrap } from '../express-async';
import { convertToArray, Insights } from '../insights';
import type { Database } from '../types';

export function create(db: Database): Router {
  const router = Router();

  const insights = new Insights(db);

  router.get(
    '/',
    wrap(async () => {
      await insights.analyse();
      return { data: convertToArray(insights.scores) };
    }),
  );

  return router;
}
