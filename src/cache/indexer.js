const MD5File = require('md5-file');
const Util = require('util');
const FFMpeg = require('fluent-ffmpeg');
const GM = require('gm');
const ImportUtils = require('./import-utils');
const Path = require('path');

class Indexer {
    constructor(database, libraryPath, cachePath) {
        this.database = database;
        this.libraryPath = libraryPath;
        this.cachePath = cachePath;
    }

    static async getVideoMetadata(absolutePath) {
        const data = await Util.promisify(FFMpeg.ffprobe)(absolutePath);
        const metadata = {
            length: Math.ceil(data.format.duration),
            qualityCache: []
        };
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

        return metadata;
    }

    static async getImageMetadata(absolutePath) {
        const gm = GM(absolutePath);
        const size = await Util.promisify(gm.size.bind(gm))();
        return {
            width: size.width,
            height: size.height,
            qualityCache: [ size.height ],
            length: 0
        };
    }

    async generateMediaFromFile(file) {
        const absolutePath = Path.resolve(this.libraryPath, file);
        const type = ImportUtils.getType(file);

        const media = {
            path: file,
            dir: Path.dirname(file),
            absolutePath,
            rotation: 0,
            type,
            tags: [],
            actors: [],
            hashDate: Math.floor(Date.now() / 1000),
            corrupted: false,
        };

        try {
            media.hash = await Util.promisify(MD5File)(absolutePath);
            media.metadata = (type === 'video') ?
                (await Indexer.getVideoMetadata(absolutePath)) :
                (await Indexer.getImageMetadata(absolutePath));
        } catch (err) {
            media.corrupted = true;
            console.log(`Error indexing media ${absolutePath}`, err);
        }

        return media;
    }

    async indexFiles(files, statusCallback) {
        for (let i = 0; i < files.length; i++) {
            statusCallback(i, files.length);

            const media = await this.generateMediaFromFile(files[i]);
            const existingMedia = await this.database.getMedia(media.hash);
            if (existingMedia) {
                await this.database.saveMedia(media.hash, {
                    path: media.path
                });
            } else {
                await this.database.saveMedia(media.hash, media);
            }

            statusCallback(i + 1, files.length);
        }
    }
}
module.exports = Indexer;
