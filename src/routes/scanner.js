const Express = require('express');
const Router = Express.Router();
const Scanner = require('../scanner');
const Utils = require('../utils');

const scanner = new Scanner(function(status) {
    if (global.io) {
        global.io.sockets.emit('scanStatus', status);
    }
});

Router.get('/status', function (req, res) {
    res.json(scanner.getStatus(req.query.verbose));
});

Router.get('/index', function (req, res) {
    let deleteClones = false;
    if (req.query.deleteClones && req.query.deleteClones == 'true') {
        deleteClones = true;
    }
    scanner.index(deleteClones);
    res.json(scanner.getStatus());
});

Router.get('/scan', function (req, res) {
    scanner.scan();
    res.json(scanner.getStatus());
});

Router.get('/cache', function (req, res) {
    scanner.cache();
    res.json(scanner.getStatus());
});

Router.get('/import', function (req, res) {
    let deleteClones = false;
    if (req.query.deleteClones && req.query.deleteClones == 'true') {
        deleteClones = true;
    }
    (async function() {
        await scanner.scan();
        await scanner.index(deleteClones);
        await scanner.cache();
    })();
    res.json(scanner.getStatus());
});

Router.get('/deleteMissing', Utils.wrap(async function (req, res) {
    await scanner.deleteMissing();
    await scanner.scan();
    res.json(scanner.getStatus());
}));

Router.get('/deleteCorrupted', Utils.wrap(async function (req, res) {
    await scanner.deleteCorrupted();
    res.json(scanner.getStatus());
}));

module.exports = Router;
