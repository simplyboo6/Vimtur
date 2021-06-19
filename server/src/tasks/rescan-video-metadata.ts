import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const BATCH_SIZE = 4;

export function getTask(db: Database): RouterTask {
  return {
    id: 'RESCAN-VIDEO-METADATA',
    description: 'Rescan video files for missing metadata',
    runner: (updateStatus: TaskRunnerCallback) => {
      return execute(
        async () => {
          const videos = await db.subset({
            corrupted: false,
            type: { equalsAll: ['video'] },
          });
          updateStatus(0, videos.length);

          return {
            iterable: videos,
            init: {
              current: 0,
              max: videos.length,
            },
          };
        },
        async (hash, init) => {
          if (!init) {
            throw new Error('init not defined');
          }

          try {
            const media = await db.getMedia(hash);
            if (!media) {
              throw new Error(`Couldn't find media to update metadata: ${hash}`);
            }
            if (media.metadata?.album && media.metadata?.artist && media.metadata?.title) {
              return;
            }
            const fileMetadata = await ImportUtils.getVideoMetadata(media.absolutePath);
            if (!fileMetadata.album && !fileMetadata.artist && !fileMetadata.title) {
              return;
            }

            try {
              await db.saveMedia(media.hash, {
                metadata: {
                  ...(media.metadata?.album ? {} : { album: fileMetadata.album }),
                  ...(media.metadata?.artist ? {} : { artist: fileMetadata.artist }),
                  ...(media.metadata?.title ? {} : { title: fileMetadata.title }),
                },
              });
            } catch (err) {
              console.log('Failed to save media preview state.', err, media);
            }
          } catch (err) {
            console.log(`Error getting metadata for ${hash}.`, err);
            await db.saveMedia(hash, { corrupted: true });
            throw new Error(`Error getting metadata for ${hash}.`);
          } finally {
            updateStatus(init.current++, init.max);
          }
        },
        { parallel: BATCH_SIZE },
      );
    },
  };
}
