import { Router } from 'express';
import { execute } from 'proper-job';
import type SocketIO from 'socket.io';

import Config from '../config';
import { NotFound } from '../errors';
import { TaskManager } from '../task-manager';
import { getTasks } from '../tasks';
import { pickImportTask } from '../tasks/autotag/siglip/pick-import-task';
import { AUTO_TAG_TASK_ID, autotagSettings, countApplicableTags } from '../tasks/autotag/siglip/state';
import type { Database, RouterTask } from '../types';
import { singleParam } from '../utils';

// AUTO-IMPORT follows the model family selected on the Auto-Tagging page. The
// zero-shot family is additionally gated on an applicable threshold
// (calibration or manual): its task fail-fasts without one, so starting it
// unconditionally would turn every import into an errored task on an
// uncalibrated server. Skipping it there (with a warning) is the honest
// no-op; the page still shows the missing calibration.

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
        async () => {
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
          if (Config.get().enableAutoTags) {
            // Auto-tagging is an optional extra on an import task: a corrupt
            // persisted calibration state (getTaskState JSON-parses on sqlite)
            // must not stop the import, so the gate and its start stay
            // contained while the index/thumbnail starts above still fail the
            // import when they fail. The gate is best-effort, not a guarantee:
            // config can change between this check and the queued run, and the
            // task re-derives its own thresholds when it starts.
            try {
              const settings = autotagSettings();
              const hasApplicableTags =
                settings.model === AUTO_TAG_TASK_ID ? (await countApplicableTags(db, settings)) > 0 : false;
              const selection = pickImportTask(settings.model, hasApplicableTags);
              if (selection.action === 'skip-siglip') {
                // The zero-shot task fail-fasts without an applicable
                // threshold, so skipping it is the honest no-op rather than
                // turning every import into an errored task.
                console.warn(
                  'Skipping auto-tagging on import: SigLIP-2 is selected and no tag has an applicable threshold.',
                );
                console.warn(
                  'Set a manual threshold or run calibration on the Auto-Tagging page, or select another model.',
                );
              } else if (selection.action === 'unknown-model') {
                console.warn(
                  `Skipping auto-tagging on import: the configured model ${settings.model} is not a known AUTO-TAG task` +
                    ' - select a model on the Auto-Tagging page.',
                );
              } else if (taskManager.hasTask(selection.taskId)) {
                taskManager.start(selection.taskId);
              }
            } catch (err) {
              console.warn('Skipping auto-tagging on import: could not evaluate tag thresholds or start the task', err);
            }
          }
          return [];
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

  // Task definitions persist their own JSON-serialisable state between runs
  // (e.g. calibration data). Unknown state is a 404 rather than an empty body
  // so callers can distinguish "never stored" from a stored null.
  router.get('/state/:taskId/:key', async (req, res) => {
    const value = await db.getTaskState(singleParam(req.params.taskId), singleParam(req.params.key));
    if (value === undefined) {
      throw new NotFound('Task state not found');
    }
    res.status(200).json(value);
  });

  return router;
}
