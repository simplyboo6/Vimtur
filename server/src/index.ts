// Modules
import Http, { Server } from 'http';
import Path from 'path';

import BodyParser from 'body-parser';
import Compression from 'compression';
import DeepMerge from 'deepmerge';
import Express, { Request, Response } from 'express';
import IO from 'socket.io';
import PathIsInside from 'path-is-inside';

// Local
import { setup as setupDb } from './database';
import { wrap } from './express-async';
import Config, { VERSION_NAME } from './config';

// Routes
import * as ActorRouter from './routes/actors';
import * as ImageRouter from './routes/images';
import * as InsightsRouter from './routes/insights';
import * as PlaylistRouter from './routes/playlists';
import * as TagRouter from './routes/tags';
import * as TasksRouter from './routes/tasks';
import * as Utils from './utils';
import type { Database } from './types';

async function createServer(db: Database): Promise<Server> {
  const app = Express();
  const server = Http.createServer(app);
  const io = new IO.Server(server);

  app.use(Compression({ level: 9 }));
  app.use(BodyParser.json());
  app.use(Utils.authConnector);

  app.use('/api/images', await ImageRouter.create(db));
  app.use('/api/tags', await TagRouter.create(db));
  app.use('/api/actors', await ActorRouter.create(db));
  app.use('/api/insights', await InsightsRouter.create(db));
  app.use('/api/tasks', await TasksRouter.create(db, io));
  app.use('/api/playlists', await PlaylistRouter.create(db));

  app.get('/api/version', (_req: Request, res: Response) => {
    res.send(VERSION_NAME);
  });

  if (!require.main) {
    throw new Error('require.main undefned');
  }
  const webRoot = Path.resolve(Path.dirname(require.main.filename), '..', '..', 'client');
  app.use<{ file: string }>('/web/:file(*)', (req, res) => {
    if (
      req.params.file.endsWith('.js') ||
      req.params.file.endsWith('.map') ||
      req.params.file.endsWith('.css') ||
      req.params.file.includes('assets') ||
      req.params.file.includes('node_modules')
    ) {
      const absPath = req.params.file.includes('node_modules')
        ? Path.resolve(webRoot, req.params.file)
        : Path.resolve(webRoot, 'dist', req.params.file);
      if (!PathIsInside(absPath, webRoot)) {
        res.status(403).json({ message: 'Cannot access files outside web-root' });
        return;
      }
      res.sendFile(absPath);
    } else {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.sendFile(Path.resolve(webRoot, 'dist', 'index.html'));
    }
  });

  app.get('/cache/:file(*)', (req: Request, res: Response) => {
    try {
      const absPath = Path.resolve(Config.get().cachePath, req.params.file);
      if (!PathIsInside(absPath, Path.resolve(Config.get().cachePath))) {
        throw new Error('File is not inside cache directory');
      }
      res.set('Cache-Control', 'public, max-age=604800, immutable');
      return res.sendFile(absPath);
    } catch (err) {
      return res.status(400).json({ message: err.message, type: 'config' });
    }
  });

  app.get(
    '/api/config',
    wrap(async () => {
      const config = { ...Config.get() };
      delete config.database;
      return {
        data: config,
      };
    }),
  );

  app.post(
    '/api/config',
    wrap(async ({ req }) => {
      // Because the new config overrides the existing one when saved
      // they must be merged first to preserve properties.
      const merged = DeepMerge.all([await db.getUserConfig(), req.body], {
        arrayMerge: (_, sourceArray) => sourceArray,
      });
      Config.setUserOverlay(merged);
      await db.saveUserConfig(merged);
      const config = { ...Config.get() };
      delete config.database;
      return {
        data: config,
      };
    }),
  );

  app.get('/', (_, res: Response) => {
    res.redirect('/web/');
  });

  return server;
}

async function setup(): Promise<void> {
  console.log('Setting up database');
  const db = await setupDb();

  console.log('Applying config overlay from database.');
  Config.setUserOverlay(await db.getUserConfig());

  // Only setup the http server once the database is loaded.
  console.log(`Setting up HTTP server on ${Config.get().port}`);
  const server = await createServer(db);

  await new Promise<void>((resolve, reject) => {
    try {
      server.listen(Config.get().port, resolve);
    } catch (err) {
      reject(err);
    }
  });
}

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.log('unhandledRejection', error);
});
