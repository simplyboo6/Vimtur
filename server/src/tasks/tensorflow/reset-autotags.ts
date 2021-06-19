import { execute } from 'proper-job';

import type { Database, RouterTask } from '../../types';

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
