import { Router } from 'express';
import SocketIO from 'socket.io';

import { Database } from '../types';
import { Importer, Progress, State, Status } from '../cache';
import { wrap } from '../express-async';

interface StrippedFilterResults {
  newPaths: number;
  missingPaths: string[];
}

interface StrippedStatus {
  state: State;
  progress: Progress;
  scanResults?: StrippedFilterResults;
}

export interface ScannerApi {
  router: Router;
  cache: Importer;
}

function stripStatus(status: Status): StrippedStatus {
  return {
    state: status.state,
    progress: status.progress,
    ...(status.scanResults
      ? {
          newPaths: status.scanResults.newPaths.length,
          missingPaths: status.scanResults.missingPaths,
        }
      : {}),
  };
}

export async function create(db: Database, io: SocketIO.Server): Promise<ScannerApi> {
  const cache = new Importer(db, status => {
    io.sockets.emit('scanStatus', stripStatus(status));
  });

  function getStatus(): StrippedStatus {
    return stripStatus(cache.getStatus());
  }

  async function importAuto(): Promise<void> {
    await cache.scan();
    await cache.index();
    await cache.thumbnails();
    await cache.cache();
  }

  io.on('connection', socket => {
    socket.emit('scanStatus', getStatus());
  });

  const router = Router();

  router.get(
    '/status',
    wrap(async () => {
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/rehash',
    wrap(async () => {
      cache.rehash().catch(err => console.error('Error during rehash', err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/scan',
    wrap(async () => {
      cache.scan().catch(err => console.error('Error during scan', err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/index',
    wrap(async () => {
      cache.index().catch(err => console.error('Error during indexing', err));
      return {
        data: getStatus(),
      };
    }),
  );

  // TODO Add endpoint for deleting clones.

  router.post(
    '/cache',
    wrap(async () => {
      cache.cache().catch(err => console.error('Error during caching', err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/thumbnails',
    wrap(async () => {
      cache.thumbnails().catch(err => console.error('Error during thumbnail generation', err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/import',
    wrap(async () => {
      importAuto().catch(err => console.error('Error during full import.', err));
      return {
        data: getStatus(),
      };
    }),
  );

  return { router, cache };
}
