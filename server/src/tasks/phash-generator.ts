import { execute } from 'proper-job';

import { Transcoder } from '../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../types';
import { BlockhashAsync } from '../utils/blockhash-async';

// Really tends to block up the worker threads if higher.
const BATCH_SIZE = 2;

export function getTask(database: Database): RouterTask {
  const transcoder = new Transcoder(database);
  const hasher = new BlockhashAsync();

  return {
    id: 'GENERATE-PHASHES',
    description: 'Generate missing perceptual hashes',
    runner: (updateStatus: TaskRunnerCallback) => {
      return execute(
        async () => {
          const mediaList = await database.subset({
            // For now just do still. Video takes a long time and is questionably accurate.
            // Eg videos of different length not quite right.
            type: { equalsAll: ['still'] },
            indexed: true,
            corrupted: false,
            phashed: false,
            thumbnail: true,
          });

          return {
            iterable: mediaList,
            init: {
              max: mediaList.length,
              current: 0,
            },
          };
        },
        async (hash, init) => {
          if (!init) {
            throw new Error('init not defined for iteration');
          }

          const media = await database.getMedia(hash);
          if (!media) {
            throw new Error(`Couldn't find media to generate perceptual hash: ${hash}`);
          }

          console.debug(`Generating pHash for ${media.hash} - ${media.absolutePath}`);
          const path = transcoder.getThumbnailPath(media);
          const hashString = await hasher.hash(path);
          await database.saveMedia(media.hash, { phash: hashString });

          updateStatus(init.current++, init.max);
        },
        { parallel: BATCH_SIZE },
      );
    },
  };
}
