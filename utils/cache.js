const Database = require('../src/database');
const Cache = require('../src/cachelib.js');
const utils = require("../src/utils.js");

(async function() {
    global.db = await Database.setup(utils.config.mysql_host, utils.config.mysql_username,
        utils.config.mysql_password, utils.config.mysql_database);
    //await Cache.runCache();
    const map = global.db.getDefaultMap();
    for (let i = 0; i < map.length; i++) {
        console.log(`Generating thumb ${i} of ${map.length}`);
        const media = global.db.getMedia(map[i]);
        try {
            await Cache.generateThumb(media);
        } catch (err) {
            console.log(err);
        }
    }
    await global.db.close();
})();
