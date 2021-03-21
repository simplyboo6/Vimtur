import { Database, RouterTask } from '../../types';
import { execute } from 'proper-job';

export function getTask(database: Database): RouterTask {
  return {
    id: 'RESET-AUTOTAGS',
    description: 'Auto-Tag - Removes TensorFlow generated tags from all media',
    runner: () => {
      return execute(
        async () => {
          await database.resetAutoTags();
          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
