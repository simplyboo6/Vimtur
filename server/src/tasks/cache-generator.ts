import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import type { TranscodeProgressInfo } from '../cache/transcoder';
import { Transcoder } from '../cache/transcoder';
import Config from '../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const BATCH_SIZE = 2;
// Reset in the final progress reports once per item, because a segment-level
// info text otherwise permanently replaces the queue table's task description.
const DESCRIPTION = 'Generate missing video caches';

// Turns a per-quality segment-completion callback into the weighted share of
// an item's estimate it has produced. Qualities transcode sequentially, so the
// weight is (qualityIndex + doneSegments/totalSegments) / qualityCount —
// monotonic across quality boundaries. The estimate is snapshotted when the
// work set is sized; a runtime missing-quality set that differs from it can
// only make the in-flight weight optimistic or pessimistic until the item's
// finally snaps it, so it never overshoots the reported max.
export function segmentProgressToWeight(info: TranscodeProgressInfo, estimate: number): number {
  const qualityCount = Math.max(1, info.qualityCount);
  const fraction = (info.qualityIndex + info.doneSegments / Math.max(1, info.totalSegments)) / qualityCount;
  return Math.min(1, Math.max(0, fraction)) * estimate;
}

interface WorkItem {
  hash: string;
  estimate: number;
}

export function getTask(database: Database): RouterTask {
  return {
    id: 'GENERATE-CACHE',
    description: DESCRIPTION,
    runner: (updateStatus: TaskRunnerCallback) => {
      let currentMax = 0;
      let completedWeight = 0;
      // hash → weighted units an in-flight item has produced so far. On the
      // finally path an item snaps to its full estimate (even on error), so
      // current reaches exactly max whenever the run itself completes.
      const inflight = new Map<string, number>();
      const transcoder = new Transcoder(database);

      const report = (text?: string): void => {
        let raw = completedWeight;
        for (const fraction of inflight.values()) {
          raw += fraction;
        }
        updateStatus(Math.floor(raw), currentMax, text);
      };

      const onProgress =
        (item: WorkItem) =>
        (info: TranscodeProgressInfo): void => {
          inflight.set(item.hash, segmentProgressToWeight(info, item.estimate));
          report(info.text);
        };

      return execute(
        async () => {
          await ImportUtils.mkdir(`${Config.get().cachePath}`);
          const hashes = await database.subset({
            type: { equalsAll: ['video'] },
            corrupted: false,
            duplicateOf: { exists: false },
          });
          const workSet: WorkItem[] = [];
          for (const hash of hashes) {
            const media = await database.getMedia(hash);
            if (!media) {
              console.warn(`Could not find media to transcode: ${hash}`);
              continue;
            }
            // An item is in this run's work set when its quality caches are
            // missing or redundant (an error when generated but the cache has
            // since disappeared), so the reported maximum is the amount of
            // work this session will do rather than the size of the library.
            const { missing, redundant } = ImportUtils.getCacheWork(media, Config.get().transcoder.cacheQualities);
            if (missing.length === 0 && redundant.length === 0) {
              continue;
            }
            // Per-item progress weight, in the same units as the reported
            // max: one unit per estimated segment per missing quality. Items
            // whose work is only cache cleanup get a single unit, since no
            // segments are produced for them.
            const estimate =
              missing.length === 0 ? 1 : ImportUtils.estimateSegmentCount(media.metadata?.length ?? 0) * missing.length;
            workSet.push({ hash, estimate });
            currentMax += estimate;
          }
          report();
          return {
            init: workSet.length,
            iterable: workSet,
          };
        },
        async (item) => {
          try {
            const media = await database.getMedia(item.hash);
            if (!media) {
              console.warn(`Could not find media to transcode: ${item.hash}`);
              return;
            }
            inflight.set(item.hash, 0);
            report();
            try {
              if (media.corrupted) {
                console.log(`Skipping corrupted file ${media.absolutePath}`);
              } else {
                await transcoder.transcodeMedia(media, onProgress(item));
              }
            } catch (err) {
              console.error(`Failed to transcode ${media.absolutePath}`, err);
              await database.saveMedia(media.hash, { corrupted: true });
            }
          } finally {
            inflight.delete(item.hash);
            completedWeight += item.estimate;
            report(DESCRIPTION);
          }
        },
        {
          parallel: BATCH_SIZE,
        },
      );
    },
  };
}
