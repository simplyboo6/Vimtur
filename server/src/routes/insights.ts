import { Router } from 'express';

import { convertToArray, Insights } from '../insights';
import type { Database } from '../types';
import { sendResponse } from '../utils/send-response';

export function create(db: Database): Router {
  const router = Router();

  const insights = new Insights(db);

  router.get('/', async (req, res) => {
    await insights.analyse();
    sendResponse(req, res, 200, convertToArray(insights.scores));
  });

  return router;
}
