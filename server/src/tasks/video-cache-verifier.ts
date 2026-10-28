import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import Config from '../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const BATCH_SIZE = 8;

// Progress granularity is one verified quality, not one video, so a library
// of long videos still moves the bar as each quality's cache files are
// checked. max is Σ of the qualities the work set holds when it is sized, so
// current climbs to exactly max: on finish (or an early skip) an item snaps
// its remaining units into the completed count, carried on the work item so
// even a vanished media can't leave units unaccounted for.
interface VerifyItem {
  hash: string;
  units: number;
}

export function getTask(database: Database): RouterTask {
  const transcoder = new Transcoder(database);
  return {
    id: 'VERIFY-VIDEO-CACHE',
    description: 'Verify video caches exist',
    runner: (updateStatus: TaskRunnerCallback) => {
      let max = 0;
      let completed = 0;
      const report = (): void => {
        updateStatus(completed, max);
      };

      return execute(
        async () => {
          const videos = await database.subset({ type: { equalsAll: ['video'] }, cached: true });
          const workSet: VerifyItem[] = [];
          for (const hash of videos) {
            const media = await database.getMedia(hash);
            const units = media?.metadata?.qualityCache?.length ?? 0;
            workSet.push({ hash, units });
            max += units;
          }
          report();
          return {
            init: workSet.length,
            iterable: workSet,
          };
        },
        async (item) => {
          // Units checked so far for this item; unaccounted units are snapped
          // into the completed count in finally.
          let done = 0;
          try {
            const media = await database.getMedia(item.hash);
            if (!media || !media.metadata || !media.metadata.qualityCache) {
              // The sized work set should have caught this, but be safe.
              return;
            }

            const validQualities: number[] = [];
            let allValid = true;
            for (const quality of media.metadata.qualityCache) {
              // Counted when the check starts (not on completion) so a slow
              // listing still moves the count; finally snaps the remainder.
              done += 1;
              completed += 1;
              report();
              const base = `${Config.get().cachePath}/${media.hash}/${quality}p`;
              // Returns the legacy cache or the newer version.
              const index = await transcoder.getStreamPlaylist(media, quality);
              const dataFiles = index.split('\n').filter((line) => !line.startsWith('#'));
              let allExist = true;
              for (const file of dataFiles) {
                const filePath = `${base}/${file}`;
                const exists = await ImportUtils.exists(filePath);
                if (!exists) {
                  console.warn(`Missing cache file: ${filePath}`);
                  allExist = false;
                  break;
                }
              }

              if (!allExist) {
                allValid = false;
                break;
              }

              validQualities.push(quality);
            }

            if (allValid) {
              console.log(`All qualities valid for ${media.hash} - ${media.path}`);
            } else {
              console.log(`Invalid quality detected for ${media.hash} - ${media.path}`);
              console.log(`Updating valid qualities for ${media.hash} - ${media.path}`, validQualities);
              await database.saveMedia(media.hash, {
                metadata: { qualityCache: validQualities },
              });
            }
          } finally {
            // Some qualities can be skipped (missing files short-circuit the
            // rest of the list) — keep the count exact.
            completed += Math.max(0, item.units - done);
            report();
          }
        },
        { parallel: BATCH_SIZE },
      );
    },
  };
}
