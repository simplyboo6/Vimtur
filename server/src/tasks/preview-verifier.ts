import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import Config from '../config';

const PREVIEW_BATCH_SIZE = 8;

export class PreviewVerifier {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Verify previews exist',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const withPreviews = await database.subset({
          type: { equalsAny: ['video'] },
          preview: true,
        });
        let current = 0;
        const max = withPreviews.length;
        updateStatus(current, max);

        while (withPreviews.length > 0) {
          await Promise.all(
            withPreviews.splice(0, PREVIEW_BATCH_SIZE).map(async hash => {
              const media = await database.getMedia(hash);
              if (!media) {
                return;
              }
              const path = `${Config.get().cachePath}/previews/${media.hash}.png`;
              const exists = await ImportUtils.exists(path);
              if (!exists) {
                console.warn(`${media.absolutePath} missing preview`);
                await database.saveMedia(media.hash, { preview: false });
              }
            }),
          );
          updateStatus(current++, max);
        }
      },
    };
  }
}
