const Path = require('path');

const ExpressionParser = require('./expression');
const Search = require('./search');

String.prototype.replaceAll = function(ch, w) {
    return this.split(ch).join(w);
}

function stripTag(tag) {
    return tag.replaceAll(' ', '-').replaceAll('!','').replaceAll('|','').replaceAll('&', '');
}

class MediaManager {
    constructor(config) {
        this.config = config;
        this.media = {};
        this.tags = [];
    }

    addMedia(hash, path, rotation, type, hashDate) {
        const media = {
            hash: hash,
            path: decodeURIComponent((path + '').replace(/\+/g, '%20')).replace(/\\/g, '/'),
            rotation: rotation,
            type: type,
            tags: [],
            hashDate: hashDate
        };
        media.absolutePath = Path.resolve(this.config.libraryPath, media.path);
        media.dir = Path.dirname(media.absolutePath);
        this.media[hash] = media;
        return true;
    }

    updateMedia(hash, args) {
        const media = this.media[hash];
        if (media) {
            const metadata = {};
            if (args.metadata) {
                Object.assign(metadata, args.metadata);
            }
            const obj = {};
            Object.assign(obj, media);
            Object.assign(obj, args);
            if (media.metadata) {
                Object.assign(obj.metadata, media.metadata);
            }
            if (args.metadata) {
                Object.assign(obj.metadata, metadata);
            }
            Object.assign(media, obj);
            return true;
        }
        return false;
    }

    removeMedia(hash) {
        const media = this.media[hash];
        if (media) {
            delete this.media[media.hash];
            return true;
        }
        return false;
    }

    addTag(tag, hash) {
        tag = stripTag(tag);
        if (Array.isArray(this.config.filter)) {
            if (this.config.filter.includes(tag)) {
                console.log(`Tag ${tag} filtered out`);
                return false;
            }
        }
        if (hash) {
            const media = this.media[hash];
            if (!media) {
                return false;
            }
            if (!this.tags.includes(tag)) {
                return false;
            }
            if (this.tags.indexOf(tag) >= 0 && media) {
                if (media.tags.indexOf(tag) < 0) {
                    this.media[hash].tags.push(tag);
                }
                return true;
            }
        } else {
            if (!this.tags.includes(tag) && tag.length > 0) {
                this.tags.push(tag);
                this.tags.sort();
                return true;
            }
        }
        return false;
    }

    removeTag(tag, hash) {
        tag = stripTag(tag);
        if (hash) {
            const media = this.getMedia(hash);
            if (media && media.tags.includes(tag)) {
                media.tags.splice(media.tags.indexOf(tag), 1);
            }
        } else {
            if (this.tags.includes(tag)) {
                this.tags.splice(this.tags.indexOf(tag), 1);
                const map = this.getDefaultMap();
                for (let i = 0; i < map.length; i++) {
                    const media = this.getMedia(map[i]);
                    if (media.tags.indexOf(tag) >= 0) {
                        media.tags.splice(media.tags.indexOf(tag));
                    }
                }
            }
        }
    }

    getMedia(hash) {
        const original = this.media[hash];
        if (original) {
            return Object.assign({}, original);
        }
        return undefined;
    }

    getTags() {
        return this.tags;
    }

    getDefaultMap() {
        return Object.keys(this.media);
    }

    getMediaIndex(search, keys) {
        if (keys == null) {
            keys = this.getDefaultMap();
        }
        if (isNaN(search)) {
            if (this.media[search]) {
                console.log(`Searching by hash (${search})`);
                for (let i = 0; i < keys.length; i++) {
                    if (keys[i] == search) {
                        console.log(`Image found at index ${i}.`);
                        return i;
                    }
                }
            } else {
                console.log("Searching by path.");
                for (let i = 0; i < keys.length; i++) {
                    if (this.media[keys[i]].absolutePath.includes(search)) {
                        console.log(`Found image at ${this.media[keys[i]].absolutePath}.`);
                        return i;
                    }
                }
            }
        } else if (search >= 0 && search < keys.length) {
            return search;
        }
        return -1;
    };

    async subset(constraints, keys) {
        if (keys == null) {
            keys = this.getDefaultMap();
        }

        if (constraints.width) {
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                if (image.metadata) {
                    if (image.metadata.width) {
                        if (image.metadata.width >= constraints.width) {
                            newKeys.push(image.hash);
                        }
                    }
                }
            }
            keys = newKeys;
        }
        await this.search.wait();

