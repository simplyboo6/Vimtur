import { Router } from 'express';
import { execute } from 'proper-job';
import type SocketIO from 'socket.io';

import Config from '../config';
import { TaskManager } from '../task-manager';
import { getTasks } from '../tasks';
import { AUTO_TAG_MODELS } from '../tasks/autotag/models';
import type { Database, RouterTask } from '../types';
import { singleParam } from '../utils';

// The task registered for the model registry's first (default) model, started
// by AUTO-IMPORT. Derived here from the registry's own [0] so the default
// cannot drift between the registry and this route.
const DEFAULT_AUTO_TAG_TASK_ID = `AUTO-TAG-${AUTO_TAG_MODELS[0].id}`;

export async function create(db: Database, io: SocketIO.Server): Promise<Router> {
  const taskManager = new TaskManager();
  const router = Router();

  const addTask = async (task: RouterTask): Promise<void> => {
    taskManager.addTask(task.id, task);
    if (task.init) {
      await task.init();
    }
    if (task.router) {
      router.use(`/${task.id}`, task.router);
    }
  };

  for (const task of getTasks(db)) {
    await addTask(task);
  }

  await addTask({
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
          if (Config.get().enableAutoTags && taskManager.hasTask(DEFAULT_AUTO_TAG_TASK_ID)) {
            taskManager.start(DEFAULT_AUTO_TAG_TASK_ID);
          }
          return Promise.resolve([]);
        },
        () => Promise.resolve(),
      );
    },
  });

  await addTask({
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

  io.on('connection', (socket) => {
    socket.emit('task-queue', taskManager.getQueue());
  });

  taskManager.on('start', (data) => {
    io.sockets.emit('task-start', data);
  });

  taskManager.on('end', (data) => {
    io.sockets.emit('task-end', data);
  });

  taskManager.on('queue', (data) => {
    io.sockets.emit('task-queue', data);
  });

  router.get('/', (_req, res) => {
    res.status(200).json(taskManager.getTasks().sort((a, b) => a.description.localeCompare(b.description)));
  });

  router.get('/queue', (_req, res) => {
    res.status(200).json(taskManager.getQueue());
  });

  // 202: the task is accepted for asynchronous processing; the returned id is
  // for queue-position observation, not a representation of a completed result.
  router.post('/queue/:id', (req, res) => {
    res.status(202).json(taskManager.start(singleParam(req.params.id), req.body));
  });

  router.delete('/queue/:id', (req, res) => {
    taskManager.cancel(singleParam(req.params.id));
    res.sendStatus(204);
  });

  return router;
}
