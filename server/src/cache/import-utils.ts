import ChildProcess from 'child_process';
import Crypto from 'crypto';
import FS from 'fs';
import GM from 'gm';
import Path from 'path';
import Rimraf from 'rimraf';
import Stream from 'stream';
import Util from 'util';

import { BaseMedia, Media, MediaType, SegmentMetadata } from '../types';
import Config from '../config';

// Bytes to read from start and end of file.
const CHUNK_SIZE = 64 * 1024;

export interface Quality {
  quality: number;
  copy: boolean;
}

export interface LoadedImage {
  buffer: Buffer;
  contentType: string;
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
    return [
      ...new Set([
        ...Config.get().transcoder.cacheQualities,
        ...Config.get().transcoder.streamQualities,
      ]),
    ];
  }

  public static getMediaDesiredQualities(media: BaseMedia, qualities?: number[]): Quality[] {
    if (!qualities) {
      qualities = ImportUtils.getTranscodeQualities();
    }
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

  // You would think we'd just use fluent-ffmpeg's streaming functionality.
  // However, there appears to be a bug in streaming I can't track down
  // that corrupts that output stream even if piped to a file.
  public static async transcode(
    input: string,
    output: string | Stream.Writable,
    outputOptions: string[],
    inputOptions?: string[],
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [];
      if (inputOptions) {
        args.push(...inputOptions);
      }
      args.push(...['-i', input]);
      args.push(...outputOptions);

      if (typeof output === 'string') {
        args.push(output);
      } else {
        args.push('pipe:1');
      }

      const proc = ChildProcess.spawn('ffmpeg', args);
      if (typeof output !== 'string') {
        proc.stdout.pipe(
          output,
          { end: true },
        );

        output.on('close', () => {
          // Wait slightly to avoid race condition under load.
          setTimeout(() => {
            proc.kill();
          }, 20);
        });
      }

      let err = '';
      proc.stderr.on('data', data => {
        err += data;
      });

      proc.on('close', code => {
        if (code === 0 || code === 255) {
          resolve();
        } else {
          console.error(`FFMPEG error: code (${code})`, err);
          reject(new Error(err));
        }
      });
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

  public static generateStreamMasterPlaylist(media: BaseMedia): string {
    const qualities = ImportUtils.getMediaDesiredQualities(media).map(el => el.quality);

    let data = '#EXTM3U';
    // TODO Filter out the resolutions greater than the source resolution.
    // TODO Refactor this to use actual height and maybe actual bandwidth.
    for (const quality of qualities.sort()) {
      const bandwidth = ImportUtils.estimateBandwidthFromQuality(quality);
      // Get width, assume 16:10 for super max HD.
      const width = Math.ceil((quality / 10) * 16);
      const resolution = `${width}x${quality}`;
      data = `${data}\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`;
      data = `${data}\n${quality}/index.m3u8`;
    }
    return data;
  }

  public static async generateSegments(media: Media): Promise<SegmentMetadata> {
    if (!media.metadata) {
      throw new Error('Cannot generate playlist for media without metadatata');
    }
    if (media.type !== 'video') {
      throw new Error('Cannot stream non-video type');
    }
    if (!media.metadata.length) {
      throw new Error(`Can't stream 0 length video`);
    }

    // The reason we have to fetch the keyframes is to we can manually split the stream on keyframes.
    // This allows videos where the codec is copied rather than only supporting re-encoded videos.
    const keyframes = await ImportUtils.getKeyframes(media);
    const segments: SegmentMetadata = {
      standard: [],
    };

    if (keyframes.length === 1 || media.metadata.length < 10) {
      segments.standard.push({ start: 0, end: media.metadata.length });
    } else {
      let lastTimeIndex = 0;
      for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i] - keyframes[lastTimeIndex] > 10) {
          segments.standard.push({ start: keyframes[lastTimeIndex], end: keyframes[i] });

          lastTimeIndex = i;
        } else if (i === keyframes.length - 1) {
          segments.standard.push({ start: keyframes[lastTimeIndex], end: media.metadata.length });
        }
      }
    }

    return segments;
  }

  public static async generateStreamPlaylist(
    media: Media,
    segments: SegmentMetadata,
  ): Promise<string> {
    if (!media.metadata) {
      throw new Error('Cannot generate playlist for media without metadatata');
    }
    if (media.type !== 'video') {
      throw new Error('Cannot stream non-video type');
    }
    if (!media.metadata.length) {
      throw new Error(`Can't stream 0 length video`);
    }

    let data = '';
    let longest = 0;

    for (const segment of segments.standard) {
      const length = segment.end - segment.start;
      if (length > longest) {
        longest = length;
      }
      data += `#EXTINF:${length.toFixed(6)},\ndata.ts?start=${segment.start}&end=${segment.end}\n`;
    }

    const header = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${Math.ceil(
      longest,
    )}\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n`;

    return `${header + data}#EXT-X-ENDLIST\n`;
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

  public static async isExifRotated(path: string): Promise<boolean> {
    try {
      const gm = GM(path);
      const orientation = (await Util.promisify(gm.orientation.bind(gm))()) as any;
      return orientation !== 'TopLeft' && orientation !== 'Unknown';
    } catch (err) {
      console.error('isExifRotated failed', path, err);
      return false;
    }
  }

  public static async loadImageAutoOrient(path: string): Promise<LoadedImage> {
    const gm = GM.subClass({ nativeAutoOrient: true, imageMagick: true })(path).autoOrient();
    const format = path.toLowerCase().endsWith('gif') ? 'GIF' : 'PNG';
    return new Promise<LoadedImage>((resolve, reject) => {
      gm.toBuffer(format, (err, buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            buffer,
            contentType: `image/${format.toLowerCase()}`,
          });
        }
      });
    });
  }

  private static async getKeyframes(media: Media): Promise<number[]> {
    if (media.type !== 'video') {
      throw new Error('Cannot stream non-video type');
    }
    const results = await Util.promisify(ChildProcess.exec)(
      `ffprobe -loglevel error -skip_frame nokey -select_streams v:0 -show_entries frame=pkt_pts_time -of csv=print_section=0 "${media.absolutePath}"`,
    );
    return results.stdout
      .split('\n')
      .filter(line => Boolean(line))
      .map(line => Number(line));
  }
}
