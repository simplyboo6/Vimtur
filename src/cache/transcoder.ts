import FS from 'fs';
import Rimraf from 'rimraf';
import Stream from 'stream';
import Util from 'util';

import { Database, Media } from '../types';
import { ImportUtils, Quality } from './import-utils';
import Config from '../config';

export class Transcoder {
  private database: Database;
  public constructor(database: Database) {
    this.database = database;
  }

  public async createThumbnail(media: Media): Promise<void> {
    if (!media.metadata) {
      throw new Error(`Can't create thumbnail for media without metadata`);
    }
    await ImportUtils.mkdir(Config.get().cachePath);
    await ImportUtils.mkdir(`${Config.get().cachePath}/thumbnails`);

    const path = `${Config.get().cachePath}/thumbnails/${media.hash}.png`;
    const args = ['-vf', 'thumbnail,scale=200:-1', '-frames:v', '1'];
    if (media.type === 'video') {
      if (!media.metadata.length) {
        throw new Error(`Can't get thumbnail for video with no length`);
      }
      args.push('-ss');
      const offset = Math.ceil(media.metadata.length / 4);
      args.push(`00:00:${offset >= 60 ? 59 : offset.toFixed(2)}`);
    }
    await ImportUtils.transcode(media.absolutePath, path, args);
  }

  public async transcodeSet(
    hashList: string[],
    statusCallback?: (current: number, max: number) => void,
  ): Promise<void> {
    await ImportUtils.mkdir(`${Config.get().cachePath}`);
    for (let i = 0; i < hashList.length; i++) {
      const media = await this.database.getMedia(hashList[i]);
      if (!media) {
        console.warn(`Could not find media to transcode: ${hashList[i]}`);
        continue;
      }
      try {
        if (media.corrupted) {
          console.log(`Skipping corrupted file ${media.absolutePath}`);
        } else {
          await this.transcodeMedia(media);
        }
      } catch (err) {
        console.error(`Failed to transcode ${media.absolutePath}`, err);
        await this.database.saveMedia(media.hash, { corrupted: true });
      }
      if (statusCallback) {
        statusCallback(i, hashList.length);
      }
    }
  }

  public async streamMedia(
    media: Media,
    start: number,
    end: number,
    stream: Stream.Writable,
    targetHeight?: number,
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
    inputOptions.push(...['-to', String(end)]);

    const audioCodec = ['-acodec', 'aac', '-ac', '1', '-strict', '-2'];

    const videoCodec = ['-vcodec'];
    if (
      media.metadata.codec === 'h264' &&
      (!targetHeight || targetHeight === media.metadata.height)
    ) {
      videoCodec.push('copy');
    } else {
      videoCodec.push(
        ...[
          'libx264',
          '-bsf:v',
          'h264_mp4toannexb',
          '-crf',
          '23',
          '-tune',
          'film',
          '-deadline',
          'realtime',
          '-preset',
          'superfast',
        ],
      );
    }

    const scale =
      targetHeight && targetHeight !== media.metadata.height
        ? ['-vf', `scale=-2:${targetHeight}`]
        : [];

    const args = [...audioCodec, ...scale, ...videoCodec, '-f', 'mpegts', '-muxdelay', '0'];

    await ImportUtils.transcode(media.absolutePath, stream, args, inputOptions);
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

    const audioCodec = ['-acodec', 'aac', '-ac', '1', '-strict', '-2'];
    let videoCodec = ['libx264', '-crf', '23', '-tune', 'film', '-vbsf', 'h264_mp4toannexb'];
    let scale: string[] = [];

    // If max copy is enabled, the requested quality is the source quality and the codec is compatible,
    // then copy the source video directly to the output HLS stream.
    if (media.metadata.codec === 'h264' && requestedQuality.copy) {
      videoCodec = ['copy'];
      console.log('Max copy enabled - copying video codec');
    }

    if (targetHeight !== media.metadata.height) {
      scale = ['-vf', `scale=-2:${targetHeight}`];
    }

    const args = [
      ...audioCodec,
      ...scale,
      '-vcodec',
      ...videoCodec,
      '-f',
      'hls',
      '-hls_time',
      '10',
      '-hls_list_size',
      '0',
      '-start_number',
      '0',
    ];

    await ImportUtils.mkdir(`${Config.get().cachePath}/${media.hash}/${targetHeight}p`);
    await ImportUtils.transcode(
      media.absolutePath,
      `${Config.get().cachePath}/${media.hash}/${targetHeight}p/index.m3u8`,
      args,
    );
    await Util.promisify(FS.writeFile)(
      `${Config.get().cachePath}/${media.hash}/index.m3u8`,
      ImportUtils.generatePlaylist(media),
    );

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

  private async transcodeMedia(media: Media): Promise<void> {
    if (!media.metadata) {
      throw new Error(`Can't transcode media set without metadata`);
    }

    const desiredCaches = ImportUtils.getMediaDesiredQualities(media);
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
      console.log(`${media.hash}: Writing index.m3u8...`);
      await Util.promisify(FS.writeFile)(
        `${Config.get().cachePath}/${media.hash}/index.m3u8`,
        ImportUtils.generatePlaylist(media),
      );
      console.log(`${media.hash}: Saving quality list...`);
      await this.database.saveMedia(media.hash, {
        metadata: {
          qualityCache: media.metadata.qualityCache,
        },
      });
    }
  }
}
