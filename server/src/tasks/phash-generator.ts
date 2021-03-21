import { Database, Media, RouterTask, TaskRunnerCallback } from '../types';
import { execute } from 'proper-job';
import PHash from '../phash';

// Really tends to block up the worker threads if higher.
const MH_HASH_BATCH_SIZE = 2;

function getPerceptualHash(media: Media): Promise<Buffer> {
  if (!PHash) {
    throw new Error('pHash not loaded');
  }
  switch (media.type) {
    case 'still':
      return PHash.getMhImageHash(media.absolutePath);
    case 'video':
      return PHash.getDctVideoHash(media.absolutePath);
    default:
      throw new Error(`Unsupported type for phash ${media.type}`);
  }
}

export function getTask(database: Database): RouterTask | undefined {
  if (!PHash) {
    return undefined;
  }
  return {
    id: 'GENERATE-PHASHES',
    description: 'Generate missing PHashes',
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
          const hashBuffer = await getPerceptualHash(media);
          await database.saveMedia(media.hash, { phash: hashBuffer.toString('base64') });

          updateStatus(init.current++, init.max);
        },
        { parallel: MH_HASH_BATCH_SIZE },
      );
    },
  };
}
