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
        this.collections = {};
        this.tags = [];
        this.actors = [];
    }

    addMedia(hash, path, rotation, type, hashDate) {
        if (!hash) {
            console.log('Skipping file. Hash not set');
            return false;
        }
        if (!path) {
            console.log(`Skipping ${hash}. Path not set`);
            return false;
        }
        switch (type) {
            case 'still':
            case 'gif':
            case 'video':
                // Continue normally.
                break;
            default:
                console.log(`Skipping ${path}. Unsupported type: ${type}`);
                return false;
        }
        // Hash date can be null. It's not crucial.
        const media = {
            hash: hash,
            path: decodeURIComponent((path + '').replace(/\+/g, '%20')).replace(/\\/g, '/'),
            rotation: rotation,
            type: type,
            tags: [],
            actors: [],
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
            // Do some validation.
            if (args.rating !== undefined) {
                // For this one throw an error because it means something is really broken.
                if (args.rating < 0 || args.rating > 5) {
                    throw new Error('Rating must be between 0 and 5 inclusive');
                }
            }
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
        if (!tag) {
            return false;
        }
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
            if (media.tags.indexOf(tag) < 0) {
                this.media[hash].tags.push(tag);
            }
            return true;
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
        if (!tag) {
            return false;
        }
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
                        media.tags.splice(media.tags.indexOf(tag), 1);
                    }
                }
            }
        }
        return true;
    }

    addActor(actor, hash) {
        if (!actor) {
            return false;
        }
        if (!this.actors.includes(actor)) {
            this.actors.push(actor);
            this.actors.sort();
        }
        if (hash) {
            const media = this.media[hash];
            if (!media) {
                return false;
            }
            if (!media.actors.includes(actor)) {
                media.actors.push(actor);
            }
        }
        return true;
    }

    removeActor(actor, hash) {
        if (hash) {
            const media = this.media[hash];
            if (!media) {
                return false;
            }
            if (media.actors.includes(actor)) {
                media.actors.splice(media.actors.indexOf(actor), 1);
            }
        } else {
            if (this.actors.includes(actor)) {
                this.actors.splice(this.actors.indexOf(actor), 1);
                const map = this.getDefaultMap();
                for (let i = 0; i < map.length; i++) {
                    const media = this.getMedia(map[i]);
                    if (media.actors.indexOf(actor) >= 0) {
                        media.actors.splice(media.actors.indexOf(actor), 1);
                    }
                }
            }
        }
        return true;
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

    getActors() {
        return this.actors;
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

    addCollection(id, name) {
        if (this.collections[id]) {
            return false;
        }
        this.collections[id] = {
            name: name,
            media: []
        };
        return true;
    }

    removeCollection(id) {
        if (!this.collections[id]) {
            return false;
        }
        delete this.collections[id];
    }

    addMediaToCollection(id, hash) {
        if (!this.collections[id]) {
            return false;
        }
        if (!this.media[hash]) {
            return false;
        }
        if (this.collections[id].media.includes(hash)) {
            return false;
        }
        this.collections[id].media.push(hash);
        return true;
    }

    removeMediaFromCollection(id, hash) {
        if (!this.collections[id]) {
            return false;
        }
        if (!this.media[hash]) {
            return false;
        }
        if (!this.collections[id].media.includes(hash)) {
            return false;
        }
        this.collections[id].media.splice(this.collections[id].media.indexOf(hash), 1);
        return true;
    }

    updateCollection(id, args) {
        if (!this.collections[id]) {
            return false;
        }
        Object.assign(this.collections[id], args);
        return true;
    }

    getCollection(id) {
        if (this.collections[id]) {
            const collection = Object.assign({}, this.collections[id]);
            collection.id = id;
            return collection;
        }
        return null;
    }

    getCollections() {
        const keys = Object.keys(this.collections);
        const strippedCollection = [];
        for (let i = 0; i < keys.length; i++) {
            strippedCollection.push({
                id: keys[i],
                name: this.collections[keys[i]].name
            });
        }
        return strippedCollection;
    }

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

        keys = expressionFilter(constraints.actorLexer, keys, function(hash) {
            return $this.media[hash].actors;
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

        if (constraints.collection !== undefined) {
            const collection = this.collections[contraints.collection];
            if (collection) {
                let newKeys = [];
                for (let i = 0; i < keys.length; i++) {
                    if (collection.media.includes(keys[i])) {
                        newKeys.push(keys[i]);
                    }
                }
                keys = newKeys;

            }
        }

        if (constraints.rating !== undefined) {
            let newKeys = [];
            for (let i = 0; i < keys.length; i++) {
                const image = this.media[keys[i]];
                if (image.rating === undefined) {
                    continue;
                }
                if (constraints.rating.value !== undefined && image.rating !== constraints.rating.value) {
                    continue;
                }
                if (constraints.rating.min !== undefined && image.rating < constraints.rating.min) {
                    continue;
                }
                if (constraints.rating.max !== undefined && image.rating > constraints.rating.max) {
                    continue;
                }
                newKeys.push(image.hash);
            }
            keys = newKeys;
            await this.search.wait();
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
            console.time('Rebuilding search index took');
            await $this.search.rebuildIndex();
            console.timeEnd('Rebuilding search index took');
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
