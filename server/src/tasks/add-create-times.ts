import { execute } from 'proper-job';

import { ImportUtils } from '../cache/import-utils';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';

export function getTask(db: Database): RouterTask {
  return {
    id: 'ADD-CREATE-TIMES',
    description: 'Get missing file creation times',
    runner: (updateStatus: TaskRunnerCallback) => {
      return execute(
        async () => {
          const hashes = await db.subset({});
          // Filter to media that are actually missing their creation time so
          // the reported maximum is the amount of work this session will do
          // rather than the size of the library.
          const workSet: string[] = [];
          for (const hash of hashes) {
            const media = await db.getMedia(hash);
            if (media?.metadata && !media.metadata.createdAt) {
              workSet.push(hash);
            }
          }
          updateStatus(0, workSet.length);

          return {
            iterable: workSet,
            init: {
              current: 0,
              max: workSet.length,
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
              console.warn(`Unable to get media: ${media}`);
              return;
            }

            if (!media.metadata) {
              // Ignore, done as part of indexing.
              return;
            }

            if (media.metadata.createdAt) {
              // Already has date (the pre-filter should have caught this)
              return;
            }

            const createdAt = await ImportUtils.getFileCreationTime(media.absolutePath);
            await db.saveMedia(hash, { metadata: { createdAt } });
          } finally {
            init.current += 1;
            updateStatus(init.current, init.max);
          }
        },
        {
          parallel: 8,
        },
      );
    },
  };
}
