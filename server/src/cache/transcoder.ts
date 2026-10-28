import ChildProcess from 'child_process';
import FS from 'fs';
import Path from 'path';
import type Stream from 'stream';
import Util from 'util';

import type { Media, SegmentMetadata } from '@vimtur/common';
import GM from 'gm';
import { rimraf } from 'rimraf';
import Config from '../config';
import type { Database } from '../types';

import { ImportUtils, Quality } from './import-utils';

// Progress granularity for cache generation callbacks: emitted per copied/
// transcoded segment within each quality, so callers (tasks) can report
// sub-media progress for very long videos.
export interface TranscodeProgressInfo {
  qualityIndex: number;
  qualityCount: number;
  doneSegments: number;
  totalSegments: number;
  text?: string;
}

export type TranscodeProgressCallback = (info: TranscodeProgressInfo) => void;

export class Transcoder {
  private database: Database;
  public constructor(database: Database) {
    this.database = database;
  }

  public async createVideoThumbnail(media: Media): Promise<void> {
    if (media.type !== 'video') {
      throw new Error('Cannot create video thumbnail for non-video media');
    }
    if (!media.metadata) {
      throw new Error(`Can't create thumbnail for media without metadata`);
    }
    await ImportUtils.mkdir(Config.get().cachePath);
    await ImportUtils.mkdir(`${Config.get().cachePath}/thumbnails`);

    const path = this.getThumbnailPath(media);
    const args = ['-y', '-vf', 'thumbnail,scale=200:-1', '-frames:v', '1'];
    if (!media.metadata.length) {
      throw new Error(`Can't get thumbnail for video with no length`);
    }

    const inputOptions: string[] = ['-hwaccel', 'auto'];
    if (media.metadata.length > 10) {
      const offset = Math.ceil(media.metadata.length / 4);
      inputOptions.push('-ss');
      inputOptions.push(`00:00:${offset >= 60 ? 59 : offset.toFixed(2)}`);
    }
    await ImportUtils.transcode({
      input: media.absolutePath,
      output: path,
      outputOptions: args,
      inputOptions,
    });
  }

  public async createVideoPreview(media: Media): Promise<void> {
    if (media.type !== 'video') {
      throw new Error('Cannot create video thumbnail for non-video media');
    }
    if (!media.metadata || media.metadata.length === undefined) {
      throw new Error(`Can't create thumbnail for media without metadata`);
    }
    await ImportUtils.mkdir(Config.get().cachePath);
    await ImportUtils.mkdir(`${Config.get().cachePath}/previews`);

    const fps = Config.get().transcoder.videoPreviewFps;
    const count = Math.max(1, Math.floor(media.metadata.length / fps));
    const height = Config.get().transcoder.videoPreviewHeight;
    const maxPerColumn = Config.get().transcoder.videoPreviewMaxHeight / height;
    const columns = Math.ceil(count / maxPerColumn);
    const cellsPerColumn = Math.ceil(count / columns);

    console.log(
      `Creating preview. Count (${count}), Columns (${columns}), Cells Per Column (${cellsPerColumn}) - ${media.path}`,
    );

    const args = ['-y', '-vf', `fps=1/${fps},scale=-1:${height},tile=${columns}x${cellsPerColumn}`, '-frames:v', '1'];
    const path = this.getPreviewPath(media);
    await ImportUtils.transcode({
      input: media.absolutePath,
      inputOptions: ['-hwaccel', 'auto'],
      output: path,
      outputOptions: args,
    });
  }

  public async optimisePng(path: string): Promise<void> {
    await Util.promisify(ChildProcess.exec)(`pngquant --speed 8 --force ${path} -o ${path}.optimised`);
    await Util.promisify(ChildProcess.exec)(`mv ${path}.optimised ${path}`);
  }

  public getThumbnailPath(media: Media): string {
    return `${Config.get().cachePath}/thumbnails/${media.hash}.png`;
  }

  public getPreviewPath(media: Media): string {
    return `${Config.get().cachePath}/previews/${media.hash}.png`;
  }

