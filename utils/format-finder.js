const Database = require('../src/database');
const Utils = require('../src/utils.js');
const FS = require('fs');
const Cache = require('../src/cachelib');

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

    const videos = await global.db.subset({type: ['video'] });
    console.log(videos.length);

    for (const hash of videos) {
        const media = await global.db.getMedia(hash);
        if (!media.metadata.codec) {
            const fileMeta = await Cache.getMetadata(media.absolutePath);
            console.log(`Setting codec for ${hash} to ${fileMeta.codec}.`);
            await global.db.saveMedia(hash, {metadata: { codec: fileMeta.codec }});
        }
    }

    await global.db.close();
})();
