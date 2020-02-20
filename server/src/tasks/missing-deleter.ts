import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { Scanner } from './scanner';
import { deleteMedia } from '../utils';

export class MissingDeleter {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Remove missing files from database',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const results = Scanner.results;
        if (!results) {
          throw new Error('Scanner must be run first');
        }
        const missing = results.missingPaths;
        updateStatus(0, missing.length);
        for (let i = 0; i < missing.length; i++) {
          const path = missing[i];
          const possibilities = await database.subset({ path: { likeAll: [path] } });
          if (possibilities.length === 0) {
            console.warn(`Unable to find hash matching path: ${path}`);
            continue;
          } else if (possibilities.length > 1) {
            console.warn(`Multiple possibilities found for path: ${path}`);
            continue;
          }

          const hash = possibilities[0];
          const media = await database.getMedia(hash);
          if (!media) {
            console.warn(`Unable to fetch media for ${path} - ${hash}`);
            continue;
          }

          await deleteMedia(media);
          await database.removeMedia(hash);

          console.log(`Removed ${hash} - ${path}`);
          updateStatus(i, missing.length);
        }
        results.missingPaths = [];
      },
    };
  }
}
