const FFMpeg = require('fluent-ffmpeg');
const Util = require('util');
const FS = require('fs');
const Rimraf = require('rimraf');
const Path = require('path');
const Crypto = require('crypto');

// Local
const Config = require('../config');

// Bytes to read from start and end of file.
const CHUNK_SIZE = 64 * 1024;

class ImportUtils {
    static async hash(path) {
        const fd = await Util.promisify(FS.open)(path);
        const buffer = Buffer.alloc(CHUNK_SIZE * 2);
        const [startReadResult, statResult] = await Promise.all([
            Util.promisify(FS.read)(fd, buffer, 0, CHUNK_SIZE, 0),
            Util.promisify(FS.stat)(path)
        ]);

        let total = startReadResult.bytesRead;
        let endStart = statResult.size - CHUNK_SIZE;
        if (endStart <= 0) {
            buffer.copy(buffer, startReadResult.bytesRead, 0);
        } else {
            const endReadResult = await Util.promisify(FS.read)(fd, buffer, startReadResult.bytesRead, CHUNK_SIZE, endStart);
            total += endReadResult.bytesRead;
        }
        await Util.promisify(FS.close)(fd);

        const hash = Crypto.createHash('md5');
        hash.update(buffer.slice(0, total));
        return hash.digest().toString('hex');
    }

    static getType(filename) {
        const ext = Path.extname(filename || '').split('.');
        switch (ext[ext.length - 1].toLowerCase()) {
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'bmp':
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
            return null;
        }
    }

    static isMaxCopyEnabled() {
        return Config.get('transcoder.maxCopyEnabled');
    }

    static getMinQualityForTranscode() {
        return Config.get('transcoder.minQuality');
    }

    static getTranscodeQualities() {
        return Config.get('transcoder.qualities');
    }

    static getMediaDesiredQualities(media) {
        const qualities = ImportUtils.getTranscodeQualities();
        const maxCopy = ImportUtils.isMaxCopyEnabled();
        const minQualityForTranscode = ImportUtils.getMinQualityForTranscode();
        const sourceHeight = media.metadata.height;

        const intermediate = [];
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

        const output = [];
        for (const quality of intermediate) {
            if (!output.find((el) => el.quality === quality)) {
                output.push({
                    quality: quality,
                    copy: quality === sourceHeight && maxCopy
                });
            }
        }

        output.sort();
        if (output.length === 0) {
            throw new Error(`No desired qualities for - ${media.hash}`);
        }
        return output;
    }

    static async transcode(input, output, args) {
        return new Promise((resolve, reject) => {
            const ffm = FFMpeg(input).outputOptions(args).output(output);
            ffm.on('error', (err, stdout, stderr) => {
                console.log(err.message);
                console.log('stdout:\n' + stdout);
                console.log('stderr:\n' + stderr);
                reject(err.message);
            });
            ffm.on('end', resolve);
            ffm.run();
        });
    }

    static async deleteFolder(path) {
        console.log(`Removing ${path}`);
        return await Util.promisify(Rimraf)(path);
    }

    static async exists(path) {
        try {
            await Util.promisify(FS.access)(path, FS.constants.R_OK);
            return true;
        } catch (err) {
            return false;
        }
    }

    static async mkdir(path) {
        const exists = await ImportUtils.exists(path);
        if (!exists) {
            console.log(`Making directory ${path}`);
            return await Util.promisify(FS.mkdir)(path);
        }
    }

    static estimateBandwidthFromQuality(quality) {
        // This makes a vague guess at what the likely bandwidth is.
        return Math.ceil(710.7068 * Math.pow(quality, 1.2665));
    }

    static generatePlaylist(media) {
        const qualities = media.metadata.qualityCache;
        let data = '#EXTM3U';
        // TODO Refactor this to use actual height and maybe actual bandwidth.
        for (const quality of qualities.sort()) {
            const bandwidth = ImportUtils.estimateBandwidthFromQuality(quality);
            // Get width, assume 16:10 for super max HD.
            const width = Math.ceil(quality / 10 * 16);
            const resolution = `${width}x${quality}`;
            data = data + `\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`;
            data = data + `\n${quality}p/index.m3u8`;
        }
        return data;
    }

    static getRedundanctCaches(desiredCachesInput, actualCaches) {
        const desiredCaches = desiredCachesInput.map((el) => {
            return el.quality;
        });
        const redundant = [];
        for (const quality of actualCaches) {
            if (!desiredCaches.includes(quality) && !redundant.includes(quality)) {
                redundant.push(quality);
            }
        }
        return redundant;
    }

    static async wait() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

module.exports = ImportUtils;
