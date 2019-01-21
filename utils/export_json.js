const Database = require('../src/database');
const utils = require('../src/utils.js');
const fs = require('fs');
const Mongo = require('mongodb');
const Util = require('util');

(async function() {
    console.log("Setting up config");
    await utils.setup();
    try {
        console.log('Validating config');
        await utils.validateConfig();
    } catch (err) {
        return console.log(`Config is invalid: ${err.message}`, err);
    }

    global.db = await Database.setup(utils.config);
    const output = {
        tags: [],
        media: [],
        actors: []
    };
    console.log('Saving database to output.json');
    // Save tags
    output.tags = global.db.getTags();
    output.actors = global.db.getActors();
    const map = global.db.getDefaultMap();
    // Convert from hashmap to array.
    for (let i = 0; i < map.length; i++) {
        const media = global.db.getMedia(map[i]);
        media['_id'] = media.hash;
        output.media.push(media);
    }

    await global.db.close();

    const MongoClient = require('mongodb').MongoClient;
    const url = "mongodb://root:example@localhost:27017/";

    const server = await Util.promisify(MongoClient.connect)(url);
    const db = server.db('chocolatekoala');
    await Util.promisify(db.createCollection.bind(db))('media');

    const mediaCollection = db.collection('media');
    await Util.promisify(mediaCollection.insertMany.bind(mediaCollection))(output.media);

    server.close();
})();
