import { TaskArgDefinitions, TaskArgs } from '@vimtur/common';
import type { Router } from 'express';
import type { ExecutorPromise, ExecutorResults } from 'proper-job';

export type TaskRunnerCallback = (
  current: number,
  max: number,
  /**
   * Phase label for the run in progress. When supplied it replaces the queue
   * entry's description until the run ends, at which point TaskManager restores
   * the registered description — that restore is deliberate, not redundant, so
   * do not drop it. The client renders a running entry whose description differs
   * from the task roster's as a phase label.
   */
  text?: string,
) => void;
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
