import { Database, Media, RouterTask, TaskRunnerCallback } from '../types';
import { execute } from 'proper-job';
import PHash from 'phash2';

// Really tends to block up the worker threads if higher.
const MH_HASH_BATCH_SIZE = 2;

export class PhashGenerator {
  public static getTask(database: Database): RouterTask {
    return {
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
            const hashBuffer = await PhashGenerator.getPerceptualHash(media);
            await database.saveMedia(media.hash, { phash: hashBuffer.toString('base64') });

            updateStatus(init.current++, init.max);
          },
          { parallel: MH_HASH_BATCH_SIZE },
        );
      },
    };
  }

  private static getPerceptualHash(media: Media): Promise<Buffer> {
    switch (media.type) {
      case 'still':
        return PHash.getMhImageHash(media.absolutePath);
      case 'video':
        return PHash.getDctVideoHash(media.absolutePath);
      default:
        throw new Error(`Unsupported type for phash ${media.type}`);
    }
  }
}
