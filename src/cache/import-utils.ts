import Crypto from 'crypto';
import FFMpeg from 'fluent-ffmpeg';
import FS from 'fs';
import Path from 'path';
import Rimraf from 'rimraf';
import Util from 'util';

import { BaseMedia, MediaType } from '../types';
import Config from '../config';

// Bytes to read from start and end of file.
const CHUNK_SIZE = 64 * 1024;

export interface Quality {
  quality: number;
  copy: boolean;
}

export class ImportUtils {
  public static async hash(path: string): Promise<string> {
    const fd = await Util.promisify(FS.open)(path, 'r');
    const buffer = Buffer.alloc(CHUNK_SIZE * 2);
    const [startReadResult, statResult] = await Promise.all([
      Util.promisify(FS.read)(fd, buffer, 0, CHUNK_SIZE, 0),
      Util.promisify(FS.stat)(path),
    ]);

    let total = startReadResult.bytesRead;
    const endStart = statResult.size - CHUNK_SIZE;
    if (endStart <= 0) {
      buffer.copy(buffer, startReadResult.bytesRead, 0);
    } else {
      const endReadResult = await Util.promisify(FS.read)(
        fd,
        buffer,
        startReadResult.bytesRead,
        CHUNK_SIZE,
        endStart,
      );
      total += endReadResult.bytesRead;
    }
    await Util.promisify(FS.close)(fd);

    const hash = Crypto.createHash('md5');
    hash.update(buffer.slice(0, total));
    return hash.digest().toString('hex');
  }

  public static getType(filename: string): MediaType {
    const ext = Path.extname(filename || '').split('.');
    switch (ext[ext.length - 1].toLowerCase()) {
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'bmp':
      case 'webp':
        return 'still';
      case 'gif':
        return 'gif';
      case 'avi':
      case 'mp4':
      case 'flv':
      case 'wmv':
      case 'mov':
      case 'webm':
      case 'mpeg':
      case 'mpg':
        return 'video';
      default:
        throw new Error('Unknown filetype');
    }
  }

  public static isMaxCopyEnabled(): boolean {
    return Config.get().transcoder.maxCopyEnabled;
  }

  public static getMinQualityForTranscode(): number {
    return Config.get().transcoder.minQuality;
  }

  public static getTranscodeQualities(): number[] {
    return Config.get().transcoder.qualities;
  }

  public static getMediaDesiredQualities(media: BaseMedia): Quality[] {
    const qualities = ImportUtils.getTranscodeQualities();
    const maxCopy = ImportUtils.isMaxCopyEnabled();
    const minQualityForTranscode = ImportUtils.getMinQualityForTranscode();
    if (!media.metadata) {
      throw new Error('Media metadata not found. Cannot calculate desired qualities.');
    }
    const sourceHeight = media.metadata.height;

    const intermediate: number[] = [];
    for (const quality of qualities) {
      if (sourceHeight <= minQualityForTranscode) {
        intermediate.push(sourceHeight);
        continue;
      }
      if (quality > sourceHeight) {
        intermediate.push(sourceHeight);
        continue;
      }
      intermediate.push(quality);
    }

    const output: Quality[] = [];
    for (const quality of intermediate) {
      if (!output.find(el => el.quality === quality)) {
        output.push({
          quality: quality,
          copy: quality === sourceHeight && maxCopy,
        });
      }
    }

    output.sort((a, b) => a.quality - b.quality);
    if (output.length === 0) {
      throw new Error(`No desired qualities for - ${media.hash}`);
    }
    return output;
  }

  public static async transcode(input: string, output: string, args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ffm = FFMpeg(input)
        .outputOptions(args)
        .output(output);
      ffm.on('error', (err, stdout, stderr) => {
        console.log(err.message);
        console.log(`stdout:\n${stdout}`);
        console.log(`stderr:\n${stderr}`);
        reject(err.message);
      });
      ffm.on('end', resolve);
      ffm.run();
    });
  }

  public static async deleteFolder(path: string): Promise<void> {
    console.log(`Removing ${path}`);
    return Util.promisify(Rimraf)(path);
  }

  public static async exists(path: string): Promise<boolean> {
    try {
      await Util.promisify(FS.access)(path, FS.constants.R_OK);
      return true;
    } catch (err) {
      return false;
    }
  }

  public static async mkdir(path: string): Promise<void> {
    const exists = await ImportUtils.exists(path);
    if (!exists) {
      console.log(`Making directory ${path}`);
      return Util.promisify(FS.mkdir)(path);
    }
  }

  public static estimateBandwidthFromQuality(quality: number): number {
    // This makes a vague guess at what the likely bandwidth is.
    return Math.ceil(710.7068 * Math.pow(quality, 1.2665));
  }

  public static generatePlaylist(media: BaseMedia): string {
    if (!media.metadata) {
      throw new Error('Cannot generate playlist for media without metadatata');
    }
    if (!media.metadata.qualityCache) {
      throw new Error('Cannot generate playlist for media with no cached qualities');
    }

    const qualities = media.metadata.qualityCache;
    let data = '#EXTM3U';
    // TODO Refactor this to use actual height and maybe actual bandwidth.
    for (const quality of qualities.sort()) {
      const bandwidth = ImportUtils.estimateBandwidthFromQuality(quality);
      // Get width, assume 16:10 for super max HD.
      const width = Math.ceil((quality / 10) * 16);
      const resolution = `${width}x${quality}`;
      data = `${data}\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`;
      data = `${data}\n${quality}p/index.m3u8`;
    }
    return data;
  }

  public static getRedundanctCaches(
    desiredCachesInput: Quality[],
    actualCaches: number[],
  ): number[] {
    const desiredCaches = desiredCachesInput.map(el => {
      return el.quality;
    });
    const redundant: number[] = [];
    for (const quality of actualCaches) {
      if (!desiredCaches.includes(quality) && !redundant.includes(quality)) {
        redundant.push(quality);
      }
    }
    return redundant;
  }

  public static async wait(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
