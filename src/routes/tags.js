const Express = require('express');
const Utils = require('../utils.js');

const router = Express.Router();

router.get('/', Utils.wrap(async(req, res) => {
    res.json(await global.db.getTags());
}));

router.post('/', Utils.wrap(async(req, res) => {
    if (!req.body.tag) {
        return res.status(422).type('txt').send('No tag specified');
    }
    await global.db.addTag(req.body.tag);
    res.json(await global.db.getTags());
}));

router.delete('/:tag', Utils.wrap(async(req, res) => {
    if (!req.params.tag) {
        return res.status(422).type('txt').send('No tag specified');
    }
    await global.db.removeTag(req.params.tag);
    res.json(await global.db.getTags());
}));

module.exports = { router };
