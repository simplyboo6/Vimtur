const fs = require('fs');
const path = require('path');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const ffmpeg = require("fluent-ffmpeg");
const rimraf = require('rimraf');
const gm = require('gm');
const utils = require("./utils.js");

ffmpeg.setFfmpegPath(ffmpegStatic.path);
ffmpeg.setFfprobePath(ffprobeStatic.path);

async function getMetadata(path) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(path, function (err, data) {
          if (err) {
              console.log("Error probing file");
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
                  metadata.artist = data.format.tags.artist;
                  metadata.album = data.format.tags.album;
                  metadata.title = data.format.tags.title;
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
            gm(path).size(function(err, value) {
                if (err) {
                    reject(err);
                } else {
                    if (value) {
                        value.length = 0;
                        resolve(value);
                    } else {
                        reject("No EXIF data for image.");
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
    return new Promise((resolve, reject) => {
        rimraf(path, function () {
            resolve();
        });
    });
}

async function exists(path) {
    return new Promise((resolve, reject) => {
        fs.access(path, fs.constants.R_OK, function(err) {
            resolve(!err);
        });
    });
}

async function mkdir(path) {
    console.log(`Making directory ${path}`);
    return new Promise((resolve, reject) => {
        fs.mkdir(path, function() {
            resolve();
        });
    });
}

async function doTranscode(input, output, args) {
    return new Promise((resolve, reject) => {
        const ffm = ffmpeg(input).outputOptions(args).output(output);
        ffm.on('error', function (err, stdout, stderr) {
            console.log(err.message); //this will likely return "code=1" not really useful
            console.log("stdout:\n" + stdout);
            console.log("stderr:\n" + stderr); //this will contain more detailed debugging info
            reject(err.message);
        });
        ffm.on('end', function () {
            resolve();
        });
        ffm.run();
    });
}

async function transcode(hash) {
    const media = global.db.getMedia(hash);
    console.log(`Setting up to transcode ${media.absolutePath}`);
    media.metadata = await getMetadata(media.absolutePath);
    // If any transcoded artefacts exist, remove them.
    await deleteFolder(`${utils.config.cachePath}/${media.hash}`);
    await mkdir(`${utils.config.cachePath}/${media.hash}`);
    console.log(`Transcoding ${media.absolutePath}`);

    let args = ['-start_number', '0', '-hls_time', '10', '-hls_list_size', '0', '-f', 'hls'];
    if (media.metadata.codec == 'h264') {
        console.log('Input format is h264, copying video.')
        args = ['-start_number', '0', '-hls_time', '10', '-hls_list_size', '0', '-vcodec', 'copy', '-f', 'hls'];
    }

    await doTranscode(media.absolutePath, `${utils.config.cachePath}/${media.hash}/index.m3u8`, args);
    await generateThumb(media);
    console.log(`Saving metadata for ${media.absolutePath}`);
    await global.db.updateMedia(media.hash, {
        metadata: media.metadata,
        transcode: false
    });
    console.log('-------------------------------------');
}

async function transcodeSet(set, callback) {
    for (let i = 0; i < set.length; i++) {
        const media = global.db.getMedia(set[i]);
        try {
            if (media.corrupted) {
                console.log(`Skipping corrupted file ${media.absolutePath}`);
            } else {
                await transcode(set[i]);
            }
        } catch(err) {
            console.log(`Failed to transcode ${media.absolutePath}`);
            console.log(err);
            await global.db.updateMedia(media.hash, { corrupted: true });
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
    const images = await global.db.subset({type: ['still', 'gif']}, global.db.getDefaultMap());
    const imagesNotCached = [];
    for (let i = 0; i < images.length; i++) {
        const media = global.db.getMedia(images[i]);
        if (!media.metadata) {
            imagesNotCached.push(images[i]);
        }
    }
    await mkdir(`${utils.config.cachePath}/thumbnails`);
    module.exports.cacheStatus.progress = 0;
    module.exports.cacheStatus.max = imagesNotCached.length;
    if (callback) {
        callback(module.exports.cacheStatus);
    }
    const corruptedImages = [];
    console.log(`${imagesNotCached.length} images not cached.`)
    for (let i = 0; i < imagesNotCached.length; i++) {
        const media = global.db.getMedia(imagesNotCached[i]);
        try {
            if (media.corrupted) {
                console.log(`Skipping corrupted file ${media.absolutePath}`);
                corruptedImages.push(imagesNotCached[i]);
            } else {
                console.log(`Getting metadata for ${media.absolutePath}`);
                const metadata = await getExifData(media.absolutePath);
                await generateThumb(media);
                await global.db.updateMedia(media.hash, { metadata: metadata });
            }
        } catch (err) {
            console.log(err);
            console.log(`Marking ${media.absolutePath} as corrupted.`);
            corruptedImages.push(imagesNotCached[i]);
            await global.db.updateMedia(media.hash, { corrupted: true });
        }
        module.exports.cacheStatus.progress = i;
        if (callback) {
            callback(module.exports.cacheStatus);
        }
    }
    console.log(`${corruptedImages.length} corrupted images.`);

    const videos = await global.db.subset({type: 'video'}, global.db.getDefaultMap());
    console.log(`Videos length: ${videos.length}`);
    const notTranscoded = [];
    const priorityTranscode = [];
    for (let i = 0; i < videos.length; i++) {
        const media = global.db.getMedia(videos[i]);
        if (media.transcode) {
            priorityTranscode.push(videos[i]);
        } else if (!media.metadata) {
            notTranscoded.push(videos[i]);
        }
    }
    console.log(`Videos to transocde: ${notTranscoded.length + priorityTranscode.length}`);

    console.log(`Transcoding ${priorityTranscode.length} priority transcode videos.`);
    module.exports.cacheStatus.state = 'Caching priority videos';
    module.exports.cacheStatus.progress = 0;
    module.exports.cacheStatus.max = priorityTranscode.length;
    if (callback) {
        callback(module.exports.cacheStatus);
    }
    await transcodeSet(priorityTranscode, function(num) {
        module.exports.cacheStatus.progress = num;
        if (callback) {
            callback(module.exports.cacheStatus);
        }
    });

    console.log(`Transcoding ${notTranscoded.length} other videos.`);
    module.exports.cacheStatus.state = 'Caching videos';
    module.exports.cacheStatus.progress = 0;
    module.exports.cacheStatus.max = notTranscoded.length;
    if (callback) {
        callback(module.exports.cacheStatus);
    }
    await transcodeSet(notTranscoded, function(num) {
        module.exports.cacheStatus.progress = num;
        if (callback) {
            callback(module.exports.cacheStatus);
        }
    });

    const allMedia = global.db.getDefaultMap();
    for (let i = 0; i < allMedia.length; i++) {
        const media = global.db.getMedia(allMedia[i]);
        if (media.corrupted) {
            module.exports.cacheStatus.corrupted.push(media.absolutePath);
        }
    }

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
    cacheStatus: {}
};
