import { TaskArgDefinitions, TaskArgs } from '@vimtur/common';
import type { Router } from 'express';
import type { ExecutorPromise, ExecutorResults } from 'proper-job';

export type TaskRunnerCallback = (current: number, max: number, text?: string) => void;
export type TaskRunner = (callback: TaskRunnerCallback, args?: TaskArgs) => ExecutorPromise<ExecutorResults<unknown>>;

export interface Task {
  id: string;
  args?: TaskArgDefinitions;
  runner: TaskRunner;
  init?: () => Promise<void>;
  description: string;
}

export interface RouterTask extends Task {
  router?: Router;
}
