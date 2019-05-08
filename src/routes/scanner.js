const Express = require('express');
const Cache = require('../cache');

async function setup(database, io) {
    function stripStatus(status) {
        if (!status.scanResults) {
            return status;
        }
        const clone = Object.assign({}, status);
        clone.scanResults = Object.assign({}, clone.scanResults);
        clone.scanResults.newPaths = clone.scanResults.newPaths.length;

        return clone;
    }

    const cache = new Cache(database, (status) => {
        io.sockets.emit('scanStatus', stripStatus(status));
    });

    function getStatus() {
        return stripStatus(cache.getStatus());
    }

    io.on('connection', (socket) => {
        socket.emit('scanStatus', getStatus());
    });

    const router = Express.Router();

    router.get('/status', (req, res) => {
        res.json(getStatus());
    });

    router.post('/rehash', (req, res) => {
        (async () => {
            try {
                await cache.rehash();
            } catch (err) {
                console.error('Error rehashing', err);
            }
        })();
        res.json(getStatus());
    });

    router.post('/scan', (req, res) => {
        (async () => {
            try {
                await cache.scan();
            } catch (err) {
                console.error('Error during scan.', err);
            }
        })();
        res.json(getStatus());
    });

    router.post('/index', (req, res) => {
        (async () => {
            try {
                await cache.index();
            } catch (err) {
                console.error('Error during index.', err);
            }
        })();
        // TODO Log list of clones.
        res.json(getStatus());
    });

    // TODO Add endpoint for deleting clones.

    router.post('/cache', (req, res) => {
        (async () => {
            try {
                await cache.cache();
            } catch (err) {
                console.error('Error during cache.', err);
            }
        })();
        res.json(getStatus());
    });

    router.post('/thumbnails', (req, res) => {
        (async () => {
            try {
                await cache.thumbnails();
            } catch (err) {
                console.error('Error during thumbnail generation.', err);
            }
        })();
        res.json(getStatus());
    });

    router.post('/import', (req, res) => {
        (async () => {
            try {
                await cache.scan();
                await cache.index();
                await cache.thumbnails();
                await cache.cache();
            } catch (err) {
                console.error('Error during full import.', err);
            }
        })();
        res.json(getStatus());
    });

    return { router, cache };
}

module.exports = { setup };
