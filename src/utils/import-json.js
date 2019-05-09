const Database = require('../database');
const Config = require('../config');
const Indexer = require('../cache/indexer');
const ImportUtils = require('../cache/import-utils');
const Path = require('path');
const FS = require('fs');
const Args = require('args');
const Util = require('util');

async function importMedia(db, version, media) {
    if (!media.hash) {
        throw new Error('Missing hash');
    }

    if (!media.metadata) {
        throw new Error('Missing metadata');
    }

    // For some reason rotation is sometimes null in the old versions.
    if (!media.rotation) {
        media.rotation = 0;
    }

    const libraryDir = Path.resolve(Config.get('libraryPath'));
    const cacheDir = Path.resolve(Config.get('cachePath'));

    // Sometimes path can even be missing...
    if (!media.path) {
        if (media.absolutePath) {
            throw new Error('Media missing path and absolutePath');
        }
        media.path = media.absolutePath;
    }
    // Sometimes the path can be the absolute path rather than the relative.
    const path = Path.resolve(media.path);
    if (path.startsWith(libraryDir)) {
        media.path = path.substring(libraryDir.length);
        if (media.path.startsWith('/')) {
            media.path = media.path.substring(1);
        }
    }

    const dir = Path.resolve(media.dir);
    if (dir.startsWith(libraryDir)) {
        media.dir = dir.substring(libraryDir.length);
        if (media.dir.startsWith('/')) {
            media.dir = media.dir.substring(1);
        }
    }

    if (version === undefined || version === 3) {
        // In older versions the hashing mechanism was different, rehash the file.
        const hash = await ImportUtils.hash(Path.resolve(libraryDir, media.path));

        media.metadata.qualityCache = [media.metadata.height];
        if (media.type === 'video') {
            // In older versions, maxCopy was the default.
            media.metadata.maxCopy = true;
            const metadata = await Indexer.getVideoMetadata(Path.resolve(libraryDir, media.path));
            // Some videos in older versions didn't correctly get the width/height.
            media.metadata.width = metadata.width;
            media.metadata.height = metadata.height;
            media.metadata.codec = metadata.codec;

            const mediaCache = Path.resolve(cacheDir, media.hash);
            const cacheUpdated = await ImportUtils.exists(Path.resolve(mediaCache, `${media.metadata.height}p`));
            if (!cacheUpdated) {
                const files = await Util.promisify(FS.readdir)(mediaCache);
                await ImportUtils.mkdir(Path.resolve(mediaCache, `${media.metadata.height}p`));
                for (const file of files) {
                    await Util.promisify(FS.rename)(Path.resolve(mediaCache, file), Path.resolve(mediaCache, `${media.metadata.height}p`, file));
                }
            }
            const indexExists = await ImportUtils.exists(Path.resolve(mediaCache, 'index.m3u8'));
            console.log('indexMissing', indexExists);
            if (!indexExists) {
                console.log(`Writing index file to ${Path.resolve(mediaCache, 'index.m3u8')}`);
                await Util.promisify(FS.writeFile)(Path.resolve(mediaCache, 'index.m3u8'), ImportUtils.generatePlaylist(media));
            }

            try {
                await Util.promisify(FS.rename)(Path.resolve(cacheDir, media.hash), Path.resolve(cacheDir, hash));
            } catch (err) {
                console.warn('Failed to rename video', err);
                if (media.metadata) {
                    media.metadata.qualityCache = {};
                }
            }
        } else if (media.metadata.width === 0) {
            throw new Error(`Invalid image resolution ${media.metadata.width}x{media.metadata.height}`);
        }

        // Update the thumnnail with the new hash path.
        try {
            // Rename the thumbnail.
            await Util.promisify(FS.rename)(Path.resolve(cacheDir, 'thumbnails', `${media.hash}.png`), Path.resolve(cacheDir, 'thumbnails', `${hash}.png`));
            media.thumnnail = true;
        } catch (err) {
            // If thumbnails can't be moved, because say they're not generated then it's not the end of the world.
            console.warn('Failed to rename thumbnail during rehash', err);
            media.thumbnail = false;
        }
        media.hash = hash;
    }

    await db.saveMedia(media.hash, media);
}

(async function() {
    const flags = Args.parse(process.argv);

    let input = '';
    if (flags.stdin) {
        const stdin = process.stdin;
        stdin.setEncoding('utf8');

        stdin.on('data', (data) => {
            input += data;
        });

        stdin.resume();

        await new Promise((resolve) => {
            stdin.on('end', resolve);
        });
    } else if (flags.file) {
        input = FS.readFileSync(flags.file);
    } else {
        throw new Error('Please specify either -stdin or -file');
    }

    console.log('Parsing JSON...');
    const imported = JSON.parse(input);
    console.log(`Loaded ${imported.tags.length} tags, ${imported.actors.length} actors and ${imported.media.length} media from file`);

    console.log('Connecting to database.');
    const db = await Database.setup();
    console.log('Applying config overlay from database.');
    const userConfigOverlay = await db.getUserConfig();
    Config.setLayers([userConfigOverlay]);

    console.log('Adding all to database. This can take some time.');
    const start = new Date();
    for (let i = 0; i < imported.tags.length; i++) {
        await db.addTag(imported.tags[i]);
    }
    for (let i = 0; i < imported.actors.length; i++) {
        await db.addActor(imported.actors[i]);
    }
    if (imported.config) {
        await db.saveUserConfig(imported.config);
    }
    let progress = 0;
    for (let i = 0; i < imported.media.length; i++) {
        try {
            await importMedia(db, imported.version, imported.media[i]);
        } catch (err) {
            console.error(`Error importing ${imported.media[i].path}`, err);
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

    await db.close();
})();
