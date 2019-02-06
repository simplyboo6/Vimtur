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
                    metadata.artist = data.format.tags.artist || data.format.tags.album_artist || null;
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

async function transcode(media, quality) {
    console.log(`Setting up to transcode ${media.absolutePath} to ${quality}`);
    if (!media.metadata) {
        console.log(`Fetching metadata for ${media.absolutePath}...`);
        media.metadata = await getMetadata(media.absolutePath);
    }

    let qualityName = quality;
    if (quality === 'MAX') {
        qualityName = getQualityFromHeight(media.metadata.height);
    }
    const qualityInfo = getBandwidthResolution(qualityName);

    if (media.metadata.qualityCache && media.metadata.qualityCache.includes(qualityName)) {
        return console.log(`${media.absolutePath} already cached at ${qualityName}`);
    }

    if (qualityInfo.scale > media.metadata.height) {
        return console.log(`Skipping upscaling to ${qualityName} on ${media.absolutePath}`);
    }

    if (!media.metadata.qualityCache) {
        media.metadata.qualityCache = [];
    }
    media.metadata.qualityCache.push(qualityName);

    // If any transcoded artefacts exist, remove them.
    await deleteFolder(`${utils.config.cachePath}/${media.hash}/${qualityName}`);
    await mkdir(`${utils.config.cachePath}/${media.hash}`);
    await mkdir(`${utils.config.cachePath}/${media.hash}/${qualityName}`);
    console.log(`Transcoding ${media.absolutePath}`);

    const codec = (quality === 'MAX' && media.metadata.codec === 'h264') ? [ 'copy' ] : [ 'libx264', '-crf', '23', '-tune', 'film', '-vbsf', 'h264_mp4toannexb' ];
    const scale = quality === 'MAX' ? [] : [ '-vf', `scale=-2:${qualityInfo.scale}` ];
    const audio = [ '-acodec', 'aac', '-ac', '1', '-strict', '-2' ];
    const args = [...audio, ...scale, '-vcodec', ...codec, '-f', 'hls', '-hls_time', '10', '-hls_list_size', '0', '-start_number', '0'];

    await doTranscode(media.absolutePath, `${utils.config.cachePath}/${media.hash}/${qualityName}/index.m3u8`, args);
    await generateThumb(media);
    await Util.promisify(fs.writeFile)(`${utils.config.cachePath}/${media.hash}/index.m3u8`, generatePlaylist(media.metadata.qualityCache));
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
                for (const quality of utils.config.videoQualities) {
                    console.time(`transcode: ${media.hash} ${quality}`);
                    await transcode(media, quality);
                    console.timeEnd(`transcode: ${media.hash} ${quality}`);
                }
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

    // Video re-encoding section.
    // Start by checking for already transcoded but without a proper index.
    {
        console.log('Fixing videos without a quality setting...');
        const videos = await global.db.subset({type: ['video'], cached: true, corrupted: false, quality: { none: '*' }});
        module.exports.cacheStatus.state = 'Fixing videos without a quality setting';
        module.exports.cacheStatus.progress = 0;
        module.exports.cacheStatus.max = videos.length;
        if (callback) {
            callback(module.exports.cacheStatus);
        }
        for (let i = 0; i < videos.length; i++) {
            console.log(`Checking ${videos[i]}...`);
            const video = await global.db.getMedia(videos[i]);
            if (!video.metadata.qualityCache) {
                console.log('Fixing up transcoding index for: ' + video.hash);
                const files = await Util.promisify(fs.readdir)(`${utils.config.cachePath}/${video.hash}`);
                await mkdir(`${utils.config.cachePath}/${video.hash}/${getQualityFromHeight(video.metadata.height)}/`);
                for (const file of files) {
                    await Util.promisify(fs.rename)(
                        `${utils.config.cachePath}/${video.hash}/${file}`,
                        `${utils.config.cachePath}/${video.hash}/${getQualityFromHeight(video.metadata.height)}/${file}`
                    );
                }
                await Util.promisify(fs.writeFile)(`${utils.config.cachePath}/${video.hash}/index.m3u8`, generatePlaylist([getQualityFromHeight(video.metadata.height)]));
                await global.db.saveMedia(video.hash, {
                    metadata: { qualityCache: [ getQualityFromHeight(video.metadata.height) ] }
                });
            }

            module.exports.cacheStatus.progress = i;
            if (callback) {
                callback(module.exports.cacheStatus);
            }
        }
    }

    const videos = await global.db.subset({type: ['video']});
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
    console.log('Caching complete.');
}

function getBandwidthResolution(quality) {
    switch (quality) {
    case '144p':
        return { resolution: '256x144', bandwidth: 400000, scale: 144 };
    case '240p':
        return { resolution: '426x240', bandwidth: 700000, scale: 240 };
    case '360p':
        return { resolution: '640x360', bandwidth: 1200000, scale: 360 };
    case '480p':
        return { resolution: '854x480', bandwidth: 1800000, scale: 480 };
    case '720p':
        return { resolution: '1280x720', bandwidth: 3000000, scale: 720 };
    case '1080p':
        return { resolution: '1920x1080', bandwidth: 7000000, scale: 1080 };
    }
    throw new Error(`Unknown quality ${quality}`);
}

function generatePlaylist(qualities) {
    let data = '#EXTM3U';
    for (const quality of qualities.sort()) {
        const res = getBandwidthResolution(quality);
        data = data + `\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=${res.bandwidth},RESOLUTION=${res.resolution}`;
        data = data + `\n${quality}/index.m3u8`;
    }
    return data;
}

function getQualityFromHeight(height) {
    const map = [ 144, 240, 360, 480, 720, 1080 ];
    for (const quality of map) {
        if (quality >= height) {
            return `${quality}p`;
        }
    }
    return '1080p';
}

module.exports = {
    runCache,
    generateThumb,
    getMetadata,
    cacheStatus: {}
};
