import { BadRequest } from './errors';
import { EventEmitter } from 'events';
import { ExecutorError, ExecutorPromise } from 'proper-job';
import { ListedTask, QueuedTask } from '@vimtur/common';
import { Task } from './types';

const MAX_TASK_QUEUE_SIZE = 30;
const EMIT_TIME = 1000;
const MAX_FORMATTED_ERRORS = 10;

interface ExecutorTask extends QueuedTask {
  promise?: ExecutorPromise<any>;
}

export class TaskManager extends EventEmitter {
  private tasks: Record<string, Task> = {};
  private taskQueue: ExecutorTask[] = [];
  private lastEmitTime = 0;

  public start(id: string): string {
    const task = this.tasks[id];
    if (!task) {
      throw new BadRequest(`No task with id: ${id}`);
    }

    if (this.taskQueue.length >= MAX_TASK_QUEUE_SIZE) {
      throw new BadRequest('Queue exceeds maximum size');
    }

    let freeId: number | undefined = undefined;
    for (let i = 0; i < MAX_TASK_QUEUE_SIZE; i++) {
      const el = this.taskQueue.find(queuedTask => queuedTask.id.endsWith(`-${i}`));
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
    });

    if (!this.taskQueue[0].running) {
      this.execute();
    }

    this.emit('queue', this.taskQueue);

    return createdId;
  }

  public cancel(id: string): void {
    const index = this.taskQueue.findIndex(task => task.id === id);
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
    return Object.keys(this.tasks).map(id => ({
      id,
      description: this.tasks[id].description,
    }));
  }

  private execute(): void {
    const taskQueue = this.taskQueue.filter(task => !task.error && !task.complete);
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
    queuedTask.promise = task.runner((current, max) => {
      queuedTask.current = current;
      queuedTask.max = max;

      const emit =
        current === 0 || current >= max - 1 || Date.now() - this.lastEmitTime > EMIT_TIME;
      if (emit) {
        this.lastEmitTime = Date.now();
        this.emit('queue', this.taskQueue);
      }
    });

    console.log(`Task started: ${queuedTask.id}`);
    this.emit('start', queuedTask);

    // ESLint being stupid. This whole mess handles the promise.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    queuedTask.promise
      .then(result => {
        if (queuedTask.aborted) {
          console.log(`Task finished (aborted): ${queuedTask.id}`);
          queuedTask.error = `Aborted. ${result.fulfilled} complete. ${result.errors.length} errors.`;
        } else {
          console.log(`Task completed successfully: ${queuedTask.id}`);
        }
      })
      .catch(err => {
        console.error(`Task failed: ${queuedTask.id}`, err);
        if (err instanceof ExecutorError) {
          if (err.result.errors.length < MAX_FORMATTED_ERRORS) {
            queuedTask.error = err.result.errors.map(error => error.message).join('. ');
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
