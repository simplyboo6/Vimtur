import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { execute } from 'proper-job';
import Config from '../config';

export class KeyframeGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Precache video keyframe locations',
      runner: (updateStatus: TaskRunnerCallback) => {
        return execute(
          async () => {
            const hashes = await database.subset({
              type: { equalsAll: ['video'] },
              indexed: true,
              duplicateOf: { exists: false },
            });
            updateStatus(0, hashes.length);

            return {
              iterable: hashes,
              init: {
                current: 0,
                max: hashes.length,
              },
            };
          },
          async (hash, init) => {
            if (!init) {
              throw new Error('init not defined');
            }

            const media = await database.getMedia(hash);
            if (!media) {
              console.log('Unexpectedly couldnt find media', hash);
              return;
            }
            if (!media.metadata) {
              console.log('Skipping precache for non-indexed media', hash);
              return;
            }

            let generateSegments = !media.metadata.segments;
            if (generateSegments && media.metadata.qualityCache) {
              const streamQualities = Config.get().transcoder.streamQualities;
              let hasAll = true;
              // Check if it's cached at every streaming quality, if it is then don't
              // bother precaching.
              for (const quality of streamQualities) {
                if (!media.metadata.qualityCache.includes(quality)) {
                  hasAll = false;
                  break;
                }
              }
              if (hasAll) {
                generateSegments = false;
              }
            }

            if (generateSegments) {
              const segments = await ImportUtils.generateSegments(media);
              await database.saveMedia(media.hash, {
                metadata: {
                  segments,
                },
              });
            }

            updateStatus(init.current++, init.max);
          },
        );
      },
    };
  }
}
