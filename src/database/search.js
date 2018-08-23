class Mutex {
    constructor() {
        this.locked = false;
        this.clients = [];
    }

    release() {
        const clients = this.clients;
        process.nextTick(function() {
            for (let i = 0; i < clients.length; i++) {
                clients[i]();
            }
        });
        this.clients = [];
        this.locked = false;
    }

    async lock() {
        const $this = this;
        return new Promise(function(resolve, reject) {
            if ($this.locked) {
                this.clients.push(resolve);
            } else {
                $this.locked = true;
                resolve();
            }
        });
    }
}

class Search {
    constructor(database) {
        this.bucket = [];
        this.tokenList = [];
        // Both the search and rebuild index functions are long and both yield.
        // They can't both be switched between though so this is a yieldable mutex.
        this.mutex = new Mutex();
        this.database = database;
    }

    async wait() {
        return new Promise(function(resolve, reject) {
            process.nextTick(resolve);
        });
    }

    async rebuildIndex() {
        const newBucket = [];
        const newTokenList = [];

        const set = this.database.getDefaultMap();
        for (let i = 0; i < set.length; i++) {
            const media = this.database.getMedia(set[i]);
            const tokens = this.makeMediaTokens(media);
            newTokenList[set[i]] = tokens;
            for (let j = 0; j < tokens.length; j++) {
                if (!newBucket[tokens[j]]) {
                    newBucket[tokens[j]] = 1;
                } else {
                    newBucket[tokens[j]]++;
                }
            }
            if (i % 100 == 0) {
                await this.wait();
            }
        }

        const keys = Object.keys(newBucket);
        for (let i = 0; i < keys.length; i++) {
            newBucket[keys[i]] = 1 / newBucket[keys[i]];
            if (i % 100 == 0) {
                await this.wait();
            }
        }

        await this.mutex.lock();
        this.tokenList = newTokenList;
        this.bucket = newBucket;
        this.mutex.release();
    }

    async search(str, set, limit) {
        await this.mutex.lock();
        const tokens = [];
        if (str) {
            const split = str.split(" ");
            for (let i = 0; i < split.length; i++) {
                tokens.push(split[i].toLowerCase().replace(/[^a-z0-9]/gi,''));
            }
        } else {
            throw {message: 'Failed to tokenize input string.'};
        }
        const scores = [];
        for (let i = 0; i < set.length; i++) {
            scores[set[i]] = 0;
            const mediaTokens = this.tokenList[set[i]];
            for (let j = 0; j < tokens.length; j++) {
                for (let k = 0; k < mediaTokens.length; k++) {
                    if (mediaTokens[k].includes(tokens[j])) {
                        scores[set[i]] += this.bucket[mediaTokens[k]];
                    }
                }
            }
            if (i % 500 == 0) {
                await this.wait();
            }
        }

        this.mutex.release();

        const keys = Object.keys(scores);
        keys.sort(function(a, b) {
            if (scores[a] > scores[b]) {
                return -1;
            }
            if (scores[a] < scores[b]) {
                return 1;
            }
            return 0;
        });

        const trimmedKeys = [];
        for (let i = 0; i < keys.length; i++) {
            if (scores[keys[i]] > 0) {
                trimmedKeys.push(keys[i]);
            }
        }

        if (limit) {
            const limitedKeys = [];
            for (let i = 0; i < limit && i < trimmedKeys.length; i++) {
                limitedKeys.push(trimmedKeys[i]);
            }
            return limitedKeys;
        } else {
            return trimmedKeys;
        }
    }

    getMediaTokens(media) {
        return this.tokenList[media.hash];
    }

    makeMediaTokens(media) {
        const tokens = [];
        for (let i = 0; i < media.tags.length; i++) {
            tokens.push(media.tags[i]);
        }
        function addMetadata(md) {
            if (md) {
                tokens.push(md.toLowerCase().replace(/[^a-z0-9]/gi,''));
            }
        }
        if (media.metadata) {
            addMetadata(media.metadata.artist);
            addMetadata(media.metadata.album);
            addMetadata(media.metadata.title);
        }
        for (let i = 0; i < media.actors.length; i++) {
            addMetadata(media.actors[i]);
        }
        const pathSplit = media.path.split("/");
        // Remove the extension from the final element.
        pathSplit[pathSplit.length - 1] = pathSplit[pathSplit.length - 1].split('.')[0];
        for (let i = 0; i < pathSplit.length; i++) {
            addMetadata(pathSplit[i]);
        }
        tokens.push(media.type);
        return tokens;
    }
}

module.exports = Search;
