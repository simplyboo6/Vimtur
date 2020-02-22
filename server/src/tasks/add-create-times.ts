import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';

export class AddCreateTimes {
  public static getTask(db: Database): RouterTask {
    return {
      description: 'Get missing file creation times',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const list = await db.subset({});
        for (let i = 0; i < list.length; i++) {
          updateStatus(i, list.length);

          const hash = list[i];
          const media = await db.getMedia(hash);
          if (!media) {
            console.warn(`Unable to get media: ${media}`);
            continue;
          }

          if (!media.metadata) {
            // Ignore, done as part of indexing.
            continue;
          }

          if (media.metadata.createdAt) {
            // Already has date
            continue;
          }

          const createdAt = await ImportUtils.getFileCreationTime(media.absolutePath);
          await db.saveMedia(hash, { metadata: { createdAt } });
        }
      },
    };
  }
}
