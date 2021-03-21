import { Database, RouterTask } from '../types';
import { execute } from 'proper-job';

export function getTask(database: Database): RouterTask {
  return {
    id: 'UNCORRUPT',
    description: 'Mark all media as not corrupted (Allows retrying other tasks)',
    runner: () => {
      return execute(
        async () => {
          await database.saveBulkMedia({ corrupted: true }, { corrupted: false });
          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
