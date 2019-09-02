import { Router } from 'express';

import { Database } from '../types';
import { Insights, convertToArray } from '../insights';
import { InsightsResponse } from '@vimtur/common';
import { wrap } from '../express-async';

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
