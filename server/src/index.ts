// Modules
import Http, { Server } from 'http';
import Path from 'path';

import type { Configuration } from '@vimtur/common';
import BodyParser from 'body-parser';
import Compression from 'compression';
import DeepMerge from 'deepmerge';
import Express, { Request, RequestHandler, Response } from 'express';
import PathIsInside from 'path-is-inside';
import IO from 'socket.io';

// Local
import Config, { VERSION_NAME } from './config';
import { setup as setupDb } from './database';
import { BadRequest } from './errors';
import { errorHandler } from './middleware/error-handler';

// Routes
import * as ActorRouter from './routes/actors';
import * as ImageRouter from './routes/images';
import * as InsightsRouter from './routes/insights';
import * as PlaylistRouter from './routes/playlists';
import * as TagRouter from './routes/tags';
import * as TasksRouter from './routes/tasks';
import type { Database } from './types';
import { asError, IMMUTABLE_CACHE_CONTROL } from './utils';
import * as Utils from './utils';

async function createServer(db: Database): Promise<Server> {
  const app = Express();
  const server = Http.createServer(app);
  const io = new IO.Server(server);

  // @types/compression 1.8.1 still types against express 4; runtime middleware shape is unchanged.
  app.use(Compression({ level: 9 }) as unknown as RequestHandler);
  app.use(BodyParser.json());
  app.use(Utils.authConnector);

  app.use('/api/images', ImageRouter.create(db));
  app.use('/api/tags', TagRouter.create(db));
  app.use('/api/actors', ActorRouter.create(db));
  app.use('/api/insights', InsightsRouter.create(db));
  app.use('/api/tasks', await TasksRouter.create(db, io));
  app.use('/api/playlists', PlaylistRouter.create(db));

  app.get('/api/version', (_req: Request, res: Response) => {
    res.send(VERSION_NAME);
  });

  if (!require.main) {
    throw new Error('require.main undefned');
  }
  const webRoot = Path.resolve(Path.dirname(require.main.filename), '..', '..', 'client');
  // Express 5 removed the express-4 `:file(*)` regex-capture syntax. `*splat` is the
  // path-to-regexp v8 wildcard name, and the braces keep it optional so `/web/` still
  // serves index.html. A v8 wildcard always yields an array of decoded segments, so join
  // them back into the same web-root-relative path the old `:file` param provided.
  app.use('/web{/*splat}', (req, res) => {
    const file = req.params.splat?.join('/') ?? '';
    if (
      file.endsWith('.js') ||
      file.endsWith('.map') ||
      file.endsWith('.css') ||
      file.includes('assets') ||
      file.includes('node_modules')
    ) {
      const absPath = file.includes('node_modules') ? Path.resolve(webRoot, file) : Path.resolve(webRoot, 'dist', file);
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

  // Express 5 removed the express-4 `:file(*)` regex-capture syntax. `*splat` is the
  // path-to-regexp v8 wildcard name, and the braces keep it optional so a bare `/cache/`
  // request still reaches this handler (with an empty path) as it did before. A v8
  // wildcard always yields an array of decoded segments (not a single string), so join
  // them back into the same cache-relative path the old `:file` param provided.
  app.get('/cache{/*splat}', (req, res) => {
    const file = req.params.splat?.join('/') ?? '';
    const absPath = Path.resolve(Config.get().cachePath, file);
    if (!PathIsInside(absPath, Path.resolve(Config.get().cachePath))) {
      throw new BadRequest('File is not inside cache directory');
    }
    res.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    res.sendFile(absPath);
  });

  app.get('/api/config', (_req, res) => {
    const config = { ...Config.get() };
    delete config.database;
    res.status(200).json(config);
  });

  app.post('/api/config', async (req, res) => {
    // Because the new config overrides the existing one when saved
    // they must be merged first to preserve properties.
    // The overlay is JSON the API accepts in one piece; Config.setLayers()
    // schema-validates the merged result.
    const merged = DeepMerge.all<Configuration.Partial>([await db.getUserConfig(), req.body as Configuration.Partial], {
      arrayMerge: (_: object[], sourceArray: object[]): object[] => sourceArray,
    });
    // setUserOverlay returns the post-rename overlay; storing that makes the
    // deprecated names disappear from the database instead of persisting
    // forever behind the boot-time mapping.
    const stored = Config.setUserOverlay(merged);
    await db.saveUserConfig(stored);
    const config = { ...Config.get() };
    delete config.database;
    res.status(200).json(config);
  });

  app.get('/', (_, res: Response) => {
    res.redirect('/web/');
  });

  // Central error middleware: sits after every handler so Express 5's
  // rejection/throw forwarding reaches it.
  app.use(errorHandler);

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
      reject(asError(err));
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
