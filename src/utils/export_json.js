const Database = require('../database');
const Config = require('../config');
const FS = require('fs');
const Util = require('util');
const Args = require('args');

(async function() {
    const flags = Args.parse(process.argv);
    const file = flags.file;
    if (!file) {
        throw new Error('Set file to output to');
    }

    console.log(`Saving to ${file}`);

    // For piping output push logs to error.
    console.log('Connecting to database...');
    const db = await Database.setup();
    console.log('Applying config overlay from database...');
    const userConfigOverlay = await db.getUserConfig();
    Config.setLayers([userConfigOverlay]);

    const output = {
        tags: [],
        media: [],
        actors: [],
        config: userConfigOverlay,
        version: 4
    };
    // Save tags
    output.tags = await db.getTags();
    output.actors = await db.getActors();
    const map = await db.subset();
    for (const hash of map) {
        const media = await db.getMedia(hash);
        delete media.absolutePath;
        delete media._id;
        output.media.push(media);
    }

    await db.close();

    console.log(`Saving database to ${file}`);
    await Util.promisify(FS.writeFile)(file, JSON.stringify(output, null, 2));
})();
