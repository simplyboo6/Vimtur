import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import Config from '../config';
import FS from 'fs';
import Util from 'util';

const BATCH_SIZE = 8;

export class VideoCacheVerifier {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Verify video caches exist',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const videos = await database.subset({ type: { equalsAll: ['video'] } });
        let current = 0;
        const max = videos.length;
        updateStatus(current, max);

        while (videos.length > 0) {
          await Promise.all(
            videos.splice(0, BATCH_SIZE).map(async hash => {
              const media = await database.getMedia(hash);
              if (!media || !media.metadata || !media.metadata.qualityCache) {
                return;
              }

              const validQualities: number[] = [];
              let allValid = true;
              for (const quality of media.metadata.qualityCache) {
                const base = `${Config.get().cachePath}/${media.hash}/${quality}p`;
                const indexExists = await ImportUtils.exists(`${base}/index.m3u8`);
                if (!indexExists) {
                  console.warn(`Missing index for ${base}`);
                  allValid = false;
                  break;
                }

                const rawIndex = await Util.promisify(FS.readFile)(`${base}/index.m3u8`);
                const index = rawIndex.toString();
                const dataFiles = index.split('\n').filter(line => !line.startsWith('#'));
                let allExist = true;
                for (const file of dataFiles) {
                  const filePath = `${base}/${file}`;
                  const exists = await ImportUtils.exists(filePath);
                  if (!exists) {
                    console.warn(`Missing cache file: ${filePath}`);
                    allExist = false;
                    break;
                  }
                }

                if (!allExist) {
                  allValid = false;
                  break;
                }

                validQualities.push(quality);
              }

              if (allValid) {
                console.log(`All qualities valid for ${media.hash} - ${media.path}`);
              } else {
                console.log(`Invalid quality detected for ${media.hash} - ${media.path}`);
                console.log(
                  `Updating valid qualities for ${media.hash} - ${media.path}`,
                  validQualities,
                );
                await database.saveMedia(media.hash, {
                  metadata: { qualityCache: validQualities },
                });
              }
            }),
          );
          updateStatus(current++, max);
        }
      },
    };
  }
}
