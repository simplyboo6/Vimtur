const FS = require('fs');
const Walk = require('walk');
const MD5File = require('md5-file');
const Util = require('util');
const Path = require('path');

const Cache = require('./cachelib');
const Utils = require('./utils');

class Scanner {
    constructor(callback) {
        this.state = 'IDLE';
        this.callback = callback;
    }

    slimScannerStatus(scannerStatus, includeExtra = false) {
        const status = {
            time: scannerStatus.time,
            missing: scannerStatus.missing
        };
        if (scannerStatus.newFiles != undefined) {
            status.numNew = scannerStatus.newFiles.length;
        }
        if (scannerStatus.verifiedFiles != undefined) {
            status.numVerified = scannerStatus.verifiedFiles.length;
        }
        if (includeExtra) {
            status.newFiles = scannerStatus.newFiles;
        }
        return status;
    }

    async scan() {
        if (this.state !== 'IDLE') {
            return false;
        }
        this.state = 'SCANNING';
        this.updateStatus();

        console.log('Initiating file scan.');
        const returns = await LibraryScanner.scan();
        console.log('File scan complete.');
        console.log(returns.newFiles.length + ' new files');
        console.log(returns.verifiedFiles.length + ' file paths verified');
        console.log(returns.missing.length + ' files missing');
        returns.time = Date.now();
        this.scanStatus = returns;
        this.state = 'IDLE';
        this.updateStatus();
    }

    async index(deleteClones) {
        if (this.state !== 'IDLE') {
            return false;
        }
        this.state = 'INDEXING';
        this.importStatus = {
            current: 0,
            max: this.scanStatus.newFiles.length
        };
        this.updateStatus();

        await Scanner.generateMediaFromFiles(this.scanStatus.newFiles,
            async (iterator, media) => {
                const mediaRecord = await global.db.getMedia(media.hash);
                if (mediaRecord) {
                    if (deleteClones) {
                        FS.unlink(mediaRecord.absolutePath, (err) => {
                            if (err) {
                                return console.log('Failed to delete: ' + mediaRecord.absolutePath, err);
                            }
                            console.log('Deleted: ' + mediaRecord.absolutePath);
                        });
                    } else {
                        console.log('Updating path for ' + mediaRecord.absolutePath + ' to ' + media.absolutePath);
                        mediaRecord.absolutePath = media.absolutePath;
                        mediaRecord.dir = media.dir;
                        mediaRecord.path = media.path;
                        mediaRecord.hashDate = Math.floor(Date.now() / 1000);
                        await global.db.saveMedia(mediaRecord.hash, mediaRecord);
                    }
                } else {
                    console.log('Adding ' + media.absolutePath + ' to database.');
                    await global.db.saveMedia(media.hash, media);
                }
                this.importStatus.current = iterator;
                this.updateStatus();
            });
        this.state = 'IDLE';
        await this.updateStatus();
        await this.scan();
    }

    async cache() {
        if (this.state !== 'IDLE') {
            return false;
        }
        this.state = 'CACHING';
        this.updateStatus();
        await Cache.runCache(async() => {
            this.cacheStatus = await this.getCacheStatus();
            this.updateStatus();
        });
        this.state = 'IDLE';
        this.updateStatus();
    }

    async getCacheStatus() {
        const corruptedVideos = await global.db.subset({type: ['video'], corrupted: true});
        const validVideos = await global.db.subset({type: ['video'], corrupted: false});
        const cachedVideos = await global.db.subset({type: ['video'], cached: true, corrupted: false});

        return {
            cached: cachedVideos.length,
            max: corruptedVideos.length + validVideos.length,
            corrupted: corruptedVideos.length,
            converter: Cache.cacheStatus
        };
    }

    getStatus(verbose) {
        const status = {
            state: this.state,
            libraryPath: Utils.config.libraryPath,
            importStatus: this.importStatus,
            cacheStatus: this.cacheStatus,
            scanStatus: null
        };
        if (this.scanStatus) {
            status.scanStatus = this.slimScannerStatus(this.scanStatus);
            if (verbose) {
                status.scanStatus.newFiles = this.scanStatus.newFiles;
                status.scanStatus.missingFiles = this.scanStatus.missingFiles;
            }
        }
        return status;
    }

    async updateStatus() {
        this.cacheStatus = await this.getCacheStatus();
        if (this.callback) {
            this.callback(this.getStatus());
        }
    }

    async deleteMissing() {
        if (!this.scanStatus) {
            console.log('Cannot delete missing without a scan first');
            return false;
        }
        const missing = this.scanStatus.missing;
        if (missing) {
            for (let i = 0; i < missing.length; i++) {
                console.log(`Deleting missing image ${missing[i].hash}`);
                await global.db.removeMedia(missing[i].hash);
            }
        }
    }

    async deleteCorrupted() {
        const map = await global.db.subset();
        for (let i = 0; i < map.length; i++) {
            const media = global.db.getMedia(map[i]);
            if (media.corrupted) {
                console.log(`Deleting corrupted media ${media.path}`);
                if (await global.db.removeMedia(media.hash)) {
                    Utils.deleteMedia(media);
                    console.log(`${media.hash} deleted.`);
                } else {
                    console.log(`Failed to delete ${media.hash}`);
                }
            }
        }
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

    static async generateMediaFromFiles(fileList, status) {
        const mediaList = [];
        for (let i = 0; i < fileList.length; i++) {
            console.log('Generating data for: ' + fileList[i]);
            const absolutePath = Path.resolve(Utils.config.libraryPath, fileList[i]);
            const media = {
                hash: await Util.promisify(MD5File)(absolutePath),
                path: fileList[i],
                dir: Path.dirname(fileList[i]),
                absolutePath,
                rotation: 0,
                type: Scanner.getType(fileList[i]),
                tags: [],
                actors: [],
                hashDate: Math.floor(Date.now() / 1000),
                corrupted: false
            };
            mediaList.push(media);
            if (status) {
                status(i, media);
            }
        }
        return mediaList;
    }
}

class LibraryScanner {
    static buildPathMap(inputs) {
        const list = [];
        for (const input of inputs) {
            list[input.path] = input;
        }
        return list;
    }

    static async scan() {
        const map = await global.db.subset({}, {path: 1});
        console.log('Creating files list for library: ' + Utils.config.libraryPath);
        const returns = {
            newFiles: [],
            verifiedFiles: [],
            missing: []
        };
        const foundFileMap = [];

        const knownPathList = LibraryScanner.buildPathMap(map);
        const options = {
            followLinks: false
        };
        const walker = Walk.walk(Utils.config.libraryPath, options);

        walker.on('file', (root, fileStats, next) => {
            if (Scanner.getType(fileStats.name)) {
                const relativePath = Path.relative(Utils.config.libraryPath, Path.resolve(root, fileStats.name));
                const existingImage = knownPathList[relativePath];
                if (existingImage) {
                    returns.verifiedFiles.push(relativePath);
                } else {
                    returns.newFiles.push(relativePath);
                }
                foundFileMap[relativePath] = true;
            }
            next();
        });

        return new Promise((resolve) => {
            walker.on('end', () => {
                for (const media of map) {
                    if (!foundFileMap[media.path]) {
                        returns.missing.push(media);
                    }
                }

                console.log(`Scan complete: missing(${returns.missing.length}), verified(${returns.verifiedFiles.length}), new(${returns.newFiles.length}).`);

                resolve(returns);
            });
        });
    }
}

module.exports = Scanner;
