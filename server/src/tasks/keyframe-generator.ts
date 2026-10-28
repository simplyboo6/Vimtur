import type { BaseMedia } from '@vimtur/common';
import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import Config from '../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

// An item is in this run's work set when its keyframe-derived stream segments
// are missing and the cached quality list doesn't cover every streaming
// quality (in which case segments are never needed for streaming). This is
// used to size the task's max, so the reported maximum is the amount of work
// this session will do rather than the size of the library.
function needsKeyframes(media: BaseMedia): boolean {
  if (media.metadata?.segments) {
    return false;
  }
  const qualityCache = media.metadata?.qualityCache;
  if (qualityCache && Config.get().transcoder.streamQualities.every((quality) => qualityCache.includes(quality))) {
    return false;
  }
  return true;
}

export function getTask(database: Database): RouterTask {
  return {
    id: 'GENERATE-KEYFRAMES',
    description: 'Precache video keyframe locations',
    runner: (updateStatus: TaskRunnerCallback) => {
      return execute(
        async () => {
          const hashes = await database.subset({
            type: { equalsAll: ['video'] },
            indexed: true,
            duplicateOf: { exists: false },
          });
          const workSet: string[] = [];
          for (const hash of hashes) {
            const media = await database.getMedia(hash);
            if (media?.metadata && needsKeyframes(media)) {
              workSet.push(hash);
            }
          }
          updateStatus(0, workSet.length);

          return {
            iterable: workSet,
            init: {
              current: 0,
              max: workSet.length,
            },
          };
        },
        async (hash, init) => {
          if (!init) {
            throw new Error('init not defined');
          }

          try {
            const media = await database.getMedia(hash);
            if (!media || !media.metadata) {
              console.log('Skipping precache for non-indexed media', hash);
              return;
            }

            const segments = await ImportUtils.generateSegments(media);
            await database.saveMedia(media.hash, {
              metadata: {
                segments,
              },
            });
          } finally {
            init.current += 1;
            updateStatus(init.current, init.max);
          }
        },
      );
    },
  };
}
