import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';

export class KeyframeGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Precache video keyframe locations',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const mediaList = await database.subset({
          type: { equalsAll: ['video'] },
          indexed: true,
        });
        for (let i = 0; i < mediaList.length; i++) {
          updateStatus(i, mediaList.length);

          const media = await database.getMedia(mediaList[i]);
          if (!media) {
            console.log('Unexpectedly couldnt find media', mediaList[i]);
            continue;
          }
          if (!media.metadata) {
            console.log('Skipping precache for non-indexed media', mediaList[i]);
            continue;
          }

          let generateSegments = !media.metadata.segments;
          if (generateSegments && media.metadata.qualityCache) {
            const desired = ImportUtils.getMediaDesiredQualities(media);
            let hasAll = true;
            // Check if it's cached at every desired quality, if it is then don't
            // bother precaching.
            for (const quality of desired) {
              if (!media.metadata.qualityCache.includes(quality.quality)) {
                hasAll = false;
                break;
              }
            }
            if (hasAll) {
              generateSegments = false;
            }
          }

          if (generateSegments) {
            try {
              const segments = await ImportUtils.generateSegments(media);
              await database.saveMedia(media.hash, {
                metadata: {
                  segments,
                },
              });
            } catch (err) {
              console.warn('Failed to cache segments', media.hash, err);
            }
          }
        }
      },
    };
  }
}
