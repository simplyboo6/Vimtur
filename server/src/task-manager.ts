import { EventEmitter } from 'events';

import type { ListedTask, QueuedTask, TaskArgs } from '@vimtur/common';
import { ExecutorError, ExecutorPromise, ExecutorResults } from 'proper-job';

import Config from './config';
import { BadRequest } from './errors';
import type { Task } from './types';
import { asError } from './utils';

const MAX_TASK_QUEUE_SIZE = 100;
const EMIT_TIME = 1000;
const MAX_FORMATTED_ERRORS = 10;

interface ExecutorTask extends QueuedTask {
  promise?: ExecutorPromise<ExecutorResults<unknown>>;
}

export class TaskManager extends EventEmitter {
  private tasks: Record<string, Task> = {};
  private taskQueue: ExecutorTask[] = [];
  private lastEmitTime = 0;

  public start(id: string, args?: unknown): string {
    const task = this.tasks[id];
    if (!task) {
      throw new BadRequest(`No task with id: ${id}`);
    }

    // The HTTP layer cannot distinguish "no arguments" from an empty
    // argument list: POST bodies without a real argument array (e.g. `{}`)
    // would otherwise be correctly rejected by validation but only after
    // replacing the task, surfacing as a silent 200. Normalising both to
    // the empty form means defaulting (and missing-args) errors stay where
    // the per-task validation decides them.
    const taskArgs = args !== undefined && args !== null && Object.keys(args).length === 0 ? [] : args;
    if (this.taskQueue.length >= MAX_TASK_QUEUE_SIZE) {
      throw new BadRequest('Queue exceeds maximum size');
    }

    let freeId: number | undefined = undefined;
    for (let i = 0; i < MAX_TASK_QUEUE_SIZE; i++) {
      const el = this.taskQueue.find((queuedTask) => queuedTask.id.endsWith(`-${i}`));
      if (!el) {
        freeId = i;
        break;
      }
    }

    if (freeId === undefined) {
      throw new Error('Failed to allocate ID');
    }

    const createdId = `${id}-${freeId}`;
    this.taskQueue.push({
      id: createdId,
      type: id,
      description: task.description,
      current: 0,
      max: 0,
      running: false,
      aborted: false,
      complete: false,
      args: taskArgs as undefined | TaskArgs,
    });

    if (!this.taskQueue[0].running) {
      this.execute();
    }

    this.emit('queue', this.taskQueue);

    return createdId;
  }

  public cancel(id: string): void {
    const index = this.taskQueue.findIndex((task) => task.id === id);
    if (index >= 0) {
      const task = this.taskQueue[index];
      if (task.running) {
        if (!task.promise) {
          throw new Error('Task running but no promise found');
        }
        console.log('Aborting task', task.id);
        task.aborted = true;
        task.promise.abort();
      } else {
        this.taskQueue.splice(index, 1);
      }
    }

    this.emit('queue', this.taskQueue);
  }

  public addTask(id: string, task: Task): void {
    if (this.tasks[id]) {
      throw new Error(`Task already exists: ${id}`);
    }
    this.tasks[id] = task;
  }

  public getQueue(): QueuedTask[] {
    return this.taskQueue;
  }

  public getTasks(): ListedTask[] {
    return Object.keys(this.tasks).map((id) => ({
      id,
      description: this.tasks[id].description,
      args: this.tasks[id].args,
    }));
  }

  public hasTask(id: string): boolean {
    return Boolean(this.tasks[id]);
  }

  private execute(): void {
    const taskQueue = this.taskQueue.filter((task) => !task.error && !task.complete);
    if (taskQueue.length === 0 || taskQueue[0].running) {
      return;
    }

    const queuedTask = taskQueue[0];
    const task = this.tasks[queuedTask.type];
    if (!task) {
      throw new Error('No task found for given type');
    }

    // Has to be marked first because otherwise if it starts another task it'll re-trigger itself.
    queuedTask.running = true;

    if (task.args) {
      // Args may be omitted entirely when queueing (e.g. tasks started by other
      // task runners). Definitions without `required` are the runner's
      // responsibility to default; the per-entry checks below still validate
      // whatever was queued.
      const queuedArgs: TaskArgs = queuedTask.args ?? [];
      try {
        if (!Array.isArray(queuedArgs)) {
          throw new Error('args is not an array');
        }
        for (let i = 0; i < task.args.length; i++) {
          if (queuedArgs[i] === undefined) {
            if (task.args[i].required) {
              throw new Error(`missing args ${i} (${task.args[i].name})`);
            } else {
              continue;
            }
          }
          switch (task.args[i].type) {
            case 'string':
              if (typeof queuedArgs[i] !== 'string') {
                throw new Error(`argument (${task.args[i].name}) must be a string`);
              }
          }
        }
      } catch (errUnknown: unknown) {
        const err = asError(errUnknown);
        queuedTask.error = err.message;
        queuedTask.running = false;
        queuedTask.complete = true;
        this.emit('end', queuedTask);
        this.emit('queue', this.taskQueue);
        this.execute();
        return;
      }
    }

    // The runner may throw synchronously (e.g. stale task prerequisites).
    // Callers may invoke this from a prior task's promise continuation, so
    // an escaping throw would become an unhandled rejection and leave this
    // entry marked running forever, wedging the whole queue.
    try {
      queuedTask.promise = task.runner((current, max, info) => {
        queuedTask.current = current;
        queuedTask.max = max;
        queuedTask.description = info || queuedTask.description;

        const emit = current === 0 || current >= max - 1 || Date.now() - this.lastEmitTime > EMIT_TIME;
        if (emit) {
          this.lastEmitTime = Date.now();
          this.emit('queue', this.taskQueue);
        }
      }, queuedTask.args);
    } catch (errUnknown: unknown) {
      const err = asError(errUnknown);
      queuedTask.error = err.message;
      queuedTask.running = false;
      queuedTask.complete = true;
      this.emit('end', queuedTask);
      this.emit('queue', this.taskQueue);
      this.execute();
      return;
    }

    console.log(`Task started: ${queuedTask.id}`);
    this.emit('start', queuedTask);
    this.emit('queue', this.taskQueue);

    // ESLint being stupid. This whole mess handles the promise.

    queuedTask.promise
      .then((result) => {
        if (queuedTask.aborted) {
          console.log(`Task finished (aborted): ${queuedTask.id}`);
          queuedTask.error = `Aborted. ${result.fulfilled} complete. ${result.errors.length} errors.`;
        } else {
          console.log(`Task completed successfully: ${queuedTask.id}`);
          if (Config.get().user.autoClearCompletedTasks) {
            const index = this.taskQueue.findIndex((t) => t.id === queuedTask.id);
            if (index >= 0) {
              this.taskQueue.splice(index, 1);
            }
            this.cancel(queuedTask.id);
          }
        }
      })
      .catch((errUnknown: unknown) => {
        // asError passes Error instances through unchanged, so `err` carries
        // the original ExecutorError shape when it has one.
        const err = asError(errUnknown);
        console.error(`Task failed: ${queuedTask.id}`, err);
        if (err instanceof ExecutorError) {
          if (err.result.errors.length < MAX_FORMATTED_ERRORS) {
            queuedTask.error = err.result.errors.map((error) => error.message).join('. ');
          } else {
            queuedTask.error = err.message;
          }
        } else {
          queuedTask.error = err.message;
        }
      })
      .finally(() => {
        queuedTask.running = false;
        queuedTask.complete = true;
        this.emit('end', queuedTask);
        this.emit('queue', this.taskQueue);
        this.execute();
      });
  }
}
