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
    console.log('Loading data to import from input.json');
    const imported = JSON.parse(fs.readFileSync('input.json'));
    console.log(`Loaded ${imported.tags.length} tags and ${imported.media.length} media from file`);

    console.log('Adding all to database. This can take some time.');
    const start = new Date();
    for (let i = 0; i < imported.tags.length; i++) {
        await global.db.addTag(imported.tags[i]);
    }
    for (let i = 0; i < imported.actors.length; i++) {
        await global.db.addActor(imported.actors[i]);
    }
    let progress = 0;
    for (let i = 0; i < imported.media.length; i++) {
        const media = imported.media[i];
        if (!media.hash) {
            console.log(`Skipping media with missing hash ${media.path}`);
            continue;
        }
        if (media.corrupted) {
            console.log(`Skipping corrupted file ${media.path}`);
            continue;
        }
        await global.db.updateMedia(media.hash, media);
        for (let j = 0; j < media.tags.length; j++) {
            await global.db.addTag(media.tags[j], media.hash);
        }
        for (let j = 0; j < media.actors.length; j++) {
            await global.db.addActor(media.actors[j], media.hash);
        }
        const newProgress = Math.floor((i / imported.media.length) * 100);
        if (progress !== newProgress) {
            const diff = Date.now() - start.getTime();
            const diffDate = new Date(diff);
            const timePerMedia = diff / i;
            const remaining = new Date((imported.media.length - i) * timePerMedia);
            progress = newProgress;
            console.log(`Progress: ${progress}% ${diffDate.getHours()}h${diffDate.getMinutes()}m. ETC: ${remaining.getHours()}h${remaining.getMinutes()}m`);
        }
    }
    console.log('Import complete');

    await global.db.close();
})();
