import { ExecutorPromise, execute } from 'proper-job';
import FFMpeg from 'fluent-ffmpeg';
import GM from 'gm';
import Path from 'path';
import Util from 'util';

import { Database, Media, Metadata, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Scanner } from './scanner';
import { createHash } from '../cache/hash';
import Config from '../config';

export class Indexer {
  private database: Database;

  public static async getVideoMetadata(absolutePath: string): Promise<Metadata> {
    // The ffprobe typings are broken with promisify.
    const data = await Util.promisify(FFMpeg.ffprobe as any)(absolutePath);

    const mediaData = data.streams.find((stream: any) => stream.codec_type === 'video');
    if (!mediaData) {
      throw new Error('No video streams found to extract metadata from');
    }

    const metadata: Metadata = {
      length: Math.ceil(data.format.duration),
      qualityCache: [],
      width: mediaData.width || mediaData.coded_width,
      height: mediaData.height || mediaData.coded_height,
      codec: mediaData.codec_name,
      ...(data.format.tags
        ? {
            artist: data.format.tags.artist || data.format.tags.album_artist,
            album: data.format.tags.album,
            title: data.format.tags.title,
          }
        : {}),
    };

    // Delete them so they're not passed around as undefined.
    if (!metadata.artist) {
      delete metadata.artist;
    }
    if (!metadata.artist) {
      delete metadata.album;
    }
    if (!metadata.artist) {
      delete metadata.title;
    }

    return metadata;
  }

  private static async getImageMetadata(absolutePath: string): Promise<Metadata> {
    const gm = GM.subClass({ imageMagick: true })(absolutePath);
    const size: Record<string, number> = (await Util.promisify(gm.size.bind(gm))()) as any;
    return {
      width: size.width,
      height: size.height,
    };
  }

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
          ? await Indexer.getVideoMetadata(absolutePath)
          : await Indexer.getImageMetadata(absolutePath)),
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
