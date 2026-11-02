import { execute } from 'proper-job';

import type { Database, RouterTask } from '../../types';

// Bulk counterpart of the media viewer's clear icon: once media has manual
// tags, the user can drop the auto-generated tags those manual tags are meant
// to outrank. It goes through the standard media update API (UpdateMedia's
// autoTags: null), which stores the unprocessed state rather than an empty
// list: [] is the siglip pipeline's "processed, no tags matched" marker, so
// writing it here would make the items look scored and the next skip-existing
// run would leave them alone. See UpdateMedia.autoTags in @vimtur/common.
export function getTask(database: Database): RouterTask {
  return {
    id: 'CLEAR-TAGGED-AUTOTAGS',
    description: 'Auto-Tag - Remove auto-generated tags from manually tagged media',
    runner: () => {
      return execute(
        async () => {
          const cleared = await database.saveBulkMedia(
            { tags: { exists: true }, autoTags: { exists: true } },
            { autoTags: null },
          );
          console.log(`CLEAR-TAGGED-AUTOTAGS: cleared ${cleared} media`);
          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
