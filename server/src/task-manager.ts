import { BadRequest } from './errors';
import { EventEmitter } from 'events';
import { ListedTask, QueuedTask } from '@vimtur/common';
import { Task } from './types';

export class TaskManager extends EventEmitter {
  private tasks: Record<string, Task> = {};
  private taskQueue: QueuedTask[] = [];

  public start(id: string): string {
    const task = this.tasks[id];
    if (!task) {
      throw new BadRequest(`No task with id: ${id}`);
    }

    const createdId = `${id}-${this.taskQueue.length}`;
    this.taskQueue.push({
      id: createdId,
      type: id,
      description: task.description,
      running: false,
      current: 0,
      max: 0,
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
        throw new BadRequest(`Running tasks can't be cancelled`);
      }
      this.taskQueue.splice(index, 1);
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
    const taskQueue = this.taskQueue.filter(task => !task.error);
    if (taskQueue.length === 0 || taskQueue[0].running) {
      return;
    }

    const queuedTask = taskQueue[0];
    const task = this.tasks[queuedTask.type];
    if (!task) {
      throw new Error('No task found for given type');
    }

    console.log(`Task started: ${queuedTask.id}`);
    queuedTask.running = true;
    this.emit('start', queuedTask);

    const taskStarted = (promise: Promise<void>): void => {
      // ESLint being stupid. This whole function is here to handle the promise.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      promise
        .then(() => {
          console.log(`Task completed successfully: ${queuedTask.id}`);

          const index = this.taskQueue.indexOf(queuedTask);
          if (index >= 0) {
            this.taskQueue.splice(index, 1);
          }
        })
        .catch(err => {
          console.error(`Task failed: ${queuedTask.id}`, err);

          queuedTask.error = err.message;
        })
        .finally(() => {
          queuedTask.running = false;
          this.emit('end', queuedTask);
          this.emit('queue', this.taskQueue);
          this.execute();
        });
    };

    try {
      taskStarted(
        Promise.resolve(
          task.runner((current, max) => {
            queuedTask.current = current;
            queuedTask.max = max;
            this.emit('queue', this.taskQueue);
          }),
        ),
      );
    } catch (err) {
      console.error(`Failed to start task: ${queuedTask.id}`, err);
      queuedTask.error = err.message;
      queuedTask.running = false;
      this.emit('end', queuedTask);
      this.emit('queue', this.taskQueue);
      this.execute();
      return;
    }
  }
}
