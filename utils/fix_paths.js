const Database = require('../src/database');
const utils = require('../src/utils.js');
const path = require('path');

(async function() {
    await utils.setup();
    global.db = await Database.setup(utils.config);
    console.log('Decoding all paths');
    const map = global.db.getDefaultMap();
    // Convert from hashmap to array.
    let updated = 0;
    for (let i = 0; i < map.length; i++) {
        const media = global.db.getMedia(map[i]);
        const newPath = decodeURIComponent((media.path + '').replace(/\+/g, '%20')).replace(/\\/g, '/');
        if (media.path !== newPath) {
            console.log(`Updated ${media.path} to ${newPath}`);
            await global.db.updateMedia(media.hash, {path: newPath});
            updated++;
        }
    }
    console.log(`Updated ${updated} paths`);

    await global.db.close();
})();
