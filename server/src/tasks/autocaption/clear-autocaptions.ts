import { execute } from 'proper-job';

import type { Database, RouterTask } from '../../types';

// Bulk counterpart of the media viewer's clear icon and the single bulk clear:
// it resets every media item holding a generated caption to the unprocessed
// state, only touches rows that have autoCaption, and reports how many rows it
// touched. The work set deliberately includes the '' "processed, nothing
// generated" marker: both engines' exists-filter counts an empty string as
// present, and returning those rows to the unprocessed state makes them
// reconsiderable by a later apply. It goes through the standard media update
// API (UpdateMedia's autoCaption: null), which stores the unprocessed state
// rather than '': '' is the caption pipeline's "processed, nothing generated"
// marker, so an update writing '' would make the items look captioned and the
// next skip-existing run would leave them alone. See UpdateMedia.autoCaption in
// @vimtur/common.
export function getTask(database: Database): RouterTask {
  return {
    id: 'CLEAR-AUTOCAPTIONS',
    description: 'Auto-Caption - Remove generated captions from media',
    runner: () => {
      return execute(
        async () => {
          const cleared = await database.saveBulkMedia({ autoCaption: { exists: true } }, { autoCaption: null });
          console.log(`CLEAR-AUTOCAPTIONS: cleared ${cleared} media`);
          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
