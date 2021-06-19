import { execute } from 'proper-job';

import { deleteMedia } from '../utils';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

import { Scanner } from './scanner';

export function getTask(database: Database): RouterTask {
  return {
    id: 'DELETE-MISSING',
    description: 'Remove missing files from database',
    runner: (updateStatus: TaskRunnerCallback) => {
      const results = Scanner.results && Scanner.results.missingPaths;
      if (!results) {
        throw new Error('Scanner must be run first');
      }
      updateStatus(0, results.length);

      let current = 0;
      return execute(
        results,
        async (path) => {
          const possibilities = await database.subset({ path: { likeAll: [path] } });
          if (possibilities.length === 0) {
            throw new Error(`Unable to find hash matching path: ${path}`);
          } else if (possibilities.length > 1) {
            throw new Error(`Multiple possibilities found for path: ${path}`);
          }

          const hash = possibilities[0];
          const media = await database.getMedia(hash);
          if (!media) {
            throw new Error(`Unable to fetch media for ${path} - ${hash}`);
          }

          await deleteMedia(media);
          await database.removeMedia(hash);

          console.log(`Removed ${hash} - ${path}`);
          updateStatus(current++, results.length);
        },
        { parallel: 8 },
        () => {
          if (Scanner.results) {
            Scanner.results.missingPaths = [];
          }
          return Promise.resolve();
        },
      );
    },
  };
}
