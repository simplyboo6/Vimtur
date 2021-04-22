import FS from 'fs';
import GM from 'gm';
import Path from 'path';
import Rimraf from 'rimraf';
import Stream from 'stream';
import Util from 'util';

import { Database, Media, SegmentMetadata } from '../types';
import { ImportUtils, Quality } from './import-utils';
import Config from '../config';

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

    const inputOptions: string[] = [];
    if (media.metadata.length > 10) {
      const offset = Math.ceil(media.metadata.length / 4);
      inputOptions.push('-ss');
      inputOptions.push(`00:00:${offset >= 60 ? 59 : offset.toFixed(2)}`);
    }
    await ImportUtils.transcode(media.absolutePath, path, args, inputOptions);
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

    const args = [
      '-y',
      '-vf',
      `fps=1/${fps},scale=-1:${height},tile=${columns}x${cellsPerColumn}`,
      '-frames:v',
      '1',
    ];
    const path = `${Config.get().cachePath}/previews/${media.hash}.png`;
    await ImportUtils.transcode(media.absolutePath, path, args);
  }

  public getThumbnailPath(media: Media): string {
    return `${Config.get().cachePath}/thumbnails/${media.hash}.png`;
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
      gm.write(output, err => {
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

    if (end > media.metadata.length) {
      throw new Error('Requested end after end of video');
    }

    const inputOptions = ['-copyts'];
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
      const qualityRaw = ImportUtils.calculateBandwidthFromQuality(
        targetHeight || media.metadata.height,
        media,
        true,
      );
      const quality = `${Math.ceil(qualityRaw / 1000000)}M`;
      const qualityBuffer = `${Math.ceil((qualityRaw * 2) / 1000000)}M`;

      videoCodec.push(
        ...[
          'libx264',
          '-bsf:v',
          'h264_mp4toannexb',
          '-tune',
          'film',
          ...(realtime
            ? ['-quality', 'realtime', '-preset', 'ultrafast']
            : ['-quality', 'good', '-preset', 'medium']),
          '-maxrate',
          quality,
          '-bufsize',
          qualityBuffer,
        ],
      );
    }

    // To deal with strange overflows in corner cases.
    videoCodec.push(...['-max_muxing_queue_size', '9999']);

    const scale =
      targetHeight && targetHeight !== media.metadata.height
        ? ['-vf', `scale=-2:${targetHeight}`]
        : [];

    const args = ['-y', ...audioCodec, ...scale, ...videoCodec, '-f', 'mpegts', '-muxdelay', '0'];

    await ImportUtils.transcode(media.absolutePath, stream, args, inputOptions);
  }

  public async transcodeMedia(media: Media): Promise<void> {
    if (!media.metadata) {
      throw new Error(`Can't transcode media set without metadata`);
    }

    const desiredCaches = ImportUtils.getMediaDesiredQualities(
      media,
      Config.get().transcoder.cacheQualities,
    );
    const actualCaches = media.metadata.qualityCache || [];
    const missingQualities: Quality[] = [];
    for (const quality of desiredCaches) {
      if (!actualCaches.find(el => quality.quality === el)) {
        missingQualities.push(quality);
      }
    }

    if (missingQualities.length) {
      console.log(`${media.hash}: ${missingQualities.length} missing quality caches detected.`);
      await ImportUtils.mkdir(`${Config.get().cachePath}/${media.hash}`);
      for (const quality of missingQualities) {
        await this.transcodeMediaToQuality(media, quality);
      }
    }
    // Find redundant caches.
    const redundant = ImportUtils.getRedundanctCaches(desiredCaches, actualCaches);
    if (redundant.length) {
      console.log(`${media.hash}: ${redundant.length} redundant caches detected.`);
      for (const quality of redundant) {
        console.log(`${media.hash}: Removing quality ${quality}p...`);
        await Util.promisify(Rimraf)(`${Config.get().cachePath}/${media.hash}/${quality}p`);
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
      const indexPath = Path.resolve(
        Config.get().cachePath,
        media.hash,
        `${quality}p`,
        'index.m3u8',
      );
      if (await ImportUtils.exists(indexPath)) {
        const cached = await Util.promisify(FS.readFile)(indexPath);
        return cached.toString();
      }
    }

    const segments = await this.getStreamSegments(media);

    return ImportUtils.generateStreamPlaylist(media, segments);
  }

  public async getStreamSegments(media: Media): Promise<SegmentMetadata> {
    const segments = media.metadata?.segments || (await ImportUtils.generateSegments(media));

    if (Config.get().transcoder.enableCachingKeyframes && !media.metadata?.segments) {
      await this.database.saveMedia(media.hash, {
        metadata: {
          segments,
        },
      });
    }

    return segments;
  }

  private async transcodeMediaToQuality(media: Media, requestedQuality: Quality): Promise<void> {
    if (!media.metadata) {
      throw new Error(`Can't transcode media without metadata`);
    }
    const targetHeight = requestedQuality.quality;
    console.log(
      `${media.hash}: ${media.path} (source ${media.metadata.height}p) - Transcoding to ${targetHeight}p...`,
    );

    media.metadata.qualityCache = media.metadata.qualityCache || [];

    if (media.metadata.qualityCache.includes(targetHeight)) {
      console.log(`${media.hash}: Already cached at ${targetHeight}p.`);
      return;
    }

    media.metadata.qualityCache.push(targetHeight);

    await ImportUtils.deleteFolder(`${Config.get().cachePath}/${media.hash}/${targetHeight}p`);
    await ImportUtils.mkdir(`${Config.get().cachePath}/${media.hash}/${targetHeight}p`);

    const segmentMetadata = await this.getStreamSegments(media);
    for (const segment of segmentMetadata.standard) {
      const filename = `${Config.get().cachePath}/${media.hash}/${targetHeight}p/data.ts?start=${
        segment.start
      }&end=${segment.end}`;
      await this.streamMedia(
        media,
        segment.start,
        segment.end,
        FS.createWriteStream(filename),
        requestedQuality.quality,
        false,
      );
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
