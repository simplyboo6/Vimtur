import { execute } from 'proper-job';

import { Transcoder } from '../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const PREVIEW_BATCH_SIZE = 8;

export function getTask(database: Database): RouterTask {
  return {
    id: 'OPTIMISE-PREVIEWS',
    description: 'Optimise video preview sizes at the cost of quality',
    runner: (updateStatus: TaskRunnerCallback) => {
      const transcoder = new Transcoder(database);

      return execute(
        async () => {
          const withoutPreviews = await database.subset({
            preview: true,
            corrupted: false,
            previewOptimised: false,
            type: { equalsAll: ['video'] },
            // Do the biggest ones first.
            sortBy: 'length',
          });
          updateStatus(0, withoutPreviews.length);

          return {
            iterable: withoutPreviews,
            init: {
              current: 0,
              max: withoutPreviews.length,
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
            const path = transcoder.getPreviewPath(media);
            console.log(`Optimising preview ${path}...`);
            await transcoder.optimisePng(path);

            try {
              await database.saveMedia(media.hash, { previewOptimised: true });
            } catch (err) {
              console.log('Failed to save media preview state.', err, media);
            }
          } catch (err) {
            console.log(`Error optimising preview for ${hash}.`, err);
            throw new Error(`Error optimising preview for ${hash}.`);
          } finally {
            updateStatus(init.current++, init.max);
          }
        },
        { parallel: PREVIEW_BATCH_SIZE },
      );
    },
  };
}
