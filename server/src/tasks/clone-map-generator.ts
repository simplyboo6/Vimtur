import { generateImageCloneMap } from '../cache/clone-map';
import PHash from '../phash';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

export function getTask(database: Database): RouterTask | undefined {
  if (!PHash) {
    return undefined;
  }
  return {
    id: 'GENERATE-CLONE-MAP',
    description: 'Generate PHash clone map',
    runner: (updateStatus: TaskRunnerCallback) => {
      return generateImageCloneMap(database, updateStatus);
    },
  };
}
