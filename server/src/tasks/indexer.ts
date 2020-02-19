import FFMpeg from 'fluent-ffmpeg';
import GM from 'gm';
import Path from 'path';
import Util from 'util';

import { Database, Media, Metadata, RouterTask, TaskRunnerCallback } from '../types';
import { ImportUtils } from '../cache/import-utils';
import { Scanner } from './scanner';
import Config from '../config';

export class Indexer {
  private database: Database;

  public static getTask(db: Database): RouterTask {
    return {
      description: 'Index new files found during a scan',
      runner: async (callback: TaskRunnerCallback) => {
        if (!Scanner.results) {
          throw new Error('A scan must be run first');
        }
        const results = Scanner.results;
        const indexer = new Indexer(db);
        await indexer.indexFiles(Scanner.results.newPaths, callback);
        results.newPaths = [];
      },
    };
  }

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
    const gm = GM(absolutePath);
    const size: Record<string, number> = (await Util.promisify(gm.size.bind(gm))()) as any;
    return {
      width: size.width,
      height: size.height,
      qualityCache: [size.height],
    };
  }

  public constructor(database: Database) {
    this.database = database;
  }

  public async generateMediaFromFile(file: string): Promise<Media> {
    const absolutePath = Path.resolve(Config.get().libraryPath, file);
    const type = ImportUtils.getType(file);

    return {
      hash: await ImportUtils.hash(absolutePath),
      metadata:
        type === 'video'
          ? await Indexer.getVideoMetadata(absolutePath)
          : await Indexer.getImageMetadata(absolutePath),
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

  public async indexFiles(
    files: string[],
    statusCallback: (current: number, max: number) => void,
  ): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      statusCallback(i, files.length);

      try {
        const media = await this.generateMediaFromFile(files[i]);
        const existingMedia = await this.database.getMedia(media.hash);
        if (existingMedia) {
          await this.database.saveMedia(media.hash, {
            path: media.path,
          });
        } else {
          await this.database.saveMedia(media.hash, media);
        }
      } catch (err) {
        console.error('Failed to index file', files[i], err);
      }

      statusCallback(i + 1, files.length);
    }
  }
}
