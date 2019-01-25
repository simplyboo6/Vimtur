const Path = require('path');
const Express = require('express');
const App = Express();
const Server = require('http');
const IO = require('socket.io');
const Utils = require('./utils.js');
const Database = require('./database');
const Auth = require('http-auth');
const Compression = require('compression');
const PathIsInside = require('path-is-inside');
const BodyParser = require('body-parser');

const ScannerRouter = require('./routes/scanner');

const basicAuth = Utils.authConnector;

const configCheckConnector = async(req, res, next) => {
    try {
        await Utils.isSetup();
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
    next();
};

App.use(Compression({level: 9}));
App.use(BodyParser.json());

if (Utils.config.username && Utils.config.password) {
    App.use(Auth.connect(basicAuth));
}

App.use('/api/scanner', configCheckConnector, ScannerRouter.router);

App.get('/api/tags', configCheckConnector, Utils.wrap(async(req, res) => {
    res.json(await global.db.getTags());
}));

App.post('/api/tags', configCheckConnector, Utils.wrap(async(req, res) => {
    if (!req.body.tag) {
        return res.status(422).type('txt').send('No tag specified');
    }
    await global.db.addTag(req.body.tag);
    res.json(await global.db.getTags());
}));

App.delete('/api/tags/:tag', configCheckConnector, Utils.wrap(async(req, res) => {
    if (!req.params.tag) {
        return res.status(422).type('txt').send('No tag specified');
    }
    await global.db.removeTag(req.params.tag);
    res.json(await global.db.getTags());
}));

App.get('/api/actors', configCheckConnector, Utils.wrap(async(req, res) => {
    res.json(await global.db.getActors());
}));

App.post('/api/actors', configCheckConnector, Utils.wrap(async(req, res) => {
    if (!req.body.actor) {
        return res.status(422).type('txt').send('No actor specified');
    }
    await global.db.addActor(req.body.actor);
    res.json(await global.db.getActors());
}));

App.delete('/api/actors/:actor', configCheckConnector, Utils.wrap(async(req, res) => {
    if (!req.params.actor) {
        return res.status(422).type('txt').send('No actor specified');
    }
    await global.db.removeActor(req.params.actor);
    res.json(await global.db.getActors());
}));

App.post('/api/images/subset', configCheckConnector, Utils.wrap(async(req, res) => {
    try {
        const constraints = req.body;
        console.log('Search request.', constraints);
        constraints.corrupted = false;
        constraints.cached = true;
        const subset = await global.db.subset(constraints);
        console.log('Sending search result.');
        res.json(subset);
    } catch (err) {
        console.log(err);
        res.status(503).send(err);
    }
}));

App.get('/api/images/:hash', configCheckConnector, Utils.wrap(async(req, res) => {
    const img = await global.db.getMedia(req.params.hash);
    if (img != undefined) {
        res.send(img);
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
}));

App.delete('/api/images/:hash', configCheckConnector, Utils.wrap(async(req, res) => {
    const media = await global.db.getMedia(req.params.hash);
    if (media) {
        await global.db.removeMedia(req.params.hash);
        await Utils.deleteMedia(media);
        res.sendStatus(200);
    } else {
        res.status(404).json({ message: 'Media not found.' });
    }
}));

App.post('/api/images/:hash', configCheckConnector, Utils.wrap(async(req, res) => {
    res.json(await global.db.saveMedia(req.params.hash, req.body));
}));

App.get('/api/images/:hash/file', configCheckConnector, Utils.wrap(async(req, res) => {
    const img = await global.db.getMedia(req.params.hash);
    if (img != undefined) {
        res.sendFile(Path.resolve(Utils.config.libraryPath, img.path));
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
}));

App.get('/web/:file(*)', Utils.wrap(async(req, res) => {
    try {
        const absPath = Path.resolve(Path.dirname(require.main.filename), '..', 'web', req.params.file);
        const webPath = Path.resolve(Path.dirname(require.main.filename), '..', 'web');
        if (!PathIsInside(absPath, webPath)) {
            throw new Error('File is not inside cache directory');
        }
        return res.sendFile(absPath);
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
}));

App.get('/cache/:file(*)', configCheckConnector, Utils.wrap(async(req, res) => {
    try {
        const absPath = Path.resolve(Utils.config.cachePath, req.params.file);
        if (!PathIsInside(absPath, Path.resolve(Utils.config.cachePath))) {
            throw new Error('File is not inside cache directory');
        }
        return res.sendFile(absPath);
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
}));

App.get('/api/config', Utils.wrap(async(req, res) => {
    return res.json({
        configPath: Utils.configPath,
        config: Utils.config
    });
}));

App.post('/api/config', Utils.wrap(async(req, res) => {
    try {
        // There's two sorts of config updates. User settings and server settings.
        // Currently the server settings are updated from a separate page than the
        // user settings. So if the user object is set then only save the new user setting.
        const config = req.body;
        const originalPort = Utils.config.port;

        if (!config.user) {
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
        }
        await Utils.saveConfig(config);
        res.json({
            message: 'Config saved',
            configPath: Utils.configPath,
            config: Utils.config
        });
        if (Utils.config.port !== originalPort) {
            console.log('Port change: Restarting HTTP server.');
            await setupApp(Utils.config.port);
        }
    } catch (err) {
        console.log('Error saving config', err);
        return res.status(400).json({ message: err.message, type: 'config' });
    }
}));

App.get('/', Utils.wrap(async(req, res) => {
    try {
        await Utils.validateConfig();
        res.redirect('/web/index.html');
    } catch (err) {
        res.redirect('/web/config.html');
    }
}));

async function listen(port) {
    return new Promise((resolve, reject) => {
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
        global.server.close(() => {
            console.log('Old HTTP server disabled');
            global.server = null;
        });
    }
    global.server = Server.createServer(App);
    global.io = IO.listen(global.server);

    global.io.on('connection', (socket) => {
        socket.emit('scanStatus', ScannerRouter.scanner.getStatus());
    });

    await listen(port);
}

async function setup() {
    console.log('Setting up config');
    await Utils.setup();
    try {
        console.log('Validating config');
        await Utils.validateConfig();
    } catch (err) {
        return console.log(`Config is invalid: ${err.message}`, err);
    }

    try {
        console.log('Setting up database');
        global.db = await Database.setup(Utils.config);
    } catch (err) {
        console.log(err);
        return process.exit(1);
    }
    // Only setup the http server once the database is loaded.
    console.log(`Setting up HTTP server on ${Utils.config.port}`);
    await setupApp(Utils.config.port);
    await ScannerRouter.scanner.scan();
}

exports.config = Utils.config;
exports.setup = setup;
exports.shutdown = async() => {
    if (global.io) {
        global.io.close();
        global.io = null;
    }
    if (global.server) {
        global.server.close(() => {
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
