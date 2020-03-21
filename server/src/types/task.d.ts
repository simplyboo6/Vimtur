import { ExecutorPromise } from 'proper-job';
import { Router } from 'express';

export type TaskRunnerCallback = (current: number, max: number) => void;
export type TaskRunner = (callback: TaskRunnerCallback) => ExecutorPromise<any>;

export interface Task {
  runner: TaskRunner;
  description: string;
}

export interface RouterTask extends Task {
  router?: Router;
}
