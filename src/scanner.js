const Utils = require('./utils');

class Scanner {
    constructor(callback) {
        this.state = "IDLE";
        this.callback = callback;
    }

    async scan() {
        if (this.state !== "IDLE") {
            return false;
        }
        this.state = "SCANNING";
        this.updateStatus();

        console.log("Initiating file scan.");
        const returns = await Utils.scan();
        console.log("File scan complete.");
        console.log(returns.newFiles.length + " new files");
        console.log(returns.verifiedFiles.length + " file paths verified");
        console.log(returns.missing.length + " files missing");
        returns.time = Date.now();
        this.scanStatus = returns;
        this.state = "IDLE";
        this.updateStatus();
    }

    async index(deleteClones) {
        if (this.state !== "IDLE") {
            return false;
        }
        this.state = "INDEXING";
        this.importStatus = {
            current: 0,
            max: this.scanStatus.newFiles.length
        };
        this.updateStatus();

        await Utils.generateMediaFromFiles(this.scanStatus.newFiles,
            async (iterator, media) => {
                if (global.db.getMedia(media.hash)) {
                    if (deleteClones) {
                        fs.unlink(media.absolutePath, function() {
                            console.log("Deleted: " + media.absolutePath);
                        });
                    } else {
                        console.log("Updating path for " + global.db.getMedia(media.hash).absolutePath + " to " + media.absolutePath);
                        const newMedia = global.db.getMedia(media.hash);
                        newMedia.absolutePath = media.absolutePath;
                        newMedia.dir = media.dir;
                        newMedia.path = media.path;
                        newMedia.hashDate = Math.floor(Date.now() / 1000);
                        await global.db.updateMedia(newMedia.hash, newMedia);
                    }
                } else {
                    console.log("Adding " + media.absolutePath + " to database.");
                    await global.db.updateMedia(media.hash, media);
                }
                this.importStatus.current = iterator;
                this.updateStatus();
            });
        this.state = "IDLE";
        this.updateStatus();
        await this.scan();
    }

    async cache() {
        if (this.state !== "IDLE") {
            return false;
        }
        this.state = "CACHING";
        this.updateStatus();
        await Cache.runCache(async() => {
            this.cacheStatus = await this.getCacheStatus();
            this.updateStatus();
        });
        this.state = "IDLE";
        this.updateStatus();
    }

    async getCacheStatus() {
        const videos = await global.db.subset({type: ['video']});
        const max = videos.length;
        let corrupted = 0;
        for (let i = 0; i < videos.length; i++) {
            if (global.db.getMedia(videos[i]).corrupted) {
                corrupted++;
            }
        }
        const cached = global.db.cropImageMap(videos).length;
        return {
            cached: cached,
            max: max,
            corrupted: corrupted,
            converter: Cache.cacheStatus
        };
    }

    getStatus(verbose) {
        const status = {
            state: this.state,
            libraryPath: utils.config.libraryPath,
            importStatus: this.importStatus,
            cacheStatus: this.cacheStatus,
            scanStatus: null
        }
        if (this.scanStatus) {
            status.scanStatus = Utils.slimScannerStatus(this.scanStatus);
            if (verbose) {
                status.scanStatus.newFiles = this.scanStatus.newFiles;
                status.scanStatus.missingFiles = this.scanStatus.missingFiles;
            }
        }
        return status;
    }

    updateStatus() {
        if (this.callback) {
            this.callback(this.getStatus());
        }
    }

    async deleteMissing() {
        if (!this.scanStatus) {
            console.log("Cannot delete missing without a scan first");
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
        const map = global.db.getDefaultMap();
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
