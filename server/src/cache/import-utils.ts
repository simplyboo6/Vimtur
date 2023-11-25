import ChildProcess from 'child_process';
import FS from 'fs';
import Path from 'path';
import type Stream from 'stream';
import Util from 'util';

import type { BaseMedia, Media, MediaType, Metadata, SegmentMetadata } from '@vimtur/common';
import type { Response } from 'express';
import FFMpeg from 'fluent-ffmpeg';
import GM from 'gm';
import Rimraf from 'rimraf';

import Config from '../config';

export interface Quality {
  quality: number;
  copy: boolean;
}

// Nice level for low priority tasks
const LOW_PRIORITY = 15;

export interface TranscoderOptions {
  input: string;
  output: string | Stream.Writable;
  outputOptions: string[];
  inputOptions?: string[];
  important?: boolean;
}

type MetadataNameObject = { name?: string | null; description?: string | null };
type StringOrNameObject = string | null | MetadataNameObject;
interface ExternalMetadata {
  author?: StringOrNameObject;
  artist?: StringOrNameObject;
  album?: StringOrNameObject;
  title?: StringOrNameObject;
  content?: StringOrNameObject;
}

function getExternalMetadataField(obj: ExternalMetadata, field: keyof ExternalMetadata): string | undefined {
  switch (typeof obj[field]) {
    case 'string':
      return obj[field] as string;
    case 'object':
      if (typeof (obj[field] as MetadataNameObject).name === 'string') {
        return (obj[field] as MetadataNameObject).name as string;
      }
      return undefined;
    default:
      return undefined;
  }
}

export class ImportUtils {
  public static async getFileCreationTime(path: string): Promise<number> {
    const stat = await Util.promisify(FS.stat)(path);
    if (!stat) {
      throw new Error(`Failed to stat file: ${path}`);
    }
    const creationDate = stat.birthtime || stat.mtime;
    if (!creationDate) {
      throw new Error(`Failed to get creation date: ${path}`);
    }

    return Math.round(creationDate.getTime() / 1000);
  }