  public async createImageThumbnail(media: Media): Promise<void> {
    if (media.type !== 'gif' && media.type !== 'still') {
      throw new Error('Cannot create image thumbnail for non-image media');
    }
    await ImportUtils.mkdir(Config.get().cachePath);
    await ImportUtils.mkdir(`${Config.get().cachePath}/thumbnails`);

    const output = this.getThumbnailPath(media);

    const gm = GM.subClass({ nativeAutoOrient: true, imageMagick: true })(
      media.absolutePath + (media.type === 'gif' ? '[0]' : ''),
    )
      .autoOrient()
      .resize(200, 200);
    await new Promise<void>((resolve, reject) => {
      gm.write(output, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public async streamMedia(
    media: Media,
    start: number,
    end: number,
    stream: Stream.Writable,
    targetHeight: number,
    realtime: boolean,
  ): Promise<void> {
    if (!media.metadata || !media.metadata.length) {
      throw new Error(`Can't transcode media without metadata`);
    }

    // Clamp the requested range to the media duration. Playlist-derived values can
    // drift slightly past it (Math.ceil'd duration, keyframe timestamps from other probes).
    const videoLength = media.metadata.length;
    start = Math.max(0, Math.min(start, videoLength));
    end = Math.min(end, videoLength);
    // nothing left to encode
    if (end - start <= 0) {
      throw new Error(`Requested segment [${start}, ${end}] is outside the media duration`);
    }

    const inputOptions = ['-hwaccel', 'auto', '-copyts'];
    if (start) {
      inputOptions.push(...['-ss', String(start)]);
    }
    inputOptions.push(...['-t', String(end - start)]);

    const audioCodec = ['-acodec', 'aac', '-ac', '1', '-strict', '-2'];

    const videoCodec = ['-vcodec'];
    if (
      media.metadata.codec === 'h264' &&
      (!targetHeight || targetHeight === media.metadata.height) &&
      Config.get().transcoder.maxCopyEnabled
    ) {
      videoCodec.push(...['copy']);
    } else {
      const qualityRaw = ImportUtils.calculateBandwidthFromQuality(targetHeight || media.metadata.height, media, true);
      const quality = `${Math.ceil(qualityRaw / 1000000)}M`;
      const qualityBuffer = `${Math.ceil((qualityRaw * 2) / 1000000)}M`;

      videoCodec.push(
        ...[
          'libx264',
          '-bsf:v',
          'h264_mp4toannexb',
          '-tune',
          'film',
          ...(realtime ? ['-quality', 'realtime', '-preset', 'ultrafast'] : ['-quality', 'good', '-preset', 'medium']),
          '-maxrate',
          quality,
          '-bufsize',
          qualityBuffer,
          // Add profile because high 10 isn't well supported
          '-profile:v',
          'high',
          // Ensure that the output isn't 10 bit
          '-pix_fmt',
          'yuv420p',
        ],
      );
    }

    // To deal with strange overflows in corner cases.
    videoCodec.push(...['-max_muxing_queue_size', '9999']);

    const scale = targetHeight && targetHeight !== media.metadata.height ? ['-vf', `scale=-2:${targetHeight}`] : [];

    const args = ['-y', ...audioCodec, ...scale, ...videoCodec, '-f', 'mpegts', '-muxdelay', '0'];

    // If not realtime then transcode as low priority.
    await ImportUtils.transcode({
      input: media.absolutePath,
      output: stream,
      outputOptions: args,
      inputOptions,
      important: realtime,
    });
  }

  public async transcodeMedia(media: Media, onProgress?: TranscodeProgressCallback): Promise<void> {
    if (!media.metadata) {
      throw new Error(`Can't transcode media set without metadata`);
    }

    const { missing: missingQualities, redundant } = ImportUtils.getCacheWork(
      media,
      Config.get().transcoder.cacheQualities,
    );

    if (missingQualities.length) {
      console.log(`${media.hash}: ${missingQualities.length} missing quality caches detected.`);
      await ImportUtils.mkdir(`${Config.get().cachePath}/${media.hash}`);
      for (const [qualityIndex, quality] of missingQualities.entries()) {
        await this.transcodeMediaToQuality(media, quality, onProgress, {
          qualityIndex,
          qualityCount: missingQualities.length,
        });
      }
    }
    // Find redundant caches.
    if (redundant.length) {
      console.log(`${media.hash}: ${redundant.length} redundant caches detected.`);
      for (const quality of redundant) {
        console.log(`${media.hash}: Removing quality ${quality}p...`);
        await rimraf(`${Config.get().cachePath}/${media.hash}/${quality}p`);
        media.metadata.qualityCache!.splice(media.metadata.qualityCache!.indexOf(quality), 1);
      }

      console.log(`${media.hash}: Saving quality list...`);
      await this.database.saveMedia(media.hash, {
        metadata: {
          qualityCache: media.metadata.qualityCache,
        },
      });
    }
  }

  public async getStreamPlaylist(media: Media, quality: number): Promise<string> {
    if (!media.metadata) {
      throw new Error('Cannot get playlist for media without metadata');
    }

    // If it's cached then return the cached index.
    // This block copes with legacy caches.
    if (media.metadata.qualityCache && media.metadata.qualityCache.includes(quality)) {
      const indexPath = Path.resolve(Config.get().cachePath, media.hash, `${quality}p`, 'index.m3u8');
      if (await ImportUtils.exists(indexPath)) {
        const cached = await Util.promisify(FS.readFile)(indexPath);
        return cached.toString();
      }
    }

    const segments = await this.getStreamSegments(media);

    return ImportUtils.generateStreamPlaylist(media, segments);
  }

  public async getStreamSegments(media: Media): Promise<SegmentMetadata> {
    const segments = media.metadata?.segments ?? (await ImportUtils.generateSegments(media));
    if (segments.standard[0].start !== 0) {
      segments.standard.unshift({ start: 0, end: segments.standard[0].start });
    }

    if (Config.get().transcoder.enableCachingKeyframes && !media.metadata?.segments) {
      await this.database.saveMedia(media.hash, {
        metadata: {
          segments,
        },
      });
    }

    return segments;
  }

  private async transcodeMediaToQuality(
    media: Media,
    requestedQuality: Quality,
    onProgress?: TranscodeProgressCallback,
    progressContext?: { qualityIndex: number; qualityCount: number },
  ): Promise<void> {
    if (!media.metadata) {
      throw new Error(`Can't transcode media without metadata`);
    }
    const targetHeight = requestedQuality.quality;
    console.log(`${media.hash}: ${media.path} (source ${media.metadata.height}p) - Transcoding to ${targetHeight}p...`);

    media.metadata.qualityCache = media.metadata.qualityCache ?? [];

    if (media.metadata.qualityCache.includes(targetHeight)) {
      console.log(`${media.hash}: Already cached at ${targetHeight}p.`);
      return;
    }

    media.metadata.qualityCache.push(targetHeight);

    try {
      await ImportUtils.mkdir(`${Config.get().cachePath}/${media.hash}/${targetHeight}p`);
    } catch (err) {
      console.warn('Failed to make cache dir, may already exist', media.hash, targetHeight, err);
    }

    const segmentMetadata = await this.getStreamSegments(media);
    const totalSegments = segmentMetadata.standard.length;
    for (let i = 0; i < totalSegments; i++) {
      const segment = segmentMetadata.standard[i];
      if (!segment) {
        throw new Error('Segment array modified during cache generation');
      }
      const filename = `${Config.get().cachePath}/${media.hash}/${targetHeight}p/data.ts?start=${segment.start}&end=${
        segment.end
      }`;
      const exists = await ImportUtils.exists(filename);
      if (!exists) {
        await this.streamMedia(
          media,
          segment.start,
          segment.end,
          FS.createWriteStream(filename),
          requestedQuality.quality,
          false,
        );
      }

      // Already-cached segments resolve immediately, so re-runs burst through
      // them instead of sitting at a flat percentage.
      if (onProgress && progressContext) {
        // Progress must never be able to fail the transcode (a throwing
        // callback would land in the caller's catch and mark good media as
        // corrupted), so it is swallowed here.
        try {
          onProgress({
            ...progressContext,
            doneSegments: i + 1,
            totalSegments,
            text: `${media.path}: segment ${i + 1}/${totalSegments} (${media.metadata.height}p→${targetHeight}p)`,
          });
        } catch (err) {
          console.warn(`Progress callback failed for ${media.hash}`, err);
        }
      }
    }

    console.log(`Saving metadata for ${media.absolutePath}`);
    // This try block is to avoid it being marked as corrupted if it fails schema validation.
    try {
      await this.database.saveMedia(media.hash, {
        metadata: media.metadata,
      });
    } catch (err) {
      console.log('Failed to save media metadata.', err, media);
    }
  }
}
