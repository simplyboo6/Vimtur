const Utils = require('./utils');
const FS = require('fs');
const Cache = require('./cachelib');

class Scanner {
    constructor(callback) {
        this.state = 'IDLE';
        this.callback = callback;
    }

    async scan() {
        if (this.state !== 'IDLE') {
            return false;
        }
        this.state = 'SCANNING';
        this.updateStatus();

        console.log('Initiating file scan.');
        const returns = await Utils.scan();
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

        await Utils.generateMediaFromFiles(this.scanStatus.newFiles,
            async (iterator, media) => {
                const mediaRecord = await global.db.getMedia(media.hash);
                if (mediaRecord) {
                    if (deleteClones) {
                        FS.unlink(mediaRecord.absolutePath, function() {
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
            status.scanStatus = Utils.slimScannerStatus(this.scanStatus);
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
}

module.exports = Scanner;
