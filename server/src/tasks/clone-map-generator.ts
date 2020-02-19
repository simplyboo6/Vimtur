import { Database, RouterTask, TaskRunnerCallback } from '../types';
import { generateImageCloneMap } from '../cache/clone-map';
import Config from '../config';

export class CloneMapGenerator {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Generate PHash clone map',
      runner: async (updateStatus: TaskRunnerCallback) => {
        // First expire any old ones.
        await database.resetClones(Math.floor(Date.now() / 1000) - Config.get().maxCloneAge);
        // Now find all phashed
        const images = await database.subsetFields(
          { type: { equalsAll: ['still'] }, phashed: true },
          { phash: 1, hash: 1, clones: 1 },
        );

        const parsed = images.map(image => {
          return {
            hash: image.hash,
            phash: Buffer.from(image.phash!, 'base64'),
            clones: image.clones,
          };
        });

        console.log(`Generating clone map for ${images.length} images`);

        await generateImageCloneMap(database, parsed, updateStatus);
      },
    };
  }
}
