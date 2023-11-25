import { Router } from 'express';

import { wrap } from '../express-async';
import { convertToArray, Insights } from '../insights';
import type { Database } from '../types';

export async function create(db: Database): Promise<Router> {
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
