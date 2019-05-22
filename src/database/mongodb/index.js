const MongoClient = require('mongodb').MongoClient;
const Utils = require('../../utils');
const DeepMerge = require('../../deep-merge');
const Path = require('path');
const FS = require('fs');
const Ajv = require('ajv');
const Util = require('util');
const BetterAjvErrors = require('better-ajv-errors');
const StripJsonComments = require('strip-json-comments');

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

        this.server = await MongoClient.connect(url, {
            useNewUrlParser: true
        });
        this.db = this.server.db(config.database);

        const rawSchema = await Util.promisify(FS.readFile)(__dirname + '/media.schema.json');
        this.mediaSchema = JSON.parse(StripJsonComments(rawSchema.toString()));

        await this.db.createCollection('media', {
            validator: { $jsonSchema: this.mediaSchema }
        });

        this.mediaValidator = Ajv().compile(this.mediaSchema);
        const mediaCollection = this.db.collection('media');
        await mediaCollection.createIndex({
            'path': 'text',
            'type': 'text',
            'tags': 'text',
            'actors': 'text',
            'metadata.artist': 'text',
            'metadata.album': 'text',
            'metadata.title': 'text'
        },
        {
            'name': 'keyword_index',
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

        await mediaCollection.createIndex(
            { hash: 1 }, { unique: true }
        );
        await mediaCollection.createIndex(
            { hashDate: 1 }, { unique: false }
        );

        await this.db.createCollection('config');

        await this.db.createCollection('actors');
        const actorsCollection = this.db.collection('config');
        await actorsCollection.createIndex(
            { name: 1 }, { unique: true }
        );

        await this.db.createCollection('tags');
        const tagsCollection = this.db.collection('tags');
        await tagsCollection.createIndex(
            { name: 1 }, { unique: true }
        );
    }

    async getUserConfig() {
        const meta = this.db.collection('config');
        const row = await meta.findOne({ _id: 'userconfig' });
        if (!row) {
            return {};
        }
        // The project doesn't seem to remove _id so do it manually.

        delete row['_id'];
        return row;
    }

    async saveUserConfig(config) {
        const meta = this.db.collection('config');
        await meta.updateOne(
            {_id: 'userconfig'},
            { $set: config },
            { upsert: true }
        );
    }

    async getTags() {
        const tags = this.db.collection('tags');
        const rows = await tags.find({}, { _id: 0 }).toArray();
        return rows.map(el => el.name).sort();
    }

    async addTag(tag) {
        const tags = this.db.collection('tags');
        await tags.insertOne({ name: tag });
    }

    async removeTag(tag) {
        const media = this.db.collection('media');
        await Util.promisify(media.updateMany.bind(media))(
            {},
            { $pull: { tags: tag } },
            { multi: true }
        );

        const tags = this.db.collection('tags');
        await tags.deleteOne({ name: tag });
    }

    async getActors() {
        const actors = this.db.collection('actors');
        const rows = await actors.find({}, { _id: 0 }).toArray();
        return rows.map(el => el.name).sort();
    }

    async addActor(actor) {
        const actors = this.db.collection('actors');
        await actors.insertOne({ name: actor });
    }

    async removeActor(actor) {
        const media = this.db.collection('media');
        await Util.promisify(media.updateMany.bind(media))(
            {},
            { $pull: { actors: actor } },
            { multi: true }
        );

        const actors = this.db.collection('actors');
        await actors.deleteOne({ name: actor });
    }

    async getMedia(hash) {
        const media = this.db.collection('media');
        const result = await media.findOne({ hash });
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
            // Map all metadata keys to avoid over-writes, if the media already exists.
            if (media.metadata) {
                for (const key of Object.keys(media.metadata)) {
                    media[`metadata.${key}`] = media.metadata[key];
                }
                delete media.metadata;
            }
            await Util.promisify(collection.updateOne.bind(collection))({hash}, { $set: media });
        } else {
            // If it's a new one then pre-validate it to show better errors.
            if (!this.mediaValidator(media)) {
                throw new Error(`New media failed to validate: ${JSON.stringify(BetterAjvErrors(this.mediaSchema, media, this.mediaValidator.errors), null, 2)}: ${JSON.stringify(this.mediaValidator.errors, null, 2)}`);
            }
            await collection.insertOne(media);
        }
        return await this.getMedia(hash);
    }

    async removeMedia(hash) {
        const media = this.db.collection('media');
        await media.deleteOne({ hash });
    }

    async subset(constraints, fields) {
        console.log('subset', constraints);
        const mediaCollection = this.db.collection('media');
        constraints = constraints || {};

        const query = {};

        if (constraints.any === '*') {
            query['tags.0'] = { $exists: true };
        } else if (Array.isArray(constraints.any) && constraints.any.length) {
            query.tags = query.tags || {};
            query.tags['$in'] = constraints.any;
        }

        if (Array.isArray(constraints.all) && constraints.all.length) {
            query.tags = query.tags || {};
            query.tags['$all'] = constraints.all;
        }

        if (constraints.none === '*') {
            query['tags.0'] = { $exists: false };
        } else if (Array.isArray(constraints.none) && constraints.none.length) {
            query.tags = query.tags || {};
            query.tags['$nin'] = constraints.none;
        }

        if (typeof(constraints.quality) === 'object') {
            if (Array.isArray(constraints.quality.all)) {
                query['metadata.qualityCache'] = { $all: constraints.quality.all };
            }
            if (Array.isArray(constraints.quality.any)) {
                query['metadata.qualityCache'] = { $in: constraints.quality.all };
            }
            if (Array.isArray(constraints.quality.none)) {
                query['metadata.qualityCache'] = { $nin: constraints.quality.all };
            }
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
            if (constraints.corrupted) {
                query['corrupted'] = true;
            } else {
                query['corrupted'] = { $in: [ null, false ] };
            }
        }

        if (constraints.thumbnail !== undefined) {
            if (constraints.thumbnail) {
                query['thumbnail'] = true;
            } else {
                query['thumbnail'] = { $in: [ null, false ] };
            }
        }

        if (constraints.cached !== undefined) {
            query['metadata.qualityCache.0'] = { $exists: constraints.cached };
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
        } else if (constraints.sortBy) {
            switch (constraints.sortBy) {
                case 'hashDate':
                    queryResult = queryResult.sort({
                        hashDate: 1
                    });
                    break;
                default:
                    throw new Error(`Unknown sortBy - ${constraints.sortBy}`);
            }
        }
        const result = await queryResult.toArray();

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
            console.warn('Failed to connect to database, retrying in 10 seconds', err.message);
            await new Promise((resolve) => setTimeout(resolve, 10000));
        }
    }
    return db;
}

module.exports = {
    setup
};
