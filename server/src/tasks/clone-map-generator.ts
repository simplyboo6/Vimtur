import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { generateImageCloneMap } from '../cache/clone-map';

export class CloneMapGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate PHash clone map',
      runner: (updateStatus: TaskRunnerCallback) => {
        return generateImageCloneMap(database, updateStatus);
      },
    };
  }
}