  // Loads artist/album/title information from absolutePath.json if it exists and is a valid file.
  // Useful for gallery-dl metadata that doesn't by default embed into images without exiftool.
  public static async getFileExternalMetadata(
    absolutePath: string,
  ): Promise<Partial<Pick<Metadata, 'artist' | 'album' | 'title'>>> {
    try {
      const file = await new Promise<string>((resolve, reject) => {
        FS.readFile(`${absolutePath}.json`, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data.toString());
          }
        });
      });
      const json = JSON.parse(file) as ExternalMetadata;
      const metadata = {
        artist: getExternalMetadataField(json, 'artist') || getExternalMetadataField(json, 'author'),
        album: getExternalMetadataField(json, 'album'),
        title: getExternalMetadataField(json, 'title') || getExternalMetadataField(json, 'content'),
      };
      for (const key of ['artist', 'album', 'title'] as const) {
        if (!metadata[key]) {
          delete metadata[key];
        }
      }
      return metadata;
    } catch (err) {
      return {};
    }
  }

  public static async getVideoMetadata(absolutePath: string): Promise<Metadata> {
    // The ffprobe typings are broken with promisify.
    const data = await Util.promisify(FFMpeg.ffprobe as any)(absolutePath);

    const mediaData = data.streams.find((stream: any) => stream.codec_type === 'video');
    if (!mediaData) {
      throw new Error('No video streams found to extract metadata from');
    }

    const externalMetadata = await ImportUtils.getFileExternalMetadata(absolutePath);

    const metadata: Metadata = {
      length: Math.ceil(data.format.duration),
      qualityCache: [],
      width: mediaData.width || mediaData.coded_width,
      height: mediaData.height || mediaData.coded_height,
      codec: mediaData.codec_name,
      ...(data.format.tags
        ? {
            artist:
              data.format.tags.artist ||
              data.format.tags.album_artist ||
              data.format.tags.ARTIST ||
              externalMetadata.artist,
            album: data.format.tags.album || data.format.tags.ALBUM || externalMetadata.album,
            title: data.format.tags.title || data.format.tags.TITLE || externalMetadata.title,
          }
        : externalMetadata),
    };

    // Delete them so they're not passed around as undefined.
    if (!metadata.artist) {
      delete metadata.artist;
    }
    if (!metadata.album) {
      delete metadata.album;
    }
    if (!metadata.title) {
      delete metadata.title;
    }

    return metadata;
  }

  public static async getImageMetadata(absolutePath: string): Promise<Metadata> {
    const gm = GM.subClass({ imageMagick: true })(absolutePath);
    const size: Record<string, number> = (await Util.promisify(gm.size.bind(gm))()) as any;
    const externalMetadata = await ImportUtils.getFileExternalMetadata(absolutePath);
    return {
      ...externalMetadata,
      width: size.width,
      height: size.height,
    };
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
    return [...new Set([...Config.get().transcoder.cacheQualities, ...Config.get().transcoder.streamQualities])];
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
      if (!output.find((el) => el.quality === quality)) {
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

  public static setNice(pid: number, priority: number): void {
    const renice = ChildProcess.spawn('renice', [`${priority}`, `${pid}`]);
    renice.on('exit', (code: number) => {
      if (code !== 0) {
        console.debug(`Failed to set nice level of ${pid} to ${priority}: Exit code ${code}`);
      }
    });
  }

  // You would think we'd just use fluent-ffmpeg's streaming functionality.
  // However, there appears to be a bug in streaming I can't track down
  // that corrupts that output stream even if piped to a file.
  public static async transcode(options: TranscoderOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [];
      if (options.inputOptions) {
        args.push(...options.inputOptions);
      }
      args.push(...['-i', options.input]);
      args.push(...options.outputOptions);

      if (typeof options.output === 'string') {
        args.push(options.output);
      } else {
        args.push('pipe:1');
      }

      const proc = ChildProcess.spawn('ffmpeg', args);

      if (!options.important) {
        if (proc.pid === undefined) {
          console.warn('Failed to set transcode process to low priority. Missing PID.');
        } else {
          ImportUtils.setNice(proc.pid, LOW_PRIORITY);
        }
      }

      let err = '';
      proc.stderr.on('data', (data) => {
        err += data;
      });

      proc.on('exit', (code) => {
        if (code === 0 || code === 255) {
          resolve();
        } else {
          // This happens if stdout/the pipe is closed. Which can happen
          // when a HTTP request is cancelled.
          if (err.includes('specified for output file #0 (pipe:1) has not been used for any stream')) {
            resolve();
          } else {
            console.error(`FFMPEG error: code (${code})`, err);
            reject(new Error(err));
          }
        }
      });

      if (typeof options.output !== 'string') {
        options.output.on('close', () => {
          // Wait slightly to avoid race condition under load.
          setTimeout(() => {
            proc.kill('SIGKILL');
          }, 20);
        });

        proc.stdout.pipe(options.output, { end: true });
      }
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
      try {
        await Util.promisify(FS.mkdir)(path);
      } catch (errUnknown: unknown) {
        if (typeof errUnknown !== 'object') {
          throw errUnknown;
        }
        const errRecord = errUnknown as Record<string, unknown>;
        // When done in parallel this gets a bit messy.
        if (errRecord.code !== 'EEXIST') {
          throw errUnknown;
        }
      }
    }
  }

  public static calculateBandwidthFromQuality(quality: number, media: Media, round: boolean): number {
    if (!media.metadata) {
      throw new Error(`Can't calculate bandwidth without metadata: ${media.hash}`);
    }

    const resMultiplier = media.metadata.width / media.metadata.height;
    const pixels = quality * quality * resMultiplier;
    const bitrateMultiplier = Config.get().transcoder.bitrateMultiplier;

    if (!round) {
      return pixels * bitrateMultiplier;
    }

    // Round to the nearest .5M
    return Math.ceil((pixels * bitrateMultiplier) / 500000) * 500000;
  }

  public static generateStreamMasterPlaylist(media: Media): string {
    if (!media.metadata) {
      throw new Error(`Cannot stream media that hasn't been indexed: ${media.hash}`);
    }
    const mediaQuality = media.metadata.width > media.metadata.height ? media.metadata.height : media.metadata.width;

    const streamQualities = Config.get().transcoder.streamQualities.filter((quality) => {
      return quality <= mediaQuality;
    });

    // Explicitly include qualities the medias cached at.
    const qualities = Array.from(new Set([...streamQualities, ...(media.metadata.qualityCache ?? [])])).sort();

    // If it's less than the minimum stream quality and not cached.
    if (qualities.length === 0) {
      qualities.push(media.metadata.height);
    }

    let data = '#EXTM3U';
    for (const quality of qualities.sort()) {
      // Can't round because otherwise they come out as needing the same bandwidth.
      const bandwidth = ImportUtils.calculateBandwidthFromQuality(quality, media, false);
      const height = quality;
      const width = Math.ceil((media.metadata.width / media.metadata.height) * height);
      const resolution = `${width}x${height}`;
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

  public static async generateStreamPlaylist(media: Media, segments: SegmentMetadata): Promise<string> {
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

  public static getRedundanctCaches(desiredCachesInput: Quality[], actualCaches: number[]): number[] {
    const desiredCaches = desiredCachesInput.map((el) => {
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
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  public static async isExifRotated(path: string): Promise<boolean> {
    try {
      const gm = GM.subClass({ imageMagick: true })(path);
      const orientation: string = (await Util.promisify(gm.orientation.bind(gm))()) as any;
      switch (orientation.toLowerCase()) {
        case 'topleft':
        case 'unknown':
          return false;
        default:
          return true;
      }
    } catch (err) {
      console.error('isExifRotated failed', path, err);
      return false;
    }
  }

  public static loadImageAutoOrient(path: string, response: Response, scale?: { width: number; height: number }): void {
    let gm = GM.subClass({ nativeAutoOrient: true, imageMagick: true })(path).autoOrient();
    if (scale) {
      gm = gm.scale(scale.width * 1.5, scale.height * 1.5).resize(scale.width, scale.height);
    }
    const format = path.toLowerCase().endsWith('gif') ? 'GIF' : 'PNG';
    response.set('Content-Type', `image/${format.toLowerCase()}`);
    gm.stream(format).pipe(response);
  }

  private static async getKeyframes(media: Media): Promise<number[]> {
    if (media.type !== 'video') {
      throw new Error('Cannot stream non-video type');
    }
    const results = await Util.promisify(ChildProcess.exec)(
      `ffprobe -fflags +genpts -loglevel error -skip_frame nokey -select_streams v:0 -show_entries frame=pkt_dts_time -of csv=print_section=0 "${media.absolutePath}"`,
    );
    return results.stdout
      .split('\n')
      .map((line) => line.split(',')[0].trim())
      .filter((line) => Boolean(line) && line !== 'N/A')
      .map((line) => Number(line));
  }
}
