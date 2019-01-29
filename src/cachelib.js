const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const rimraf = require('rimraf');
const gm = require('gm');
const utils = require('./utils.js');
const Util = require('util');

async function getMetadata(path) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(path, (err, data) => {
            if (err) {
                console.log('Error probing file');
                console.log(err);
                reject(err);
            } else {
                const metadata = {};
                for (let i = 0; i < data.streams.length; i++) {
                    if (data.streams[i].codec_type == 'video') {
                        metadata.width = data.streams[i].coded_width;
                        metadata.height = data.streams[i].coded_height;
                        metadata.codec = data.streams[i].codec_name;
                        break;
                    }
                }
                if (data.format.tags) {
                    metadata.artist = data.format.tags.artist || null;
                    metadata.album = data.format.tags.album || null;
                    metadata.title = data.format.tags.title || null;
                }
                metadata.length = Math.ceil(data.format.duration);
                resolve(metadata);
            }
        });
    });
}

async function getExifData(path) {
    return new Promise((resolve, reject) => {
        try {
            gm(path).size((err, value) => {
                if (err) {
                    reject(err);
                } else {
                    if (value) {
                        value.length = 0;
                        resolve(value);
                    } else {
                        reject('No EXIF data for image.');
                    }
                }
            });
        } catch (error) {
            console.log('Error: ' + error.message);
            reject(error);
        }
    });
}

async function deleteFolder(path) {
    console.log(`Removing ${path}`);
    return await Util.promisify(rimraf)(path);
}

async function exists(path) {
    return new Promise((resolve) => {
        fs.access(path, fs.constants.R_OK, (err) => {
            resolve(!err);
        });
    });
}

async function mkdir(path) {
    if (!(await exists(path))) {
        console.log(`Making directory ${path}`);
        return await new Promise((resolve) => {
            fs.mkdir(path, () => {
                resolve();
            });
        });
    }
}

async function doTranscode(input, output, args) {
    return new Promise((resolve, reject) => {
        const ffm = ffmpeg(input).outputOptions(args).output(output);
        ffm.on('error', (err, stdout, stderr) => {
            console.log(err.message); //this will likely return "code=1" not really useful
            console.log('stdout:\n' + stdout);
            console.log('stderr:\n' + stderr); //this will contain more detailed debugging info
            reject(err.message);
        });
        ffm.on('end', resolve);
        ffm.run();
    });
}

async function transcode(hash) {
    const media = await global.db.getMedia(hash);
    console.log(`Setting up to transcode ${media.absolutePath}`);
    media.metadata = await getMetadata(media.absolutePath);
    // If any transcoded artefacts exist, remove them.
    await deleteFolder(`${utils.config.cachePath}/${media.hash}`);
    await mkdir(`${utils.config.cachePath}/${media.hash}`);
    console.log(`Transcoding ${media.absolutePath}`);

    let args = ['-start_number', '0', '-hls_time', '10', '-hls_list_size', '0', '-f', 'hls'];
    if (media.metadata.codec == 'h264') {
        console.log('Input format is h264, copying video.');
        args = ['-start_number', '0', '-hls_time', '10', '-hls_list_size', '0', '-vcodec', 'copy', '-f', 'hls'];
    }

    await doTranscode(media.absolutePath, `${utils.config.cachePath}/${media.hash}/index.m3u8`, args);
    await generateThumb(media);
    console.log(`Saving metadata for ${media.absolutePath}`);
    // This try block is to avoid it being marked as corrupted if it fails schema validation.
    try {
        await global.db.saveMedia(media.hash, {
            metadata: media.metadata
        });
    } catch (err) {
        console.log('Failed to save media metadata.', err, media);
    }
    console.log('-------------------------------------');
}

async function transcodeSet(set, callback) {
    for (let i = 0; i < set.length; i++) {
        const media = await global.db.getMedia(set[i]);
        try {
            if (media.corrupted) {
                console.log(`Skipping corrupted file ${media.absolutePath}`);
            } else {
                await transcode(set[i]);
            }
        } catch(err) {
            console.log(`Failed to transcode ${media.absolutePath}`);
            console.log(err);
            await global.db.saveMedia(media.hash, { corrupted: true });
        }
        if (callback) {
            callback(i);
        }
    }
}

async function generateThumb(media) {
    const path = `${utils.config.cachePath}/thumbnails/${media.hash}.png`;
    if (!(await exists(path))) {
        const args = ['-vf', 'thumbnail,scale=200:-1', '-frames:v', '1'];
        if (media.type == 'video') {
            args.push('-ss');
            let offset = Math.ceil(media.metadata.length / 4);
            args.push(`00:00:${(offset >= 60) ? 59 : offset.toFixed(2)}`);
        }
        await doTranscode(media.absolutePath, path, args);
    }
}

async function runCache(callback) {
    await mkdir(utils.config.cachePath);
    await mkdir(path.resolve(utils.config.cachePath, 'thumbnails'));
    module.exports.cacheStatus = { state: 'Caching image metadata and thumbnails', corrupted: [] };
    // Image metadata extraction first.
    const imagesNotCached = await global.db.subset({type: ['still', 'gif'], cached: false});

    await mkdir(`${utils.config.cachePath}/thumbnails`);
    module.exports.cacheStatus.progress = 0;
    module.exports.cacheStatus.max = imagesNotCached.length;
    if (callback) {
        callback(module.exports.cacheStatus);
    }

    console.log(`${imagesNotCached.length} images not cached.`);
    for (let i = 0; i < imagesNotCached.length; i++) {
        const media = await global.db.getMedia(imagesNotCached[i]);
        try {
            console.log(`Getting metadata for ${media.absolutePath}`);
            const metadata = await getExifData(media.absolutePath);
            await generateThumb(media);
            await global.db.saveMedia(media.hash, { metadata });
        } catch (err) {
            console.log(`Marking ${media.absolutePath} as corrupted.`, err);
            await global.db.saveMedia(media.hash, { corrupted: true });
        }
        module.exports.cacheStatus.progress = i;
        if (callback) {
            callback(module.exports.cacheStatus);
        }
    }

    const videos = await global.db.subset({type: ['video'], cached: false});
    console.log(`Videos to transocde: ${videos.length}`);

    module.exports.cacheStatus.state = 'Caching videos';
    module.exports.cacheStatus.progress = 0;
    module.exports.cacheStatus.max = videos.length;
    if (callback) {
        callback(module.exports.cacheStatus);
    }
    await transcodeSet(videos, (num) => {
        module.exports.cacheStatus.progress = num;
        if (callback) {
            callback(module.exports.cacheStatus);
        }
    });

    module.exports.cacheStatus.corrupted = await global.db.subset({corrupted: true}, {path: 1});

    module.exports.cacheStatus.state = 'Caching complete';
    module.exports.cacheStatus.progress = 100;
    module.exports.cacheStatus.max = 100;
    if (callback) {
        callback(module.exports.cacheStatus);
    }
}

module.exports = {
    runCache,
    generateThumb,
    getMetadata,
    cacheStatus: {}
};
