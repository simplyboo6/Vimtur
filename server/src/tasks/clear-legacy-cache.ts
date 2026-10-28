import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import Config from '../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

const BATCH_SIZE = 8;

export function getTask(database: Database): RouterTask {
  return {
    id: 'CLEAR-LEGACY-CACHE',
    description: 'Remove video caches generated with the legacy method',
    runner: (updateStatus: TaskRunnerCallback) => {
      return execute(
        async () => {
          // Only media with a quality cache can have a legacy cache, so the
          // reported maximum reflects the work set rather than the library.
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
            for (const quality of media.metadata.qualityCache) {
              const base = `${Config.get().cachePath}/${media.hash}/${quality}p`;
              const legacyIndex = `${base}/index.m3u8`;
              if (await ImportUtils.exists(legacyIndex)) {
                console.log('Legacy cache found', base);
                await ImportUtils.deleteFolder(base);
              } else {
                validQualities.push(quality);
              }
            }
            if (validQualities.length !== media.metadata.qualityCache.length) {
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
