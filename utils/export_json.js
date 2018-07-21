const Database = require('../src/database');
const utils = require('../src/utils.js');
const fs = require('fs');

(async function() {
    global.db = await Database.setup(utils.config);
    const output = {
        tags: [],
        media: []
    };
    console.log('Saving database to output.json');
    // Save tags
    output.tags = global.db.getTags();
    const map = global.db.getDefaultMap();
    // Convert from hashmap to array.
    for (let i = 0; i < map.length; i++) {
        const media = global.db.getMedia(map[i]);
        output.media.push(media);
    }

    fs.writeFileSync('output.json', JSON.stringify(output, null, 2));

    await global.db.close();
})();
