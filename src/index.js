// Modules
const Path = require('path');
const Express = require('express');
const App = Express();
const Server = require('http');
const IO = require('socket.io');
const Compression = require('compression');
const PathIsInside = require('path-is-inside');
const BodyParser = require('body-parser');
const DeepMerge = require('deepmerge');

// Local
const Utils = require('./utils');
const Config = require('./config');
const Database = require('./database');

// Routes
const ScannerRouter = require('./routes/scanner');
const ImageRouter = require('./routes/images');
const TagRouter = require('./routes/tags');
const ActorRouter = require('./routes/actors');

App.use(Compression({level: 9}));
App.use(BodyParser.json());
//App.use(Utils.authConnector);

App.use('/api/images', ImageRouter.router);
App.use('/api/tags', TagRouter.router);
App.use('/api/actors', ActorRouter.router);

App.get('/web/:file(*)', Utils.authConnector, Utils.wrap(async(req, res) => {
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

App.get('/cache/:file(*)', Utils.wrap(async(req, res) => {
    try {
        const absPath = Path.resolve(Config.get('cachePath'), req.params.file);
        if (!PathIsInside(absPath, Path.resolve(Config.get('cachePath')))) {
            throw new Error('File is not inside cache directory');
        }
        return res.sendFile(absPath);
    } catch (err) {
        return res.status(400).json({ message: err.message, type: 'config' });
    }
}));

App.get('/api/config', (req, res) => {
    res.json(Config.get());
});

App.post('/api/config', Utils.wrap(async(req, res) => {
    console.log('Saving user config');
    // Because the new config overrides the existing one when saved
    // they must be merged first to preserve properties.
    const merged = DeepMerge.all([await global.db.getUserConfig(), req.body]);
    Config.setLayers([merged]);
    await global.db.saveUserConfig(merged);
    res.json(Config.get());
}));

App.get('/', Utils.wrap(async(req, res) => {
    res.redirect('/web/index.html');
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

async function setup() {
    console.log('Setting up database');
    global.db = await Database.setup();

    console.log('Applying config overlay from database.');
    const userConfigOverlay = await global.db.getUserConfig();
    Config.setLayers([userConfigOverlay]);

    // Only setup the http server once the database is loaded.
    console.log(`Setting up HTTP server on ${Config.get('port')}`);
    global.server = Server.createServer(App);
    global.io = IO.listen(global.server);

    await listen(Config.get('port'));

    const scannerRouter = await ScannerRouter.setup(global.db, global.io);
    App.use('/api/scanner', scannerRouter.router);
    const redundantCacheMap = await scannerRouter.cache.findRedundantCaches();
    console.log(`${Object.keys(redundantCacheMap).length} media found with redundant caches.`);
    scannerRouter.cache.scan();
}

exports.setup = setup;

if (require.main === module) {
    (async() => {
        try {
            setup();
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    })();
}

process.on('unhandledRejection', error => {
    console.log('unhandledRejection', error);
});
