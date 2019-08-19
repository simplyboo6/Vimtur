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

  app.get('/web/:file(*)', (req: Request, res: Response) => {
    try {
      if (!require.main) {
        throw new Error('Cannot find require.main');
      }
      const absPath = Path.resolve(
        Path.dirname(require.main.filename),
        '..',
        'web',
        req.params.file,
      );
      const webPath = Path.resolve(Path.dirname(require.main.filename), '..', 'web');
      if (!PathIsInside(absPath, webPath)) {
        throw new Error('File is not inside cache directory');
      }
      return res.sendFile(absPath);
    } catch (err) {
      return res.status(500).json({ message: err.message, type: 'config' });
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
      return {
        data: Config.get(),
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
      return {
        data: Config.get(),
      };
    }),
  );

  app.get('/', (_, res: Response) => {
    res.redirect('/web/index.html');
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
