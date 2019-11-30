import { Router } from 'express';
import SocketIO from 'socket.io';
import Types from '@vimtur/common';

import { Database } from '../types';
import { Importer } from '../cache';
import { wrap } from '../express-async';
import Config from '../config';

type StrippedStatus = Types.Scanner.StrippedStatus;
type Status = Types.Scanner.Status;

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
          scanResults: {
            newPaths: status.scanResults.newPaths.length,
            missingPaths: status.scanResults.missingPaths,
          },
        }
      : {}),
  };
}

export async function create(db: Database, io: SocketIO.Server): Promise<Router> {
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
    await cache.cacheKeyframes();
    await cache.cache();
    if (Config.get().enablePhash) {
      await cache.calculatePerceuptualHashes();
    }
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
    '/clone-map',
    wrap(async () => {
      cache.generateCloneMap().catch(err => console.error(err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.get(
    '/new',
    wrap(async () => {
      const status = cache.getStatus();
      return {
        data: status && status.scanResults ? status.scanResults.newPaths : [],
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
    '/verify-thumbnails',
    wrap(async () => {
      cache.verifyThumbnails().catch(err => console.error('Error verifying thumbnails', err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/phash',
    wrap(async () => {
      cache
        .calculatePerceuptualHashes()
        .catch(err => console.error('Error during phash generation', err));
      return {
        data: getStatus(),
      };
    }),
  );

  router.post(
    '/keyframes',
    wrap(async () => {
      cache
        .cacheKeyframes()
        .catch(err => console.error('Error during keyframe cache generation', err));
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

  return router;
}
