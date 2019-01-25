const Express = require('express');
const Path = require('path');
const Utils = require('../utils.js');

const router = Express.Router();

router.post('/subset', Utils.wrap(async(req, res) => {
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

router.get('/:hash', Utils.wrap(async(req, res) => {
    const img = await global.db.getMedia(req.params.hash);
    if (img != undefined) {
        res.send(img);
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
}));

router.delete('/:hash', Utils.wrap(async(req, res) => {
    const media = await global.db.getMedia(req.params.hash);
    if (media) {
        await global.db.removeMedia(req.params.hash);
        await Utils.deleteMedia(media);
        res.sendStatus(200);
    } else {
        res.status(404).json({ message: 'Media not found.' });
    }
}));

router.post('/:hash', Utils.wrap(async(req, res) => {
    res.json(await global.db.saveMedia(req.params.hash, req.body));
}));

router.get('/:hash/file', Utils.wrap(async(req, res) => {
    const img = await global.db.getMedia(req.params.hash);
    if (img != undefined) {
        res.sendFile(Path.resolve(Utils.config.libraryPath, img.path));
    } else {
        res.status(404);
        res.type('txt').send('Not found');
    }
}));

module.exports = { router };
