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
const ImageRouter = require('./routes/images');
const TagRouter = require('./routes/tags');
const ActorRouter = require('./routes/actors');

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
App.use('/api/images', configCheckConnector, ImageRouter.router);
App.use('/api/tags', configCheckConnector, TagRouter.router);
App.use('/api/actors', configCheckConnector, ActorRouter.router);

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

App.get('/api/config', configCheckConnector, Utils.wrap(async(req, res) => {
    res.json(await global.db.getUserConfig());
}));

App.post('/api/config', configCheckConnector, Utils.wrap(async(req, res) => {
    await global.db.saveUserConfig(req.body);
    res.json(await global.db.getUserConfig());
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
    global.server = Server.createServer(App);
    global.io = IO.listen(global.server);

    global.io.on('connection', (socket) => {
        socket.emit('scanStatus', ScannerRouter.scanner.getStatus());
    });

    await listen(Utils.config.port);

    await ScannerRouter.scanner.scan();
}

exports.config = Utils.config;
exports.setup = setup;

if (require.main === module) {
    setup();
}

process.on('unhandledRejection', error => {
    console.log('unhandledRejection', error);
});
