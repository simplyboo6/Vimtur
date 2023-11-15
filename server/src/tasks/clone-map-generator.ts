import { generateImageCloneMap } from '../cache/clone-map';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

export function getTask(database: Database): RouterTask | undefined {
  return {
    id: 'GENERATE-CLONE-MAP',
    description: 'Generate perceptual hash clone map',
    runner: (updateStatus: TaskRunnerCallback) => {
      return generateImageCloneMap(database, updateStatus);
    },
  };
}
