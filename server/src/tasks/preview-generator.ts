import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { Transcoder } from '../cache/transcoder';
import { execute } from 'proper-job';

const PREVIEW_BATCH_SIZE = 8;

export class PreviewGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate missing video timeline previews',
      runner: (updateStatus: TaskRunnerCallback) => {
        const transcoder = new Transcoder(database);

        return execute(
          async () => {
            const withoutPreviews = await database.subset({
              preview: false,
              corrupted: false,
              type: { equalsAll: ['video'] },
              duplicateOf: { exists: false },
            });
            updateStatus(0, withoutPreviews.length);

            return {
              iterable: withoutPreviews,
              init: {
                current: 0,
                max: withoutPreviews.length,
              },
            };
          },
          async (hash, init) => {
            if (!init) {
              throw new Error('init not defined');
            }

            try {
              const media = await database.getMedia(hash);
              if (!media) {
                throw new Error(`Couldn't find media to generate preview: ${hash}`);
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
              throw new Error(`Error generating preview for ${hash}.`);
            } finally {
              updateStatus(init.current++, init.max);
            }
          },
          { parallel: PREVIEW_BATCH_SIZE },
        );
      },
    };
  }
}
