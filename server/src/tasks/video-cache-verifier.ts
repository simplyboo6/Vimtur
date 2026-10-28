import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import { Transcoder } from '../cache/transcoder';
import Config from '../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const BATCH_SIZE = 8;

export function getTask(database: Database): RouterTask {
  const transcoder = new Transcoder(database);
  return {
    id: 'VERIFY-VIDEO-CACHE',
    description: 'Verify video caches exist',
    runner: (updateStatus: TaskRunnerCallback) => {
      return execute(
        async () => {
          const videos = await database.subset({ type: { equalsAll: ['video'] }, cached: true });
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
            const media = await database.getMedia(hash);
            if (!media || !media.metadata || !media.metadata.qualityCache) {
              // The cached subset should have caught this, but be safe.
              return;
            }

            const validQualities: number[] = [];
            let allValid = true;
            for (const quality of media.metadata.qualityCache) {
              const base = `${Config.get().cachePath}/${media.hash}/${quality}p`;
              // Returns the legacy cache or the newer version.
              const index = await transcoder.getStreamPlaylist(media, quality);
              const dataFiles = index.split('\n').filter((line) => !line.startsWith('#'));
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
              console.log(`Updating valid qualities for ${media.hash} - ${media.path}`, validQualities);
              await database.saveMedia(media.hash, {
                metadata: { qualityCache: validQualities },
              });
            }
          } finally {
            init.current += 1;
            updateStatus(init.current, init.max);
          }
        },
        { parallel: BATCH_SIZE },
      );
    },
  };
}
