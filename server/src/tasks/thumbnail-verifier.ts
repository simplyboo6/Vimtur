import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const THUMBNAIL_BATCH_SIZE = 8;

export function getTask(database: Database): RouterTask {
  return {
    id: 'VERIFY-THUMBNAILS',
    description: 'Verify thumbnails exist',
    runner: (updateStatus: TaskRunnerCallback) => {
      const transcoder = new Transcoder(database);

      return execute(
        async () => {
          const withThumbnails = await database.subset({ thumbnail: true });
          updateStatus(0, withThumbnails.length);

          return {
            iterable: withThumbnails,
            init: {
              current: 0,
              max: withThumbnails.length,
            },
          };
        },
        async (hash, init) => {
          if (!init) {
            throw new Error('init not defined');
          }

          const media = await database.getMedia(hash);
          if (!media) {
            throw new Error(`Cannot find media for hash ${hash}`);
          }
          const path = transcoder.getThumbnailPath(media);
          const exists = await ImportUtils.exists(path);
          if (!exists) {
            console.warn(`${media.absolutePath} missing thumbnail`);
            await database.saveMedia(media.hash, { thumbnail: false });
          }

          updateStatus(init.current++, init.max);
        },
        { parallel: THUMBNAIL_BATCH_SIZE },
      );
    },
  };
}
