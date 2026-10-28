import type { TaskArgs } from '@vimtur/common';
import { execute } from 'proper-job';

import type { Database, RouterTask, TaskRunnerCallback } from '../types';
import { deleteMedia } from '../utils';

import { Scanner } from './scanner';

// Refuses batch deletions above this percentage of the database unless the
// operator picks the 'allow-all' safety mode. A transient library mount
// failure makes every database path report as missing through SCAN, and
// without this limit one accidental DELETE-MISSING would wipe the tracked
// library and cascade its playlists away.
const MAX_MISSING_PERCENT = 10;

export function getTask(database: Database): RouterTask {
  return {
    id: 'DELETE-MISSING',
    description: 'Remove missing files from database',
    args: [
      {
        // Omitted or empty arguments default to 'strict', so existing
        // callers keep the safety limit unless they explicitly opt out.
        type: 'select',
        name: 'Safety',
        values: [
          { id: 'strict', name: `Refuse if missing files exceed ${MAX_MISSING_PERCENT}% of the library` },
          { id: 'allow-all', name: 'Allow deleting any number of files (dangerous)' },
        ],
      },
    ],
    runner: (updateStatus: TaskRunnerCallback, args?: TaskArgs) => {
      // A refusal must not consume the pending missing list, otherwise the
      // only path to retry is running a whole new SCAN. Cleared here as
      // teardown still runs after a failed start-up check.
      let started = false;
      let current = 0;
      return execute(
        async () => {
          const results = Scanner.results && Scanner.results.missingPaths;
          if (!results) {
            throw new Error('Scanner must be run first');
          }

          const mode = args?.[0] ?? 'strict';
          if (mode !== 'strict' && mode !== 'allow-all') {
            throw new Error(`Unexpected DELETE-MISSING safety mode: ${mode}`);
          }

          if (mode === 'strict') {
            const total = await database.countMedia();
            // Integer comparison avoids float rounding at the boundary.
            if (total > 0 && results.length * 100 > total * MAX_MISSING_PERCENT) {
              throw new Error(
                `Refusing to delete ${results.length} missing media: over the ${MAX_MISSING_PERCENT}% safety limit of the ${total} media in the database. ` +
                  `If the scan is correct, re-run with the 'Allow deleting any number of files' safety mode. Otherwise check the library volume is mounted and the library path is correct.`,
              );
            }
          }

          updateStatus(0, results.length);
          started = true;
          return {
            iterable: results,
            init: {
              max: results.length,
            },
          };
        },
        async (path, init) => {
          if (!init) {
            throw new Error('init not defined');
          }
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
          await database.removeMedia(hash, false);

          console.log(`Removed ${hash} - ${path}`);
          current += 1;
          updateStatus(current, init.max);
        },
        { parallel: 8 },
        () => {
          if (started && Scanner.results) {
            Scanner.results.missingPaths = [];
          }
          return Promise.resolve();
        },
      );
    },
  };
}
