import { Router } from 'express';

import type { Database } from '../types';
import { singleParam } from '../utils';

// The import ignore list: paths recorded when media is deleted so later scans
// and index runs skip the file instead of re-importing it. The table is small
// (one row per deleted path), so the config page filters it in memory and this
// stays a plain unpaged read with no query parameters.
export function create(db: Database): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const deleted = await db.getDeletedMedia();
    // SQLite returns insertion order and MongoDB storage order, so sorting here
    // is what makes the wire identical for both engines. The config page groups
    // by hash and lists each entry's paths in this order.
    deleted.sort((a, b) => a.hash.localeCompare(b.hash) || a.path.localeCompare(b.path));
    res.status(200).json(deleted);
  });

  // Removal is deliberately by content hash, not by path: the ignore checks are
  // split between SCAN (path) and INDEX (hash, which also records the new path),
  // so leaving one row for a hash would keep that content ignored everywhere.
  // Deleting an unknown hash is a no-op like the other delete routes.
  router.delete('/:hash', async (req, res) => {
    await db.removeDeleted(singleParam(req.params.hash));
    res.sendStatus(204);
  });

  return router;
}
