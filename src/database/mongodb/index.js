const Mongo = require('mongodb');
const Utils = require('../../utils');
const Util = require('util');
const DeepMerge = require('../../deep-merge');

const DEFAULT_PORT = 27017;

async function each(query, callback) {
    return new Promise((resolve) => {
        query.forEach(callback, resolve);
    });
}

class MongoConnector {
    constructor(config) {
        this.config = config;
        this.config.port = (this.config.port == undefined) ? DEFAULT_PORT : this.config.port;
    }

    async connect() {
        await this.close();

        const url = `mongodb://${this.config.username}:${this.config.password}@${this.config.host}:${this.config.port}/`;
        console.log(url);

        const MongoClient = Mongo.MongoClient;

        this.server = await Util.promisify(MongoClient.connect)(url, {
            useNewUrlParser: true
        });
        this.db = this.server.db(this.config.database);
        await Util.promisify(this.db.createCollection.bind(this.db))('media');
        await Util.promisify(this.db.createCollection.bind(this.db))('meta');
        
        const mediaCollection = this.db.collection('media');
        await Util.promisify(mediaCollection.createIndex.bind(mediaCollection))({
            'path': 'text',
            'type': 'text',
            'tags': 'text',
            'actors': 'text',
            'metadata.artist': 'text',
            'metadata.album': 'text',
            'metadata.title': 'text'
        },
        {
            'weights': {
                'path': 1,
                'type': 4,
                'tags': 2,
                'actors': 3,
                'metadata.artist': 2,
                'metadata.album': 3,
                'metadata.title': 3
            }
        });

        await Util.promisify(mediaCollection.createIndex.bind(mediaCollection))(
            { hash: 1 }, { unique: true }
        );
    }

    async getTags() {
        const meta = this.db.collection('meta');
        const row = await Util.promisify(meta.findOne.bind(meta))({ _id: 'tags' });
        if (!row) {
            return [];
        }
        return row.data;
    }

    async addTag(tag) {
        const tags = await this.getTags();
        if (!tags.includes(tag)) {
            tags.push(tag);
            tags.sort();
            const meta = this.db.collection('meta');
            await Util.promisify(meta.updateOne.bind(meta))({_id: 'tags'}, {data: tags});
        }
        return tags;
    }

    async removeTag(tag) {
        const tags = await this.getTags();
        if (tags.includes(tag)) {
            tags.splice(tags.indexOf(tag), 1);
            const meta = this.db.collection('meta');
            await Util.promisify(meta.updateOne.bind(meta))({_id: 'tags'}, {data: tags});
        }
        return tags;
    }

    async getActors() {
        const meta = this.db.collection('meta');
        const row = await Util.promisify(meta.findOne.bind(meta))({ _id: 'actors' });
        if (!row) {
            return [];
        }
        return row.data;
    }

    async addActor(actor) {
        const actors = await this.getActors();
        if (!actors.includes(actor)) {
            actors.push(actor);
            actors.sort();
            const meta = this.db.collection('meta');
            await Util.promisify(meta.updateOne.bind(meta))({_id: 'actors'}, {data: actors});
        }
        return actors;
    }

    async removeActor(actor) {
        const actors = await this.getActors();
        if (actors.includes(actor)) {
            actors.splice(actors.indexOf(actor), 1);
            const meta = this.db.collection('meta');
            await Util.promisify(meta.updateOne.bind(meta))({_id: 'actors'}, {data: actors});
        }
        return actors;
    }

    async getMedia(hash) {
        const media = this.db.collection('media');
        return await Util.promisify(media.findOne.bind(media))({ hash: hash });
    }

    async saveMedia(hash, media) {
        const existing = await this.getMedia(hash);
        const collection = this.db.collection('media');
        if (existing) {
            DeepMerge.merge(existing, media);
            await Util.promisify(collection.replaceOne.bind(collection))({hash}, existing);
        } else {
            await Util.promisify(collection.insertOne.bind(collection))(media);
        }
        return existing || media;
    }

    async subset(constraints) {
        const mediaCollection = this.db.collection('media');

        const query = {};

        if (constraints.any && constraints.any.length) {
            query.tags = query.tags || {};
            query.tags['$in'] = constraints.any;
        }
        if (constraints.all && constraints.all.length) {
            query.tags = query.tags || {};
            query.tags['$all'] = constraints.all;
        }
        if (constraints.none && constraints.none.length) {
            query.tags = query.tags || {};
            query.tags['$nin'] = constraints.none;
        }

        if (constraints.type && constraints.type.length) {
            query.type = {
                $in: constraints.type
            };
        }

        if (constraints.rating) {
            query.rating = {};
            if (constraints.rating.min !== undefined) {
                query.rating['$gte'] = constraints.rating.min;
            }
            if (constraints.rating.max !== undefined) {
                query.rating['$lte'] = constraints.rating.max;
            }
        }

        if (constraints.width) {
            query['metadata.width'] = {
                $gte: constraints.width
            };
        }

        if (constraints.height) {
            query['metadata.height'] = {
                $gte: constraints.height
            };
        }

        if (constraints.keywordSearch) {
            query['$text'] = {
                $search: constraints.keywordSearch
            };
        }

        let queryResult = mediaCollection.find(query).project({
            score: {
                $meta: 'textScore'
            },
            hash: 1,
            _id: 0
        });

        if (constraints.keywordSearch) {
            queryResult = queryResult.sort({
                score: {
                    $meta: 'textScore'
                },
                // After sorting by score put the highest rated after.
                rating: -1
            });
        }
        
        const result = await Util.promisify(queryResult.toArray.bind(queryResult))();

        const keys = [];
        for (const media of result) {
            keys.push(media['hash']);
        }
        return keys;
    }

    async close() {
        if (this.server) {
            this.server.close();
        }
        this.db = undefined;
        this.server = undefined;
    }

}

async function setup(config) {
    const db = new MongoConnector(config.database);
    await db.connect();
    return db;
}

module.exports = {
    setup
};
