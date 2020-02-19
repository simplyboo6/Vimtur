import { Database, RouterTask } from '../types';
import { Router } from 'express';
import { TaskManager } from '../task-manager';
import { wrap } from '../express-async';
import Config from '../config';
import SocketIO from 'socket.io';

import {
  CacheGenerator,
  Indexer,
  KeyframeGenerator,
  PhashGenerator,
  PreviewGenerator,
  RehashTask,
  Scanner,
  ThumbnailGenerator,
  ThumbnailVerifier,
} from '../tasks';

export async function create(db: Database, io: SocketIO.Server): Promise<Router> {
  const taskManager = new TaskManager();
  const router = Router();

  const addTask = (id: string, task: RouterTask): void => {
    taskManager.addTask(id, task);
    if (task.router) {
      router.use(`/${id}`, task.router);
    }
  };

  addTask('AUTO-IMPORT', {
    description: 'Automatically import and cache new files',
    runner: () => {
      taskManager.start('SCAN');
      taskManager.start('INDEX');
      taskManager.start('GENERATE-THUMBNAILS');
      if (Config.get().transcoder.enableVideoPreviews) {
        taskManager.start('GENERATE-PREVIEWS');
      }
      if (Config.get().transcoder.enableVideoCaching) {
        taskManager.start('GENERATE-CACHE');
      }
      if (Config.get().transcoder.enablePrecachingKeyframes) {
        taskManager.start('GENERATE-KEYFRAMES');
      }
      if (Config.get().enablePhash) {
        taskManager.start('GENERATE-PHASHES');
      }
    },
  });

  addTask('SCAN', Scanner.getTask(db));
  addTask('INDEX', Indexer.getTask(db));
  addTask('GENERATE-THUMBNAILS', ThumbnailGenerator.getTask(db));
  addTask('GENERATE-KEYFRAMES', KeyframeGenerator.getTask(db));
  addTask('GENERATE-PHASHES', PhashGenerator.getTask(db));
  addTask('GENERATE-CACHE', CacheGenerator.getTask(db));
  addTask('GENERATE-PREVIEWS', PreviewGenerator.getTask(db));
  addTask('REHASH', RehashTask.getTask(db));
  addTask('VERIFY-THUMBNAILS', ThumbnailVerifier.getTask(db));

  io.on('connection', socket => {
    socket.emit('task-queue', taskManager.getQueue());
  });

  taskManager.on('start', data => {
    io.sockets.emit('task-start', data);
  });

  taskManager.on('end', data => {
    io.sockets.emit('task-end', data);
  });

  taskManager.on('queue', data => {
    io.sockets.emit('task-queue', data);
  });

  router.get(
    '/',
    wrap(async () => {
      return {
        data: taskManager.getTasks(),
      };
    }),
  );

  router.get(
    '/queue',
    wrap(async () => {
      return {
        data: taskManager.getQueue(),
      };
    }),
  );

  router.post(
    '/queue/:id',
    wrap(async ({ req }) => {
      return {
        data: taskManager.start(req.params.id),
      };
    }),
  );

  router.delete(
    '/queue/:id',
    wrap(async ({ req }) => {
      taskManager.cancel(req.params.id);
    }),
  );

  return router;
}
