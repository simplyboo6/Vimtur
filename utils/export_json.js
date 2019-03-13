const Database = require('../src/database');
const utils = require('../src/utils.js');
const fs = require('fs');

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
        actors: [],
        version: 3
    };
    console.log('Saving database to output.json');
    // Save tags
    output.tags = global.db.getTags();
    output.actors = global.db.getActors();
    const map = global.db.getDefaultMap();
    // Convert from hashmap to array.
    for (let i = 0; i < map.length; i++) {
        const media = global.db.getMedia(map[i]);
        output.media.push(media);
    }

    fs.writeFileSync('output.json', JSON.stringify(output, null, 2));

    await global.db.close();
})();
