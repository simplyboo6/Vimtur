import FS from 'fs';
import Path from 'path';
import Util from 'util';

import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import Config from '../config';

export class RehashTask {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Rehash existing media (updates database)',
      runner: async (updateStatus: TaskRunnerCallback) => {
        const cachePath = Path.resolve(Config.get().cachePath);
        const files = await database.subset({});
        for (let i = 0; i < files.length; i++) {
          const media = await database.getMedia(files[i]);
          if (!media) {
            console.warn(`Couldn't find media to rehash: ${files[i]}`);
            continue;
          }
          const hash = await ImportUtils.hash(media.absolutePath);
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
            } catch (err) {
              // If thumbnails can't be moved, because say they're not generated then it's not the end of the world.
              console.warn('Failed to rename thumbnail during rehash', err);
              await database.saveMedia(media.hash, { thumbnail: false });
            }
          }
          await database.saveMedia(media.hash, { hash });
          updateStatus(i, files.length);
        }
      },
    };
  }
}
