import * as Utils from './utils.js';

class PRNG {
    constructor(seed) {
        this.seed = seed;
    }
    nextFloat() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        const rnd = this.seed / 233280;

        return rnd;
    }
}

function shuffleArray(array, seed) {
    if (!seed && seed !== 0) {
        seed = Math.random();
    }
    const prng = new PRNG(seed);
    let currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
        // Pick a remaining element...
        randomIndex = Math.floor(prng.nextFloat() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }

    return array;
}

class AppData {
    constructor() {
        Object.assign(this, {
            tags: [],
            actors: [],
            imageSet: {
                current: 0,
                map: [],
                shuffleMap: null,
                galleryOffset: 0,
                constraints: {}
            },
            config: {},
            socket: io(),
            DEFAULT_COLUMN_COUNT: 1,
            MAX_COLUMNS: 10,
            callbacks: {}
        });

        const $this = this;
        this.socket.on('scanStatus', function(data) {
            $this.scanStatus = data;
            $this.fire('scanStatus');
        });

        this.socket.on('message', function(data) {
            $this.fire('message', data);
        });
    }

    on(event, callback) {
        this.callbacks[event] = callback;
    }

    async fire(event, data) {
        if (event !== 'state') {
            this.updateState();
        }
        if (event == 'change') {
            this.currentImage = await Utils.request(`/api/images/${this.getMap()[this.imageSet.current]}`);
            await this.fire('actors', false);
            await this.fire('tags', false);
            await this.fire('title');
        }
        if (this.callbacks[event]) {
            this.callbacks[event](data);
        }
    }

    async fetchAll() {
        this.actors = await Utils.request('/api/actors');
        this.tags = await Utils.request('/api/tags');
        this.config = (await Utils.request('/api/config')).config;

        try {
            if (window.location.hash) {
                const str = window.location.hash.substring(1);
                const state = JSON.parse(decodeURIComponent(str));
                await this.getSubset(state.constraints, { preserve: false, noUpdate: true });
                if (!isNaN(state.seed)) {
                    await this.shuffle({ preserve: false, seed: state.seed, noUpdate: true });
                }
                await this.goto(state.hash);
            } else {
                throw new Error('Hash not defined');
            }
        } catch (err) {
            await this.getSubset({ type: ['still'] }, { preserve: false, noUpdate: true });
            if (this.imageSet.map.length == 0) {
                await this.getSubset({}, { preserve: false, noUpdate: true });
            }
            if (this.imageSet.map.length > 0) {
                await this.shuffle();
            }
        }
        
        await this.fire('tags', true);
        await this.fire('actors', true);
    }

    getColumnCount() {
        let colCount = this.DEFAULT_COLUMN_COUNT;
        if (this.config.user && this.config.user.tagColumnCount) {
            console.log(`Config column count: ${this.config.user.tagColumnCount}`);
            colCount = this.config.user.tagColumnCount;
        }
        if (colCount > this.MAX_COLUMNS) {
            console.log('Warning, too many columns. Setting to max');
            colCount = this.MAX_COLUMNS;
        }
        return colCount;
    }

    isAutoplayEnabled() {
        // By default if autoplay is not defined then return that to make
        // if be disabled by default.
        return this.config &&
            this.config.user &&
            this.config.user.autoplayEnabled;
    }

    isStateEnabled() {
        // By default if autoplay is not defined then return that to make
        // if be disabled by default.
        return this.config &&
            this.config.user &&
            this.config.user.stateEnabled;
    }

    getMap() {
        if (this.imageSet.shuffleMap) {
            return this.imageSet.shuffleMap;
        }
        return this.imageSet.map;
    }