        if (constraints.height) {
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                if (image.metadata) {
                    if (image.metadata.height) {
                        if (image.metadata.height >= constraints.height) {
                            newKeys.push(image.hash);
                        }
                    }
                }
            }
            keys = newKeys;
        }
        await this.search.wait();

        function expressionFilter(expression, inputKeys, getField) {
            if (expression) {
                expression = expression.toLowerCase();
                let parsedExpression;
                try {
                    parsedExpression = new ExpressionParser(expression);
                } catch (err) {
                    throw {message: `Failed to parse expression: ${expression} - ${err.message}`};
                }
                const outputKeys = [];
                for (let i = 0; i < inputKeys.length; i++) {
                    let field = getField(inputKeys[i]);
                    if (field) {
                        if (field instanceof String || typeof field === 'string') {
                            field = field.toLowerCase();
                        }
                        if (parsedExpression.match(field)) {
                            outputKeys.push(inputKeys[i]);
                        }
                    }
                }
                return outputKeys;
            } else {
                return inputKeys;
            }
        }

        const $this = this;

        keys = expressionFilter(constraints.tagLexer, keys, function(hash) {
            return $this.media[hash].tags;
        });
        await this.search.wait();

        keys = expressionFilter(constraints.artist, keys, function(hash) {
            const image = $this.media[hash];
            if (image.metadata) {
                return image.metadata.artist;
            } else {
                return null;
            }
        });
        await this.search.wait();

        keys = expressionFilter(constraints.album, keys, function(hash) {
            const image = $this.media[hash];
            if (image.metadata) {
                return image.metadata.album;
            } else {
                return null;
            }
        });
        await this.search.wait();

        keys = expressionFilter(constraints.title, keys, function(hash) {
            const image = $this.media[hash];
            if (image.metadata) {
                return image.metadata.title;
            } else {
                return null;
            }
        });
        await this.search.wait();

        keys = expressionFilter(constraints.path, keys, function(hash) {
            return $this.media[hash].absolutePath;
        });

        // General expression filter. Check artist, album, title, tags, path and type.
        keys = expressionFilter(constraints.generalLexer, keys, function(hash) {
            return $this.search.getMediaTokens($this.media[hash]);
        });
        await this.search.wait();

        if (constraints.all != undefined && constraints.all.length > 0) {
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                let tagsFound = true;
                for (let j = 0; j < constraints.all.length; j++) {
                    if (image.tags.indexOf(constraints.all[j]) < 0) {
                        tagsFound = false;
                        break;
                    }
                }
                if (tagsFound) {
                    newKeys.push(image.hash);
                }
            }
            keys = newKeys;
            await this.search.wait();
        }
        if (constraints.none != undefined && constraints.none.length > 0) {
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                let tagFound = false;
                for (let j = 0; j < constraints.none.length; j++) {
                    const tag = constraints.none[j];
                    if (image.tags.indexOf(tag) >= 0) {
                        tagFound = true;
                        break;
                    }
                }
                if (!tagFound) {
                    newKeys.push(image.hash);
                }
            }
            keys = newKeys;
            await this.search.wait();
        }
        if (constraints.type != undefined && constraints.type.length > 0) {
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                if (constraints.type.indexOf(image.type) >= 0) {
                    newKeys.push(image.hash);
                }
            }
            keys = newKeys;
            await this.search.wait();
        }
        if (constraints.any != undefined && constraints.any.length > 0) {
            const numMatching = [];
            for (let i = 0; i < keys.length; i++) {
                numMatching[i] = { hash: keys[i], count: 0 };
                const image = this.media[keys[i]];
                for (let j = 0; j < constraints.any.length; j++) {
                    const tag = constraints.any[j];
                    if (image.tags.indexOf(tag) >= 0) {
                        numMatching[i].count++;
                    }
                }
            }
            await this.search.wait();
            // Sort by number of matching tags.
            numMatching.sort(function compare(a,b) {
                if (a.count < b.count) {
                    return 1;
                }
                if (a.count > b.count) {
                    return -1;
                }
                return 0;
            });
            // Extract the sorted to an array of hashes to be used as keys.
            keys = [];
            for (let i = 0; i < numMatching.length; i++) {
                if (numMatching[i].count > 0) {
                    keys.push(numMatching[i].hash);
                }
            }
            await this.search.wait();
        }

        if (constraints.folder) {
            const main = this.media[constraints.folder];
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                if (image.dir == main.dir) {
                    newKeys.push(keys[i]);
                }
            }
            keys = newKeys;
        }

        if (constraints.keywordSearch) {
            keys = await this.search.search(constraints.keywordSearch, keys);
        }

        return keys;
    };

    async setup() {
        this.search = new Search(this);
        await this.search.rebuildIndex();

        const $this = this;
        // Start a loop to rebuild the index every 5 minutes.
        async function rebuildIndex() {
            console.time('Rebuilding index took');
            await $this.search.rebuildIndex();
            console.timeEnd('Rebuilding index took');
            $this.rebuildTimeout = setTimeout(rebuildIndex, 5 * 60 * 1000);
        }
        this.rebuildTimeout = setTimeout(rebuildIndex, 5 * 60 * 1000);

        const still = await this.subset({type: ['still']});
        const gif = await this.subset({type: ['gif']});
        const video = await this.cropImageMap(this.subset({type: ['video']}));
        console.log(`${still.length} stills. ${gif.length} gifs. ${video.length} videos.`);
    }

    match(arrA, arrB) {
        if (!Array.isArray(arrA)) {
            return false;
        }
        if (!Array.isArray(arrB)) {
            return false;
        }
        for (let i = 0; i < arrA.length; i++) {
            if (arrB.includes(arrA[i])) {
                return true;
            }
        }
        return false;
    }

    cropImageMap(map) {
        // Crop out videos that are missing metadata so are not transcoded.
        const newMap = [];
        for (let i = 0; i < map.length; i++) {
            const media = this.getMedia(map[i]);
            if (media.metadata) {
                if (this.match(this.config.filter, media.tags)) {
                    continue;
                }
                newMap.push(media.hash);
            }
        }

        return newMap;
    };
}

module.exports = MediaManager;
