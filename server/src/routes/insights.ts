import { Router } from 'express';
import type { InsightsResponse } from '@vimtur/common';

import { Insights, convertToArray } from '../insights';
import { wrap } from '../express-async';
import type { Database } from '../types';

export async function create(db: Database): Promise<Router> {
  const router = Router();

  const insights = new Insights(db);

  router.get(
    '/',
    wrap(async () => {
      const results = await insights.analyse();
      const data: InsightsResponse = {
        tags: convertToArray(results.tags),
        actors: convertToArray(results.actors),
        artists: convertToArray(results.artists),
      };
      return { data };
    }),
  );

  return router;
}
