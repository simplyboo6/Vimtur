import { execute } from 'proper-job';

import type { Database, RouterTask } from '../../types';

// Bulk counterpart of the media viewer's clear icon: the scoped clear that
// resets every media item holding an auto-tags list to the unprocessed state
// and reports how many rows it touched. Unlike RESET-AUTOTAGS, which blanks the
// whole autoTags column unconditionally and returns nothing, this one only
// touches rows that have autoTags and returns the count.
// The work set deliberately includes the [] "processed, no tags matched"
// marker: both engines' exists-filter counts an empty list as present, and
// returning those rows to the unprocessed state makes them reconsiderable by a
// later apply. It goes through the standard media update API (UpdateMedia's
// autoTags: null), which stores the unprocessed state rather than an empty
// list: [] is the siglip pipeline's "processed, nothing scored" marker, so an
// update writing [] would make the items look scored and the next skip-existing
// run would leave them alone. See UpdateMedia.autoTags in @vimtur/common.
export function getTask(database: Database): RouterTask {
  return {
    id: 'CLEAR-TAGGED-AUTOTAGS',
    description: 'Auto-Tag - Remove auto-generated tags from media',
    runner: () => {
      return execute(
        async () => {
          const cleared = await database.saveBulkMedia({ autoTags: { exists: true } }, { autoTags: null });
          console.log(`CLEAR-TAGGED-AUTOTAGS: cleared ${cleared} media`);
          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
