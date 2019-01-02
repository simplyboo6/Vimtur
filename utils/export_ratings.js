// This file exports from the database in a different way.
// Rather than using direct database access this uses the REST API.
// This means if you lose your database but the program is still running you
// can still export the entire database from the in memory structure for recovery.

const Request = require('request-promise-native');
const FS = require('fs');
const Util = require('util');

const host = 'http://localhost:8787';
const options = {
    'auth': {
        'username': 'username', // Set these if necessary otherwise delete the auth section.
        'password': 'password',
        'sendImmediately': true
    }
};

(async() => {
    try {
        const tags = JSON.parse(await Request.get(`${host}/api/tags`, options));
        const actors = JSON.parse(await Request.get(`${host}/api/actors`, options));

        const total = JSON.parse(await Request.get(`${host}/api/images/subset/${encodeURIComponent(JSON.stringify({}))}`, options));
        console.log('Total media: ', total.length);

        const media = [];
        console.time('fetching');
        for (const hash of total) {
            if (media.length % 1000 === 0) {
                console.log(`Fetched ${media.length}/${total.length}`);
            }
            const image = JSON.parse(await Request.get(`${host}/api/images/${hash}`, options));
            media.push(image);
        }
        console.timeEnd('fetching');

        console.log('saving');
        const fetched = {
            media, tags, actors
        };
        await Util.promisify(FS.writeFile)('all.json', JSON.stringify(fetched, null, 2));
    } catch (err) {
        console.log(err);
    }
})();
