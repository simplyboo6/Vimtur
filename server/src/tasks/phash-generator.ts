import { Database, Media, RouterTask, TaskRunnerCallback } from '../types';
import PHash from 'phash2';

// Really tends to block up the worker threads if higher.
const MH_HASH_BATCH_SIZE = 2;

export class PhashGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate missing PHashes',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const mediaList = await database.subset({
          // For now just do still. Video takes a long time and is questionably accurate.
          // Eg videos of different length not quite right.
          type: { equalsAll: ['still'] },
          indexed: true,
          corrupted: false,
          phashed: false,
        });
        let current = 0;
        const max = mediaList.length;
        updateStatus(0, max);

        while (mediaList.length > 0) {
          // Do them in batches of like 8, makes it a bit faster.
          await Promise.all(
            mediaList.splice(0, MH_HASH_BATCH_SIZE).map(async hash => {
              try {
                const media = await database.getMedia(hash);
                if (!media) {
                  console.warn(`Couldn't find media to generate perceptual hash: ${hash}`);
                  return;
                }

                console.debug(`Generating pHash for ${media.hash} - ${media.absolutePath}`);
                const hashBuffer = await PhashGenerator.getPerceptualHash(media);
                await database.saveMedia(media.hash, { phash: hashBuffer.toString('base64') });
              } catch (err) {
                console.log(`Error generating perceuptual hash for ${hash}.`, err);
              }
              updateStatus(current++, max);
            }),
          );
        }
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
