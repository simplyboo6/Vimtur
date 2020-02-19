import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { Transcoder } from '../cache/transcoder';

export class CacheGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate missing video caches',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const transcoder = new Transcoder(database);
        const subset = await database.subset({ type: { equalsAll: ['video'] }, corrupted: false });
        await transcoder.transcodeSet(subset, updateStatus);
      },
    };
  }
}
