import { execute } from 'proper-job';
import FS from 'fs';
import Path from 'path';
import Util from 'util';

import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { createHash } from '../cache/hash';
import Config from '../config';

export function getTask(database: Database): RouterTask {
  return {
    id: 'REHASH',
    description: 'Rehash existing media (updates database)',
    runner: (updateStatus: TaskRunnerCallback) => {
      const cachePath = Path.resolve(Config.get().cachePath);

      return execute(
        async () => {
          const files = await database.subset({});
          updateStatus(0, files.length);
          return {
            iterable: files,
            init: {
              current: 0,
              max: files.length,
            },
          };
        },
        async (existingHash, init) => {
          if (!init) {
            throw new Error('init not defined');
          }

          const media = await database.getMedia(existingHash);
          if (!media) {
            throw new Error(`Couldn't find media to rehash: ${existingHash}`);
          }
          const hash = await createHash(media.absolutePath);
          if (hash !== media.hash) {
            console.warn(`Hash changed for ${media.absolutePath}`);
            // Rename the video cache folder, if it's a video.
            if (media.type === 'video') {
              try {
                await Util.promisify(FS.rename)(
                  Path.resolve(cachePath, media.hash),
                  Path.resolve(cachePath, hash),
                );
              } catch (err) {
                console.warn('Failed to rename video', err);
                await database.saveMedia(media.hash, { metadata: { qualityCache: [] } });
              }
            }
            try {
              // Rename the thumbnail.
              await Util.promisify(FS.rename)(
                Path.resolve(cachePath, 'thumbnails', `${media.hash}.png`),
                Path.resolve(cachePath, 'thumbnails', `${hash}.png`),
              );

              // Rename the preview.
              await Util.promisify(FS.rename)(
                Path.resolve(cachePath, 'previews', `${media.hash}.png`),
                Path.resolve(cachePath, 'previews', `${hash}.png`),
              );
            } catch (err) {
              // If thumbnails can't be moved, because say they're not generated then it's not the end of the world.
              console.warn('Failed to rename thumbnail during rehash', err);
              await database.saveMedia(media.hash, { thumbnail: false });
            }
          }
          await database.saveMedia(media.hash, { hash });

          updateStatus(init.current++, init.max);
        },
        { parallel: 8 },
      );
    },
  };
}
