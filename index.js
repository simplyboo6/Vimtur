const path = require('path');
const express = require('express');
const app = express();
const Server = require('http');
const IO = require('socket.io');
const fs = require('fs');
const utils = require("./src/utils.js");
const Database = require('./src/database');
const auth = require('http-auth');
const Cache = require('./src/cachelib.js');
const compression = require('compression');
const rimraf = require('rimraf');
const pathIsInside = require("path-is-inside");

const basicAuth = utils.authConnector;

const configCheckConnector = async function (req, res, next) {
    try {
        await utils.isSetup();
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
    next();
};

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
        const returns = await utils.scan();
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

        const $this = this;
        await utils.generateMediaFromFiles(this.scanStatus.newFiles,
            async function(iterator, media) {
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
                $this.importStatus.current = iterator;
                $this.updateStatus();
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
        const $this = this;
        await Cache.runCache(async function() {
            $this.cacheStatus = await $this.getCacheStatus();
            $this.updateStatus();
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

    getStatus() {
        const status = {
            state: this.state,
            libraryPath: utils.config.libraryPath,
            importStatus: this.importStatus,
            cacheStatus: this.cacheStatus,
            scanStatus: null
        }
        if (this.scanStatus) {
            status.scanStatus = utils.slimScannerStatus(this.scanStatus);
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
}

const scanner = new Scanner(function(status) {
    if (global.io) {
        global.io.sockets.emit('scanStatus', status);
    }
});

async function saveMetadata(hash, metadata) {
    const media = global.db.getMedia(hash);
    if (!media) {
        console.log('Media not found');
        return false;
    }
    if (!media.metadata) {
        console.log('Media does not have metadata');
        return false;
    }
    function valid(field) {
        return field !== undefined && field !== null;
    }
    if (!valid(metadata.artist) && !valid(metadata.title) && !valid(metadata.album)) {
        console.log('Must specify artist, album or title');
        return false;
    }
    metadata.artist = valid(metadata.artist) ? metadata.artist : media.metadata.artist;
    metadata.album = valid(metadata.album) ? metadata.album : media.metadata.album;
    metadata.title = valid(metadata.title) ? metadata.title : media.metadata.title;
    await global.db.updateMedia(media.hash, { metadata: metadata });
    return true;
}

app.use(compression({level: 9}));

if (utils.config.username && utils.config.password) {
    app.use(auth.connect(basicAuth));
}

app.get('/api/scanner/status', configCheckConnector, function (req, res) {
    res.json(scanner.getStatus());
});

app.get('/api/scanner/index', configCheckConnector, function (req, res) {
    let deleteClones = false;
    if (req.query.deleteClones && req.query.deleteClones == 'true') {
        deleteClones = true;
    }
    scanner.index(deleteClones);
    res.json(scanner.getStatus());
});

app.get('/api/scanner/scan', configCheckConnector, async function (req, res) {
    scanner.scan();
    res.json(scanner.getStatus());
});

app.get('/api/scanner/cache', configCheckConnector, async function (req, res) {
    scanner.cache();
    res.json(scanner.getStatus());
});

app.get('/api/scanner/import', configCheckConnector, function (req, res) {
    let deleteClones = false;
    if (req.query.deleteClones && req.query.deleteClones == 'true') {
        deleteClones = true;
    }
    (async function() {
        await scanner.scan();
        await scanner.index();
        await scanner.cache();
        await global.db.search.rebuildIndex();
    })();
    res.json(scanner.getStatus());
});

app.get('/api/scanner/deleteMissing', configCheckConnector, async function (req, res) {
    await scanner.deleteMissing();
    await scanner.scan();
    res.json(scanner.getStatus());
});

app.get('/api/tags', configCheckConnector, function (req, res) {
    res.json(global.db.getTags());
});

app.get('/api/tags/add/:tag', configCheckConnector, async function (req, res) {
    if (!req.params.tag) {
        return res.status(422).type('txt').send('No tag specified');
    }
    await global.db.addTag(req.params.tag);
    res.json(global.db.getTags());
});

app.get('/api/tags/remove/:tag', configCheckConnector, async function (req, res) {
    if (!req.params.tag) {
        return res.status(422).type('txt').send('No tag specified');
    }
    await global.db.removeTag(req.params.tag);
    res.json(global.db.getTags());
});

app.get('/api/actors', configCheckConnector, function (req, res) {
    res.json(global.db.getActors());
});

app.get('/api/actors/add/:actor', configCheckConnector, async function (req, res) {
    if (!req.params.actor) {
        return res.status(422).type('txt').send('No actor specified');
    }
    await global.db.addActor(req.params.actor);
    res.json(global.db.getActors());
});

app.get('/api/actors/remove/:actor', configCheckConnector, async function (req, res) {
    if (!req.params.actor) {
        return res.status(422).type('txt').send('No actor specified');
    }
    await global.db.removeActor(req.params.actor);
    res.json(global.db.getActors());
});

app.get('/api/images', configCheckConnector, function (req, res) {
    res.json(global.db.cropImageMap(global.db.getDefaultMap()));
});

app.get('/api/images/subset/:constraints', configCheckConnector, async function (req, res) {
    try {
        const constraints = JSON.parse(req.params.constraints);
        console.log('Search request.', constraints);
        const subset = global.db.cropImageMap(await global.db.subset(constraints));
        console.log('Sending search result.');
        res.json(subset);
    } catch (err) {
        console.log(err);
        res.status(503).send(err);
    }
});

app.get('/api/images/:hash', configCheckConnector, function (req, res) {
    const img = global.db.getMedia(req.params.hash);
    if (img != undefined) {
        res.send(img);
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
});

app.get('/api/images/:hash/delete', configCheckConnector, async function (req, res) {
    const hash = req.params.hash;
    const media = global.db.getMedia(hash);
    if (media) {
        if (await global.db.removeMedia(hash)) {
            fs.unlink(media.absolutePath, function() {
                console.log(`${media.absolutePath} removed`);
            });
            fs.unlink(`${utils.config.cachePath}/thumbnails/${hash}.png`, function() {
                console.log(`${utils.config.cachePath}/thumbnails/${hash}.png removed`);
            });
            rimraf(`${utils.config.cachePath}/${hash}/`, function () {
                console.log(`${utils.config.cachePath}/${hash}/ removed`);
            });
            console.log(`${hash} deleted.`);
            res.json({message: `${hash} deleted.`});
        } else {
            res.status(404);
            res.json({message: "Could not remove media from database"});
        }
    } else {
        console.log(`Delete: Hash does not exist: ${hash}`);
        res.status(404);
        res.json({message: `Hash does not exist: ${hash}`});
    }
});

app.get('/api/images/:hash/metadata/:metadata', configCheckConnector, async function (req, res) {
    const metadata = JSON.parse(req.params.metadata);
    if (await saveMetadata(req.params.hash, metadata)) {
        res.send(global.db.getMedia(req.params.hash));
    } else {
        res.status(503);
        res.type('txt').send('Failed to save metadata.');
    }
});

app.get('/api/images/:hash/update/:data', configCheckConnector, async function (req, res) {
    const data = JSON.parse(req.params.data);
    if (await global.db.updateMedia(req.params.hash, data)) {
        res.send(global.db.getMedia(req.params.hash));
    } else {
        res.status(503);
        res.type('txt').send('Failed to update image data.');
    }
});

app.get('/api/images/:hash/file', configCheckConnector, function (req, res) {
    const img = global.db.getMedia(req.params.hash);
    if (img != undefined) {
        res.sendFile(img.absolutePath);
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
});

app.get('/api/images/:hash/addTag/:tag', configCheckConnector, async function (req, res) {
    const result = await global.db.addTag(req.params.tag, req.params.hash);
    if (result) {
        res.send(global.db.getMedia(req.params.hash));
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
});

app.get('/api/images/:hash/removeTag/:tag', configCheckConnector, async function (req, res) {
    await global.db.removeTag(req.params.tag, req.params.hash);
    res.send(global.db.getMedia(req.params.hash));
});

app.get('/api/images/:hash/addActor/:actor', configCheckConnector, async function (req, res) {
    const result = await global.db.addActor(req.params.actor, req.params.hash);
    if (result) {
        res.send(global.db.getMedia(req.params.hash));
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
});

app.get('/api/images/:hash/removeActor/:actor', configCheckConnector, async function (req, res) {
    await global.db.removeActor(req.params.actor, req.params.hash);
    res.send(global.db.getMedia(req.params.hash));
});

app.get('/api/collections', configCheckConnector, function (req, res) {
    res.json(global.db.getCollections());
});

app.get('/api/collections/:id', configCheckConnector, async function (req, res) {
    res.json(global.db.getCollection(req.params.id));
});

app.get('/api/collections/add/:name', configCheckConnector, async function (req, res) {
    await global.db.addCollection(req.params.name);
    if (result) {
        res.json(global.db.getCollections());
    } else {
        res.status(503).json({ message: 'Error adding collection' });
    }
});

app.get('/api/collections/remove/:id', configCheckConnector, async function (req, res) {
    await global.db.removeCollection(req.params.id);
    res.json(global.db.getCollections());
});

app.get('/api/collections/add/:id/:hash', configCheckConnector, async function (req, res) {
    await global.db.addMediaToCollection(req.params.id, req.params.hash);
    res.json(global.db.getCollection(req.params.id));
});

app.get('/api/collections/remove/:id/:hash', configCheckConnector, async function (req, res) {
    await global.db.removeMediaFromCollection(req.params.id, req.params.hash);
    res.json(global.db.getCollection(req.params.id));
});

app.get('/api/search/rebuildIndex', configCheckConnector, async function (req, res) {
    await global.db.search.rebuildIndex();
    res.send('Index rebuilt');
});

app.get('/web/:file(*)', async function (req, res) {
    try {
        const absPath = path.resolve(path.dirname(require.main.filename), 'web', req.params.file);
        const webPath = path.resolve(path.dirname(require.main.filename), 'web');
        if (!pathIsInside(absPath, webPath)) {
            throw new Error('File is not inside cache directory');
        }
        return res.sendFile(absPath);
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
});

app.get('/cache/:file(*)', configCheckConnector, async function (req, res) {
    try {
        const absPath = path.resolve(utils.config.cachePath, req.params.file);
        if (!pathIsInside(absPath, path.resolve(utils.config.cachePath))) {
            throw new Error('File is not inside cache directory');
        }
        return res.sendFile(absPath);
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
});

app.get('/api/config', async function (req, res) {
    return res.json({
        configPath: utils.configPath,
        config: utils.config
    });
});

app.get('/api/config/:config', async function (req, res) {
    try {
        const originalPort = utils.config.port;
        const config = JSON.parse(req.params.config);
        if (global.db) {
            await global.db.close();
            global.db = null;
        }
        try {
            global.db = await Database.setup(config);
        } catch (err) {
            console.log('Updating config failed setting up databse', err);
            throw new Error('Failed to setup database');
        }
        await utils.saveConfig(config);
        scanner.scan();
        res.json({
            message: 'Config saved',
            configPath: utils.configPath,
            config: utils.config
        });
        if (utils.config.port !== originalPort) {
            console.log('Port change: Restarting HTTP server.');
            await setupApp(utils.config.port);
        }
    } catch (err) {
        console.log('Error saving config', err);
        return res.status(400).json({ message: err.message, type: 'config' });
    }
});

app.get('/', async function (req, res) {
    try {
        await utils.validateConfig();
        res.redirect('/web/index.html');
    } catch (err) {
        res.redirect('/web/config.html');
    }
});

async function listen(port) {
    return new Promise(function(resolve, reject) {
        try {
            console.log('Listening on *:' + port);
            global.server.listen(port, resolve);
        } catch (err) {
            reject(err);
        }
    });
}

async function setupApp(port) {
    if (global.io) {
        global.io.close();
        global.io = null;
    }
    if (global.server) {
        global.server.close(function() {
            console.log('Old HTTP server disabled');
            global.server = null;
        });
    }
    global.server = Server.createServer(app);
    global.io = IO(server);
    global.io.on('connection', async function(socket) {
        socket.emit('scanStatus', scanner.getStatus());
    });
    await listen(port);
}

async function setup() {
    console.log(`Setting up HTTP server on ${utils.config.port}`);
    await setupApp(utils.config.port);
    try {
        console.log('Validating config');
        await utils.validateConfig();
        console.log('Setting up database');
        global.db = await Database.setup(utils.config);
        scanner.scan();
    } catch (err) {
        console.log(`Config is invalid: ${err.message}`, err);
    }
}

exports.config = utils.config;
exports.setup = setup;
exports.shutdown = async function() {
    if (global.io) {
        global.io.close();
        global.io = null;
    }
    if (global.server) {
        global.server.close(function() {
            console.log('Old HTTP server disabled');
            global.server = null;
        });
    }
    if (global.db) {
        await global.db.close();
        global.db = null;
    }
};

if (require.main === module) {
    setup();
}

process.on('unhandledRejection', error => {
    console.log('unhandledRejection', error);
});
