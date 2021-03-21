import { Database, RouterTask } from '../types';
import { Router } from 'express';
import { TaskManager } from '../task-manager';
import { execute } from 'proper-job';
import { wrap } from '../express-async';
import Config from '../config';
import SocketIO from 'socket.io';

import { getTasks } from '../tasks';

export async function create(db: Database, io: SocketIO.Server): Promise<Router> {
  const taskManager = new TaskManager();
  const router = Router();

  const addTask = (task: RouterTask): void => {
    taskManager.addTask(task.id, task);
    if (task.router) {
      router.use(`/${task.id}`, task.router);
    }
  };

  for (const task of getTasks(db)) {
    addTask(task);
  }

  addTask({
    id: 'AUTO-IMPORT',
    description: '(Meta-task) Automatically import and cache new files',
    runner: () => {
      return execute(
        () => {
          taskManager.start('SCAN');
          taskManager.start('INDEX');
          taskManager.start('GENERATE-THUMBNAILS');
          if (Config.get().transcoder.enablePrecachingKeyframes) {
            taskManager.start('GENERATE-KEYFRAMES');
          }
          if (Config.get().transcoder.enableVideoPreviews) {
            taskManager.start('GENERATE-PREVIEWS');
          }
          if (Config.get().transcoder.enableVideoCaching) {
            taskManager.start('GENERATE-CACHE');
          }
          if (Config.get().enablePhash && taskManager.hasTask('GENERATE-PHASHES')) {
            taskManager.start('GENERATE-PHASHES');
          }
          if (
            Config.get().enableTensorFlow &&
            taskManager.hasTask('TENSORFLOW-CLASSIFY-MOBILE-NET-V2-140')
          ) {
            taskManager.start('TENSORFLOW-CLASSIFY-MOBILE-NET-V2-140');
          }
          return Promise.resolve([]);
        },
        () => Promise.resolve(),
      );
    },
  });

  addTask({
    id: 'VERIFY-CACHE',
    description: '(Meta-task) Verify and fix cache',
    runner: () => {
      return execute(
        () => {
          taskManager.start('VERIFY-THUMBNAILS');
          taskManager.start('VERIFY-PREVIEWS');
          taskManager.start('VERIFY-VIDEO-CACHE');

          taskManager.start('GENERATE-THUMBNAILS');
          if (Config.get().transcoder.enableVideoPreviews) {
            taskManager.start('GENERATE-PREVIEWS');
          }
          if (Config.get().transcoder.enableVideoCaching) {
            taskManager.start('GENERATE-CACHE');
          }

          return Promise.resolve([]);
        },
        () => Promise.resolve(),
      );
    },
  });

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
        data: taskManager.getTasks().sort((a, b) => a.description.localeCompare(b.description)),
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
