import type { BaseMedia } from '@vimtur/common';
import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import Config from '../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const BATCH_SIZE = 2;

// An item is in this run's work set when its quality caches are missing or
// redundant (an error when generated but the cache has since disappeared), so
// the reported maximum is the amount of work this session will do rather than
// the size of the library. Mirrors what Transcoder.transcodeMedia does during
// processing.
function needsCaches(media: BaseMedia): boolean {
  if (!media.metadata) {
    return false;
  }
  const desiredCaches = ImportUtils.getMediaDesiredQualities(media, Config.get().transcoder.cacheQualities);
  const actualCaches = media.metadata.qualityCache ?? [];
  const missing = desiredCaches.filter((quality) => !actualCaches.includes(quality.quality));
  if (missing.length > 0) {
    return true;
  }
  return ImportUtils.getRedundanctCaches(desiredCaches, actualCaches).length > 0;
}

export function getTask(database: Database): RouterTask {
  return {
    id: 'GENERATE-CACHE',
    description: 'Generate missing video caches',
    runner: (updateStatus: TaskRunnerCallback) => {
      let complete = 0;
      const transcoder = new Transcoder(database);

      return execute(
        async () => {
          await ImportUtils.mkdir(`${Config.get().cachePath}`);
          const hashes = await database.subset({
            type: { equalsAll: ['video'] },
            corrupted: false,
            duplicateOf: { exists: false },
          });
          const workSet: string[] = [];
          for (const hash of hashes) {
            const media = await database.getMedia(hash);
            if (!media) {
              console.warn(`Could not find media to transcode: ${hash}`);
              continue;
            }
            if (needsCaches(media)) {
              workSet.push(hash);
            }
          }
          updateStatus(0, workSet.length);
          return {
            init: workSet.length,
            iterable: workSet,
          };
        },
        async (hash, max) => {
          try {
            const media = await database.getMedia(hash);
            if (!media) {
              console.warn(`Could not find media to transcode: ${hash}`);
              return;
            }
            try {
              if (media.corrupted) {
                console.log(`Skipping corrupted file ${media.absolutePath}`);
              } else {
                await transcoder.transcodeMedia(media);
              }
            } catch (err) {
              console.error(`Failed to transcode ${media.absolutePath}`, err);
              await database.saveMedia(media.hash, { corrupted: true });
            }
          } finally {
            complete += 1;
            updateStatus(complete, max ?? 0);
          }
        },
        {
          parallel: BATCH_SIZE,
        },
      );
    },
  };
}
