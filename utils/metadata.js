// This program makes API calls that allow you to set metadata for a file from the command line.
const http = require('http');
const co = require('co');
const fs = require('fs');
const path = require('path');

function usage() {
    const prog = process.argv[0] + ' ' + process.argv[1];
    console.log(`Usage: ${prog} </path/to/config.json> <get/set> <artist/album/title> <value>`);
}

function * get(url) {
    return new Promise(function(resolve, reject) {
        http.get({ hostname: 'localhost', port: port, path: url, agent: false }, (resp) => {
            let data = '';

            // A chunk of data has been recieved.
            resp.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received. Print out the result.
            resp.on('end', () => {
                if (resp.statusCode == 200) {
                    resolve(data);
                } else {
                    reject(data);
                }
            });

        }).on("error", (err) => {
            reject(err.message);
        });
    });
}

function * getMetadata(image) {
    try {
        const media = yield get(`/findImage/${encodeURIComponent(image)}`);
        const parsed = JSON.parse(media);
        console.log(`Found media, hash: ${parsed.hash}`);
        return parsed.metadata;
    } catch (err) {
        console.log(err);
        return null;
    }
}

function * setMetadata(image, metadata) {
    try {
        const media = yield get(`/findImage/${encodeURIComponent(image)}`);
        const parsed = JSON.parse(media);
        console.log(`Found media, hash: ${parsed.hash}`);

        if (parsed.metadata) {
            if (!metadata.artist) {
                metadata.artist = parsed.metadata.artist;
            }
            if (!metadata.album) {
                metadata.album = parsed.metadata.album;
            }
            if (!metadata.title) {
                metadata.title = parsed.metadata.title;
            }
        }

        yield get(`/setMetadata/${parsed.hash}/${encodeURIComponent(JSON.stringify(metadata))}`);
    } catch (err) {
        console.log(err);
    }
}

function printMetadata(metadata) {
    if (metadata) {
        console.log(`Artist: ${metadata.artist}\nAlbum: ${metadata.album}\nTitle: ${metadata.title}`);
        console.log(`Width: ${metadata.width}, Height: ${metadata.height}, Length: ${metadata.length}s`);
    } else {
        console.log('No metadata found.');
    }
}

co(function * () {
    if (process.argv.length < 3) {
        usage();
        process.exit();
    }
    if (!fs.existsSync(process.argv[2])) {
        console.log('JSON config file does not exist.');
        usage();
        process.exit();
    }
    const config = require(process.argv[2]);
    const port = config.port;
    const file = process.argv[3];
    if (!file) {
        console.log("File not specified");
        usage();
        process.exit();
    }

    if (!fs.existsSync(file)) {
        console.log(`${file} not found`);
    }

    const absPath = path.resolve(file);
    console.log(absPath);

    if (process.argv[4] && process.argv[5]) {
        const name = process.argv[4];
        if (name != 'artist' && name != 'album' && name != 'title') {
            console.log('Metadata type must be artist, album or title');
            usage();
            process.exit(0);
        } else {
            const value = process.argv[5];
            if (value)  {
                console.log(`Setting ${name} to ${value}`);
                const metadata = {
                    artist: (name == 'artist') ? value : undefined,
                    album: (name == 'album') ? value : undefined,
                    title: (name == 'title') ? value : undefined,
                }
                yield setMetadata(absPath, metadata);
            } else {
                console.log('Value not set');
                usage();
                process.exit();
            }
        }
    } else {
        printMetadata(yield getMetadata(absPath));
    }


}).catch(err => {
    console.log(err);
    throw err;
});
