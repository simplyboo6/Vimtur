import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import { execute } from 'proper-job';
import Config from '../config';

export class CacheGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate missing video caches',
      runner: (updateStatus: TaskRunnerCallback) => {
        let complete = 0;
        const transcoder = new Transcoder(database);

        return execute(
          async () => {
            await ImportUtils.mkdir(`${Config.get().cachePath}`);
            const hashes = await database.subset({
              type: { equalsAll: ['video'] },
              corrupted: false,
            });
            return {
              init: hashes.length,
              iterable: hashes,
            };
          },
          async (hash, max) => {
            const media = await database.getMedia(hash);
            if (!media) {
              console.warn(`Could not find media to transcode: ${hash}`);
              return;
            }
            try {
              if (media.corrupted) {
                console.log(`Skipping corrupted file ${media.absolutePath}`);
              } else {
                await transcoder.transcodeMedia(media);
              }
            } catch (err) {
              console.error(`Failed to transcode ${media.absolutePath}`, err);
              await database.saveMedia(media.hash, { corrupted: true });
            }

            updateStatus(complete++, max || 0);
          },
          {
            parallel: 1,
          },
        );
      },
    };
  }
}
