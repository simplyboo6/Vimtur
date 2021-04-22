import { ExecutorPromise, execute } from 'proper-job';
import Path from 'path';

import { Database, Media, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Scanner } from './scanner';
import { createHash } from '../cache/hash';
import Config from '../config';

export class Indexer {
  private database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  public async generateMediaFromFile(file: string): Promise<Media> {
    const absolutePath = Path.resolve(Config.get().libraryPath, file);
    const type = ImportUtils.getType(file);

    return {
      hash: await createHash(absolutePath),
      metadata: {
        ...(type === 'video'
          ? await ImportUtils.getVideoMetadata(absolutePath)
          : await ImportUtils.getImageMetadata(absolutePath)),
        createdAt: await ImportUtils.getFileCreationTime(absolutePath),
      },
      path: file,
      dir: Path.dirname(file),
      absolutePath,
      rotation: 0,
      type,
      tags: [],
      actors: [],
      hashDate: Math.floor(Date.now() / 1000),
      corrupted: false,
    };
  }

  public indexFiles(statusCallback: (current: number, max: number) => void): ExecutorPromise<any> {
    if (!Scanner.results) {
      throw new Error('A scan must be run first');
    }
    const files = Scanner.results.newPaths;
    let current = 0;
    console.log(`Indexing ${files.length} files`);

    return execute(
      files,
      async file => {
        try {
          const media = await this.generateMediaFromFile(file);
          const existingMedia = await this.database.getMedia(media.hash);
          if (existingMedia) {
            await this.database.saveMedia(media.hash, {
              path: media.path,
            });
          } else {
            await this.database.saveMedia(media.hash, media);
          }
        } catch (err) {
          console.error('Failed to index file', file, err);
        }
        statusCallback(current++, files.length);
      },
      { parallel: 8 },
      () => {
        if (Scanner.results) {
          Scanner.results.newPaths = [];
        }
        return Promise.resolve();
      },
    );
  }
}

export function getTask(db: Database): RouterTask {
  return {
    id: 'INDEX',
    description: 'Index new files found during a scan',
    runner: (callback: TaskRunnerCallback) => {
      const indexer = new Indexer(db);
      return indexer.indexFiles(callback);
    },
  };
}
