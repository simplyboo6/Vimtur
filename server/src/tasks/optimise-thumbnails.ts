import { execute } from 'proper-job';

import { Transcoder } from '../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const THUMBNAIL_BATCH_SIZE = 8;

export function getTask(database: Database): RouterTask {
  return {
    id: 'OPTIMISE-THUMBNAILS',
    description: 'Optimise thumbnails at the cost of quality',
    runner: (updateStatus: TaskRunnerCallback) => {
      const transcoder = new Transcoder(database);

      return execute(
        async () => {
          const withoutThumbnails = await database.subset({
            thumbnail: true,
            corrupted: false,
            thumbnailOptimised: false,
          });
          updateStatus(0, withoutThumbnails.length);

          return {
            iterable: withoutThumbnails,
            init: {
              current: 0,
              max: withoutThumbnails.length,
            },
          };
        },
        async (hash, init) => {
          if (!init) {
            throw new Error('init not defined');
          }

          try {
            const media = await database.getMedia(hash);
            if (!media) {
              throw new Error(`Couldn't find media: ${hash}`);
            }
            const path = transcoder.getThumbnailPath(media);
            console.log(`Optimising thumbnail ${path}...`);
            await transcoder.optimisePng(path);

            try {
              await database.saveMedia(media.hash, { thumbnailOptimised: true });
            } catch (err) {
              console.log('Failed to save media thumbnail state.', err, media);
            }
          } catch (err) {
            console.log(`Error optimising thumbnail for ${hash}.`, err);
            throw new Error(`Error optimising thumbnail for ${hash}.`);
          } finally {
            updateStatus(init.current++, init.max);
          }
        },
        { parallel: THUMBNAIL_BATCH_SIZE },
      );
    },
  };
}
