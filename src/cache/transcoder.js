const ImportUtils = require('./import-utils');
const FS = require('fs');
const Util = require('util');

class Transcoder {
    constructor(libraryPath, cachePath, database, transcodeConfig) {
        this.libraryPath = libraryPath;
        this.cachePath = cachePath;
        this.database = database;
        this.config = transcodeConfig;
    }

    async createThumbnail(media) {
        await ImportUtils.mkdir(`${this.cachePath}`);
        await ImportUtils.mkdir(`${this.cachePath}/thumbnails`);

        const path = `${this.cachePath}/thumbnails/${media.hash}.png`;
        const exists = await ImportUtils.exists(path);
        if (!exists) {
            const args = ['-vf', 'thumbnail,scale=200:-1', '-frames:v', '1'];
            if (media.type === 'video') {
                args.push('-ss');
                const offset = Math.ceil(media.metadata.length / 4);
                args.push(`00:00:${(offset >= 60) ? 59 : offset.toFixed(2)}`);
            }
            await ImportUtils.transcode(media.absolutePath, path, args);
        }
    }

    async transcodeMediaToQuality(media, requestedQuality) {
        // TODO Add check for old style media where qualityCache doesn't exist.
        const targetHeight = requestedQuality.quality;
        console.log(`${media.hash}: ${media.path} (source ${media.metadata.height}p) - Transcoding to ${targetHeight}p...`);

        if (media.metadata.qualityCache && media.metadata.qualityCache.includes(targetHeight)) {
            return console.log(`${media.hash}: Already cached at ${targetHeight}p.`);
        }

        media.metadata.qualityCache.push(targetHeight);

        const audioCodec = [ '-acodec', 'aac', '-ac', '1', '-strict', '-2' ];
        let videoCodec = [ 'libx264', '-crf', '23', '-tune', 'film', '-vbsf', 'h264_mp4toannexb' ];
        let scale = [];

        // If max copy is enabled, the requested quality is the source quality and the codec is compatible,
        // then copy the source video directly to the output HLS stream.
        if (media.metadata.codec === 'h264' && requestedQuality.copy) {
            videoCodec = [ 'copy' ];
            console.log('Max copy enabled - copying video codec');
        }

        if (targetHeight !== media.metadata.height) {
            scale = [ '-vf', `scale=-2:${targetHeight}` ];
        }

        const args = [...audioCodec, ...scale, '-vcodec', ...videoCodec, '-f', 'hls', '-hls_time', '10', '-hls_list_size', '0', '-start_number', '0'];

        await ImportUtils.mkdir(`${this.cachePath}/${media.hash}/${targetHeight}p`);
        await ImportUtils.transcode(media.absolutePath, `${this.cachePath}/${media.hash}/${targetHeight}p/index.m3u8`, args);
        await Util.promisify(FS.writeFile)(`${this.cachePath}/${media.hash}/index.m3u8`, ImportUtils.generatePlaylist(media));

        console.log(`Saving metadata for ${media.absolutePath}`);
        // This try block is to avoid it being marked as corrupted if it fails schema validation.
        try {
            await this.database.saveMedia(media.hash, {
                metadata: media.metadata
            });
        } catch (err) {
            console.log('Failed to save media metadata.', err, media);
        }
    }

    async transcodeMedia(media) {
        await ImportUtils.mkdir(`${this.cachePath}/${media.hash}`);
        for (const quality of ImportUtils.getMediaDesiredQualities(this.config, media)) {
            await this.transcodeMediaToQuality(media, quality);
        }
    }

    async transcodeSet(hashList, statusCallback) {
        await ImportUtils.mkdir(`${this.cachePath}`);
        for (let i = 0; i < hashList.length; i++) {
            const media = await this.database.getMedia(hashList[i]);
            try {
                if (media.corrupted) {
                    console.log(`Skipping corrupted file ${media.absolutePath}`);
                } else {
                    await this.transcodeMedia(media);
                }
            } catch(err) {
                console.log(`Failed to transcode ${media.absolutePath}`);
                console.log(err);
                await this.database.saveMedia(media.hash, { corrupted: true });
            }
            if (statusCallback) {
                statusCallback(i, hashList.length);
            }
        }
    }
}

module.exports = Transcoder;
