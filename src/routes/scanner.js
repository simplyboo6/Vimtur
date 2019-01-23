const Express = require('express');
const Scanner = require('../scanner');
const Utils = require('../utils');

const router = Express.Router();
const scanner = new Scanner(function(status) {
    if (global.io) {
        global.io.sockets.emit('scanStatus', status);
    }
});

router.get('/status', function (req, res) {
    res.json(scanner.getStatus(req.query.verbose));
});

router.get('/index', function (req, res) {
    let deleteClones = false;
    if (req.query.deleteClones && req.query.deleteClones == 'true') {
        deleteClones = true;
    }
    scanner.index(deleteClones);
    res.json(scanner.getStatus());
});

router.get('/scan', function (req, res) {
    scanner.scan();
    res.json(scanner.getStatus());
});

router.get('/cache', function (req, res) {
    scanner.cache();
    res.json(scanner.getStatus());
});

router.get('/import', function (req, res) {
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

router.get('/deleteMissing', Utils.wrap(async function (req, res) {
    await scanner.deleteMissing();
    await scanner.scan();
    res.json(scanner.getStatus());
}));

router.get('/deleteCorrupted', Utils.wrap(async function (req, res) {
    await scanner.deleteCorrupted();
    res.json(scanner.getStatus());
}));

module.exports = { router, scanner };
