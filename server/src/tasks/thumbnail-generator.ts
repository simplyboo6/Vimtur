import { execute } from 'proper-job';

import { Transcoder } from '../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const THUMBNAIL_BATCH_SIZE = 8;

export function getTask(database: Database): RouterTask {
  return {
    id: 'GENERATE-THUMBNAILS',
    description: 'Generate missing thumbnails',
    runner: (updateStatus: TaskRunnerCallback) => {
      const transcoder = new Transcoder(database);

      return execute(
        async () => {
          const withoutThumbnails = await database.subset({
            thumbnail: false,
            corrupted: false,
            duplicateOf: { exists: false },
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
              throw new Error(`Couldn't find media to generate thumbnail: ${hash}`);
            }

            const path = media.absolutePath;
            console.log(`Generating thumbnail for ${path}...`);
            switch (media.type) {
              case 'video':
                await transcoder.createVideoThumbnail(media);
                break;
              case 'still': // Fallthrough
              case 'gif':
                await transcoder.createImageThumbnail(media);
                break;
              default:
                console.warn('Unhandled media type', media);
                return;
            }

            try {
              await database.saveMedia(media.hash, { thumbnail: true });
            } catch (err) {
              console.log('Failed to save media thumbnail state.', err, media);
            }
          } catch (err) {
            console.log(`Error generating thumbnail for ${hash}.`, err);
            await database.saveMedia(hash, { corrupted: true });
          }

          updateStatus(init.current++, init.max);
        },
        { parallel: THUMBNAIL_BATCH_SIZE },
      );
    },
  };
}
