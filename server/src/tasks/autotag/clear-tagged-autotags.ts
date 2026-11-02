import { execute } from 'proper-job';

import type { Database, RouterTask } from '../../types';

// Bulk counterpart of the media viewer's clear icon: once media has manual
// tags, the user can drop the auto-generated tags those manual tags are meant
// to outrank. Clearing stores NULL rather than an empty list because an empty
// list is the siglip pipeline's "processed, no tags matched" marker; writing
// [] here would make the items look scored and the next skip-existing run
// would leave them alone.
export function getTask(database: Database): RouterTask {
  return {
    id: 'CLEAR-TAGGED-AUTOTAGS',
    description: 'Auto-Tag - Remove auto-generated tags from manually tagged media',
    runner: () => {
      return execute(
        async () => {
          const cleared = await database.clearAutoTags({ tags: { exists: true }, autoTags: { exists: true } });
          console.log(`CLEAR-TAGGED-AUTOTAGS: cleared ${cleared} media`);
          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
