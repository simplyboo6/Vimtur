const Database = require('../src/database');
const Utils = require('../src/utils.js');
const FS = require('fs');
const Util = require('util');

(async function() {
    console.log("Setting up config");
    await Utils.setup();
    try {
        console.log('Validating config');
        await Utils.validateConfig();
    } catch (err) {
        return console.log(`Config is invalid: ${err.message}`, err);
    }

    global.db = await Database.setup(Utils.config);
    const output = {
        tags: [],
        media: [],
        actors: []
    };
    // Save tags
    output.tags = await global.db.getTags();
    output.actors = await global.db.getActors();
    const map = await global.db.subset();
    // Convert from hashmap to array.
    for (let i = 0; i < map.length; i++) {
        const media = await global.db.getMedia(map[i]);
        delete media.absolutePath;
        delete media._id;
        output.media.push(media);
    }

    await global.db.close();

    console.log('Saving database to output.json');
    await Util.promisify(FS.writeFile)('output.json', JSON.stringify(output, null, 2));
})();