    async getSubset(constraints, options) {
        if (!options) {
            options = {};
        }
        const hash = this.currentImage ? this.currentImage.hash : null;
        const result = await Utils.post(`/api/images/subset`, constraints);
        if (result.length <= 0) {
            return false;
        }
        this.imageSet.constraints = constraints;
        this.imageSet.seed = null;
        this.imageSet.map = result;
        this.imageSet.shuffleMap = null;
        if (options.noUpdate) {
            return true;
        }
        if (options.preserve && hash && this.imageSet.map.includes(hash)) {
            await this.goto(hash);
        } else {
            await this.goto(0);
        }
        return true;
    }

    async goto(id) {
        if (isNaN(id)) {
            const index = this.getMap().indexOf(id);
            if (index >= 0) {
                this.imageSet.current = index;
                await this.fire('change');
            }
        } else {
            let num = parseInt(id);
            if (num > 0 && num <= this.getMap().length) {
                num = num - 1;
            }
            this.imageSet.current = num;
            await this.fire('change');
        }
    }

    async next() {
        this.imageSet.current++;
        if (this.imageSet.current >= this.getMap().length) {
            this.imageSet.current = 0;
        }
        await this.fire('change');
    }

    async previous() {
        this.imageSet.current--;
        if (this.imageSet.current < 0) {
            this.imageSet.current = this.getMap().length - 1;
        }
        await this.fire('change');
    }

    async galleryNext() {
        this.imageSet.galleryOffset += Utils.GALLERY_COUNT;
        if (this.imageSet.galleryOffset >= this.getMap().length) {
            this.imageSet.galleryOffset = this.getMap().length - 1;
        }
        await this.fire('gallery');
    }

    async galleryPrevious() {
        this.imageSet.galleryOffset -= Utils.GALLERY_COUNT;
        if (this.imageSet.galleryOffset < 0) {
            this.imageSet.galleryOffset = 0;
        }
        await this.fire('gallery');
    }

    async galleryGoto(offset) {
        this.imageSet.galleryOffset = offset;
        await this.fire('gallery');
    }

    async shuffle(options) {
        if (!options) {
            options = {};
        }
        if (isNaN(options.seed)) {
            this.imageSet.seed = Math.random();
        } else {
            this.imageSet.seed = options.seed;
        }
        const hash = this.getMap()[this.imageSet.current];
        this.imageSet.shuffleMap = shuffleArray(this.imageSet.map.slice(0), this.imageSet.seed);
        if (options.noUpdate) {
            return true;
        }
        if (options.preserve && hash && this.imageSet.map.includes(hash)) {
            await this.goto(hash);
        } else {
            await this.goto(0);
        }

        return true;
    }
    
    async unshuffle() {
        const hash = this.getMap()[this.imageSet.current];
        this.imageSet.shuffleMap = null;
        this.imageSet.seed = null;
        await this.goto(hash);
    }

    async updateState() {
        // Update the URL to be the current state.
        if (this.getMap() && this.imageSet.constraints) {
            const state = {
                constraints: this.imageSet.constraints,
                hash: this.getMap()[this.imageSet.current]
            };
            if (state.hash) {
                if (this.imageSet.seed !== null && this.imageSet.seed !== undefined) {
                    state.seed = this.imageSet.seed;
                }
                const stateText = `#${encodeURIComponent(JSON.stringify(state))}`;
                this.fire('state', stateText);
                if (this.isStateEnabled()) {
                    window.location.hash = stateText;
                }
            }
        } else {
            console.log('Map or constraints undefined', this.getMap().length, this.imageSet.constraints);
        }
    }

    async deleteCurrent() {
        if (!this.currentImage) {
            throw new Error('No image found to delete');
        }
        await Utils.remove(`/api/images/${this.currentImage.hash}`);
        this.imageSet.map.splice(this.imageSet.map.indexOf(this.currentImage.hash), 1);
        if (this.imageSet.shuffleMap) {
            const index = this.imageSet.shuffleMap.indexOf(this.currentImage.hash);
            if (index >= 0) {
                this.imageSet.shuffleMap.splice(index, 1);
            }
        }
        if (this.imageSet.current >= this.getMap().length) {
            this.imageSet.current = 0;
        }
        await this.fire('change');
    }

