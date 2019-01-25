const Express = require('express');
const Utils = require('../utils.js');

const router = Express.Router();

router.get('/', Utils.wrap(async(req, res) => {
    res.json(await global.db.getActors());
}));

router.post('/', Utils.wrap(async(req, res) => {
    if (!req.body.actor) {
        return res.status(422).type('txt').send('No actor specified');
    }
    await global.db.addActor(req.body.actor);
    res.json(await global.db.getActors());
}));

router.delete('/:actor', Utils.wrap(async(req, res) => {
    if (!req.params.actor) {
        return res.status(422).type('txt').send('No actor specified');
    }
    await global.db.removeActor(req.params.actor);
    res.json(await global.db.getActors());
}));

module.exports = { router };
