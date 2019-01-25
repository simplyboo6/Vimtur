const Mongo = require('mongodb');
const Utils = require('../../utils');
const Util = require('util');
const DeepMerge = require('../../deep-merge');
const Path = require('path');
const FS = require('fs');

const DEFAULT_PORT = 27017;

async function each(query, callback) {
    return new Promise((resolve) => {
        query.forEach(callback, resolve);
    });
}

class MongoConnector {
    constructor(config) {
        this.config = config;
        this.config.database.port = (this.config.database.port == undefined) ? DEFAULT_PORT : this.config.database.port;
    }

    async connect() {
        await this.close();

        const config = this.config.database;
        const auth = `${config.username || ''}${(config.username && config.password) ? ':' : ''}${config.password || ''}`
        const url = `mongodb://${auth}${auth ? '@' : ''}${config.host}${config.port ? ':' : ''}${config.port || ''}`;
        console.log(url);

        const MongoClient = Mongo.MongoClient;

        this.server = await Util.promisify(MongoClient.connect)(url, {
            useNewUrlParser: true
        });
        this.db = this.server.db(config.database);

        const mediaSchema = JSON.parse(await Util.promisify(FS.readFile)(__dirname + '/media.schema.json'));
        await Util.promisify(this.db.createCollection.bind(this.db))('media', {
            validator: { $jsonSchema: mediaSchema }
        });
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

    async getUserConfig() {
        const meta = this.db.collection('meta');
        const row = await Util.promisify(meta.findOne.bind(meta))({ _id: 'userconfig' });
        if (!row) {
            return {};
        }
        return row;
    }

    async saveUserConfig(config) {
        const meta = this.db.collection('meta');
        await Util.promisify(meta.updateOne.bind(meta))(
            {_id: 'userconfig'},
            { $set: config },
            { upsert: true }
        );
    }

    async getTags() {
        const meta = this.db.collection('meta');
        const row = await Util.promisify(meta.findOne.bind(meta))({ _id: 'tags' });
        if (!row) {
            return [];
        }
        return row.data.sort();
    }

    async addTag(tag) {
        const meta = this.db.collection('meta');
        await Util.promisify(meta.updateOne.bind(meta))(
            {_id: 'tags'},
            { $addToSet: { data: tag } },
            { upsert: true }
        );
    }

    async removeTag(tag) {
        const media = this.db.collection('media');
        await Util.promisify(media.updateMany.bind(media))(
            {},
            { $pull: { tags: tag } },
            { multi: true }
        );

        const meta = this.db.collection('meta');
        await Util.promisify(meta.updateOne.bind(meta))(
            {_id: 'tags'},
            { $pull: { data: tag } }
        );
    }

    async getActors() {
        const meta = this.db.collection('meta');
        const row = await Util.promisify(meta.findOne.bind(meta))({ _id: 'actors' });
        if (!row) {
            return [];
        }
        return row.data.sort();
    }

    async addActor(actor) {
        const meta = this.db.collection('meta');
        await Util.promisify(meta.updateOne.bind(meta))(
            { _id: 'actors' },
            { $addToSet: { data: actor } },
            { upsert: true }
        );
    }

    async removeActor(actor) {
        const media = this.db.collection('media');
        await Util.promisify(media.updateMany.bind(media))(
            {},
            { $pull: { actors: actor } },
            { multi: true }
        );

        const meta = this.db.collection('meta');
        await Util.promisify(meta.updateOne.bind(meta))(
            {_id: 'actors'},
            { $pull: { data: actor } }
        );
    }

    async getMedia(hash) {
        const media = this.db.collection('media');
        const result = await Util.promisify(media.findOne.bind(media))({ hash });
        if (result) {
            result.absolutePath = Path.resolve(this.config.libraryPath, result.path);
        }
        return result;
    }

    async saveMedia(hash, media) {
        // Filter out various old fields we no longer require.
        if (media) {
            // This one is generated on get media and may be accidentally passed back.
            if (media.absolutePath !== undefined) {
                delete media.absolutePath;
            }
            if (media.transcode !== undefined) {
                delete media.transcode;
            }
            if (media.cached !== undefined) {
                delete media.cached;
            }
        }
        const collection = this.db.collection('media');
        if (await this.getMedia(hash)) {
            await Util.promisify(collection.updateOne.bind(collection))({hash}, { $set: media });
        } else {
            await Util.promisify(collection.insertOne.bind(collection))(media);
        }
        return await this.getMedia(hash);
    }

    async removeMedia(hash) {
        const media = this.db.collection('media');
        await Util.promisify(media.deleteOne.bind(media))({ hash });
    }

    async subset(constraints, fields) {
        const mediaCollection = this.db.collection('media');
        constraints = constraints || {};

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

        if (constraints.dir !== undefined) {
            query['dir'] = constraints.dir;
        };

        if (constraints.keywordSearch) {
            query['$text'] = {
                $search: constraints.keywordSearch
            };
        }

        if (constraints.corrupted !== undefined) {
            query['corrupted'] = constraints.corrupted;
        }

        if (constraints.cached !== undefined) {
            query['metadata'] = { $exists: constraints.cached };
        }

        let queryResult = mediaCollection.find(query).project(Object.assign({
            score: {
                $meta: 'textScore'
            },
            hash: 1,
            _id: 0
        }, fields));

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

        // If additional fields are specified then return the extras.
        if (fields) {
            return result;
        }

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
    const db = new MongoConnector(config);
    while (true) {
        try {
            await db.connect();
            break;
        } catch (err) {
            console.log(err.message);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    return db;
}

module.exports = {
    setup
};
