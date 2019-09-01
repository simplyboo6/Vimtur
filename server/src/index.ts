// Modules
import BodyParser from 'body-parser';
import Compression from 'compression';
import DeepMerge from 'deepmerge';
import Express, { Request, Response } from 'express';
import Http, { Server } from 'http';
import IO from 'socket.io';
import Path from 'path';
import PathIsInside from 'path-is-inside';

// Local
import * as Utils from './utils';
import { Database } from './types';
import { setup as setupDb } from './database';
import { wrap } from './express-async';
import Config from './config';

// Routes
import * as ActorRouter from './routes/actors';
import * as ImageRouter from './routes/images';
import * as ScannerRouter from './routes/scanner';
import * as TagRouter from './routes/tags';

async function createServer(db: Database): Promise<Server> {
  const app = Express();
  const server = Http.createServer(app);
  const io = IO.listen(server);

  app.use(Compression({ level: 9 }));
  app.use(BodyParser.json());
  app.use(Utils.authConnector);

  const imageRouter = await ImageRouter.create(db);
  app.use('/api/images', imageRouter);

  const tagRouter = await TagRouter.create(db);
  app.use('/api/tags', tagRouter);

  const actorRouter = await ActorRouter.create(db);
  app.use('/api/actors', actorRouter);

  const scannerRouter = await ScannerRouter.create(db, io);
  app.use('/api/scanner', scannerRouter.router);

  if (!require.main) {
    throw new Error('require.main undefned');
  }
  const webRoot = Path.resolve(Path.dirname(require.main.filename), '..', '..', 'client');
  app.use('/web/:file(*)', (req, res) => {
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
      const merged = DeepMerge.all([await db.getUserConfig(), req.body]);
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

  await new Promise((resolve, reject) => {
    try {
      server.listen(Config.get().port, resolve);
    } catch (err) {
      reject(err);
    }
  });
}

setup().catch(err => {
  console.error(err);
  process.exit(1);
});

process.on('unhandledRejection', error => {
  console.log('unhandledRejection', error);
});
