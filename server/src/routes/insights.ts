import { Router } from 'express';

import { convertToArray, Insights } from '../insights';
import type { Database } from '../types';

export function create(db: Database): Router {
  const router = Router();

  const insights = new Insights(db);

  router.get('/', async (_req, res) => {
    await insights.analyse();
    res.status(200).json(convertToArray(insights.scores));
  });

  return router;
}