    async addTag(tag, hash) {
        if (hash) {
            this.currentImage.tags.push(tag);
            this.currentImage.tags.sort();
            const result = await Utils.post(`/api/images/${hash}`, {
                tags: this.currentImage.tags
            });
            if (this.currentImage && this.currentImage.hash == hash) {
                this.currentImage = result;
                await this.fire('tags', false);
            }
        } else {
            this.tags = await Utils.post('/api/tags', {tag});
            await this.fire('tags', true);
        }
    }

    async removeTag(tag, hash) {
        if (hash) {
            const tagIndex = this.currentImage.tags.indexOf(tag);
            if (tagIndex < 0) {
                return;
            }
            this.currentImage.tags.splice(tagIndex, 1);
            const result = await Utils.post(`/api/images/${hash}`, {
                tags: this.currentImage.tags
            });
            if (this.currentImage && this.currentImage.hash == hash) {
                this.currentImage = result;
                await this.fire('tags', false);
            }
        } else {
            this.tags = await Utils.remove(`/api/tags/${tag}`);
            if (this.currentImage && this.currentImage.tags.includes(tag)) {
                this.currentImage.tags.splice(this.currentImage.tags.indexOf(tag), 1);
            }
            await this.fire('tags', true);
        }
    }

    async addActor(actor, hash) {
        if (!this.actors.includes(actor)) {
            this.actors = await Utils.post('/api/actors', {actor});
            this.fire('actors', true);
        }
        if (hash) {
            this.currentImage.actors.push(actor);
            this.currentImage.actors.sort();
            const result = await Utils.post(`/api/images/${hash}`, {
                actors: this.currentImage.actors
            });
            if (this.currentImage && this.currentImage.hash == hash) {
                this.currentImage = result;
                await this.fire('actors', false);
            }
        }
    }

    async removeActor(actor, hash) {
        if (hash) {
            const actorIndex = this.currentImage.actors.indexOf(actor);
            if (actorIndex < 0) {
                return;
            }
            this.currentImage.actors.splice(actorIndex, 1);
            const result = await Utils.post(`/api/images/${hash}`, {
                actors: this.currentImage.actors
            });
            if (this.currentImage && this.currentImage.hash == hash) {
                this.currentImage = result;
                await this.fire('actors', false);
            }
        } else {
            this.actors = await Utils.remove(`/api/actors/${actor}`);
            if (this.currentImage && this.currentImage.actors.includes(actor)) {
                this.currentImage.actors.splice(this.currentImage.actors.indexOf(actor), 1);
            }
            this.fire('actors', true);
        }
    }

    async update(hash, data) {
        await Utils.post(`/api/images/${hash}`, data);
        if (this.currentImage && hash == this.currentImage.hash) {
            Object.assign(this.currentImage, data);
            if (data.metadata) {
                await this.fire('title');
            }
        }
    }

    async updateSet(map, data) {
        // Copy the map in case the user changes search parameters while applying.
        const copy = map.slice(0);
        for (let i = 0; i < copy.length; i++) {
            await this.update(copy[i], data);
        }
    }

    async importNew(deleteClones) {
        await Utils.request(`/api/scanner/index${deleteClones ? '?deleteClones=true' : ''}`);
    }

    async scan() {
        await Utils.request('/api/scanner/scan');
    }

    async importAll(deleteClones) {
        await Utils.request(`/api/scanner/import${deleteClones ? '?deleteClones=true' : ''}`);
    }

    async deleteMissing() {
        await Utils.request('/api/scanner/deleteMissing');
        await this.scan();
    }

    async runCache() {
        await Utils.request('/api/scanner/cache');
    }

    async rebuildIndex() {
        await Utils.request('/api/search/rebuildIndex');
    }

    async saveConfig(config) {
        const result = await Utils.post('/api/config', config);
        this.config = result.config;
    }
}

export default (new AppData);
