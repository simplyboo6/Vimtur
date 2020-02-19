import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { Transcoder } from '../cache/transcoder';

const THUMBNAIL_BATCH_SIZE = 8;

export class ThumbnailGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate missing thumbnails',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const transcoder = new Transcoder(database);

        const withoutThumbnails = await database.subset({ thumbnail: false, corrupted: false });
        let current = 0;
        const max = withoutThumbnails.length;
        updateStatus(0, max);

        console.log(`${withoutThumbnails.length} media without thumbnails.`);
        while (withoutThumbnails.length > 0) {
          // Do them in batches of like 8, makes it a bit faster.
          await Promise.all(
            withoutThumbnails.splice(0, THUMBNAIL_BATCH_SIZE).map(async hash => {
              try {
                const media = await database.getMedia(hash);
                if (!media) {
                  console.warn(`Couldn't find media to generate thumbnail: ${hash}`);
                  return;
                }
                const path = media.absolutePath;
                console.log(`Generating thumbnail for ${path}...`);
                switch (media.type) {
                  case 'video':
                    await transcoder.createVideoThumbnail(media);
                    break;
                  case 'still': // Fallthrough
                  case 'gif':
                    await transcoder.createImageThumbnail(media);
                    break;
                  default:
                    console.warn('Unhandled media type', media);
                    return;
                }

                try {
                  await database.saveMedia(media.hash, { thumbnail: true });
                } catch (err) {
                  console.log('Failed to save media thumbnail state.', err, media);
                }
              } catch (err) {
                console.log(`Error generating thumbnail for ${hash}.`, err);
                await database.saveMedia(hash, { corrupted: true });
              }

              updateStatus(current++, max);
            }),
          );
        }
      },
    };
  }
}
