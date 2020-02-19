import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { Transcoder } from '../cache/transcoder';

const PREVIEW_BATCH_SIZE = 8;

export class PreviewGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate missing video timeline previews',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const transcoder = new Transcoder(database);
        const withoutPreviews = await database.subset({
          preview: false,
          corrupted: false,
          type: { equalsAll: ['video'] },
        });
        const max = withoutPreviews.length;
        let current = 0;
        updateStatus(current, max);

        console.log(`${withoutPreviews.length} media without previews.`);
        while (withoutPreviews.length > 0) {
          // Do them in batches of like 8, makes it a bit faster.
          await Promise.all(
            withoutPreviews.splice(0, PREVIEW_BATCH_SIZE).map(async hash => {
              try {
                const media = await database.getMedia(hash);
                if (!media) {
                  console.warn(`Couldn't find media to generate preview: ${hash}`);
                  return;
                }
                const path = media.absolutePath;
                console.log(`Generating preview for ${path}...`);
                await transcoder.createVideoPreview(media);

                try {
                  await database.saveMedia(media.hash, { preview: true });
                } catch (err) {
                  console.log('Failed to save media preview state.', err, media);
                }
              } catch (err) {
                console.log(`Error generating preview for ${hash}.`, err);
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
