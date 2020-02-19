import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';

const THUMBNAIL_BATCH_SIZE = 8;

export class ThumbnailVerifier {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Verify thumbnails exist',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const transcoder = new Transcoder(database);
        const withThumbnails = await database.subset({ thumbnail: true });
        let current = 0;
        const max = withThumbnails.length;
        updateStatus(current, max);

        while (withThumbnails.length > 0) {
          await Promise.all(
            withThumbnails.splice(0, THUMBNAIL_BATCH_SIZE).map(async hash => {
              const media = await database.getMedia(hash);
              if (!media) {
                return;
              }
              const path = transcoder.getThumbnailPath(media);
              const exists = await ImportUtils.exists(path);
              if (!exists) {
                console.warn(`${media.absolutePath} missing thumbnail`);
                await database.saveMedia(media.hash, { thumbnail: false });
              }
            }),
          );
          updateStatus(current++, max);
        }
      },
    };
  }
}
