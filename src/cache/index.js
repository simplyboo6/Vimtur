const Scanner = require('./scanner');
const Indexer = require('./indexer');
const Transcoder = require('./transcoder');
const ImportUtils = require('./import-utils');

class Importer {
    constructor(database, callback) {
        this.database = database;
        this.callback = callback;
        this.indexer = new Indexer(database);
        this.transcoder = new Transcoder(database);
        this.status = {
            state: 'IDLE',
            progress: {
                current: 0,
                max: 0
            }
        };
    }

    getStatus() {
        return this.status;
    }

    setState(state) {
        if (this.status.state !== 'IDLE' && state !== 'IDLE') {
            throw new Error(`Task already in progress ${this.state}, cannot switch to ${state}`);
        }
        switch (state) {
        case 'IDLE':
            this.status.progress = {
                current: 0,
                max: 0
            };
            // Fallthrough.
        case 'SCANNING':
        case 'INDEXING':
        case 'CACHING':
        case 'THUMBNAILS':
            this.status.state = state;
            break;
        default:
            throw new Error(`Attempted to switch to invalid state: ${state}`);
        }
        this.update();
    }

    update() {
        if (this.callback) {
            this.callback(this.status);
        }
    }

    async scan() {
        this.setState('SCANNING');
        console.log('Scanning...');
        console.time('Scan Time');
        try {
            const files = await Scanner.getFileList();
            const mediaList = await this.database.subset({}, {path: 1});
            const normalisedPaths = [];
            for (const media of mediaList) {
                normalisedPaths.push(media.path);
            }
            this.status.scanResults = await Scanner.filterNewAndMissing(normalisedPaths, files);
        } catch (err) {
            console.error('Error scanning library.', err);
            throw err;
        } finally {
            console.timeEnd('Scan Time');
            this.setState('IDLE');
        }
    }

    async index() {
        // If a scan hasn't been run then first do that before indexing.
        if (!this.status.scanResults) {
            await this.scan();
        }

        this.setState('INDEXING');
        console.log('Indexing...');
        console.time('Index Time');
        try {
            await this.indexer.indexFiles(this.status.scanResults.newPaths, (current, max) => {
                this.status.progress = { current, max };
                this.update();
            });
            this.status.scanResults.newPaths = [];
            this.update();
        } catch (err) {
            console.error('Error indexing library.', err);
            throw err;
        } finally {
            console.timeEnd('Index Time');
            this.setState('IDLE');
        }
    }

    async thumbnails() {
        this.setState('THUMBNAILS');
        console.log('Generating thumbnails...');
        try {
            const withoutThumbnails = await this.database.subset({thumbnail: false, corrupted: false});
            this.status.progress = {
                current: 0,
                max: withoutThumbnails.length
            };
            console.log(`${withoutThumbnails.length} media without thumbnails.`);
            for (let i = 0; i < withoutThumbnails.length; i++) {
                try {
                    const media = await this.database.getMedia(withoutThumbnails[i]);
                    const path = media.absolutePath;
                    console.log(`Generating thumbnail for ${path}...`);
                    await this.transcoder.createThumbnail(media);

                    try {
                        await this.database.saveMedia(media.hash, { thumbnail: true });
                    } catch (err) {
                        console.log('Failed to save media thumbnail state.', err, media);
                    }
                } catch (err) {
                    console.log(`Error generating thumbnail for ${withoutThumbnails[i]}.`, err);
                    await this.database.saveMedia(withoutThumbnails[i], { corrupted: true });
                }

                this.status.progress.current = i;
                this.update();

            }
        } catch (err) {
            console.error('Error generating thumbnails.', err);
            throw err;
        } finally {
            this.setState('IDLE');
        }
    }

    async cache() {
        this.setState('CACHING');
        console.log('Caching...');
        console.time('Cache Time');
        try {
            await this.transcoder.transcodeSet(await this.database.subset({type: ['video'], corrupted: false}),
                (current, max) => {
                    this.status.progress = { current, max };
                    this.update();
                });
        } catch (err) {
            console.error('Error caching library.', err);
            throw err;
        } finally {
            console.timeEnd('Cache Time');
            this.setState('IDLE');
        }
    }

    async findRedundantCaches() {
        const redundantMap = {};
        for (const hash of await this.database.subset({type: ['video'], corrupted: false})) {
            const media = await this.database.getMedia(hash);
            if (!media.metadata.qualityCache) {
                continue;
            }
            const desiredCaches = ImportUtils.getMediaDesiredQualities(media);
            const actualCaches = media.metadata.qualityCache;

            const redundant = ImportUtils.getRedundanctCaches(desiredCaches, actualCaches);
            if (redundant.length) {
                redundantMap[hash] = redundant;
            }
        }
        return redundantMap;
    }
}

module.exports = Importer;
