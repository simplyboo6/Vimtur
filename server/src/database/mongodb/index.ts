import { Db, MongoClient } from 'mongodb';
import Path from 'path';
import Util from 'util';

import { BadRequest } from '../../errors';
import {
  BaseMedia,
  Configuration,
  Database,
  Media,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
} from '../../types';
import { Insights } from '../../insights';
import { Updater } from './updater';
import { Validator } from '../../utils/validator';
import {
  createArrayFilter,
  createBooleanFilter,
  createNumberFilter,
  createStringFilter,
} from './utils';
import Config from '../../config';

interface Actor {
  name: string;
}

interface Tag {
  name: string;
}

const MEDIA_VALIDATOR = Validator.load('BaseMedia');

export class MongoConnector extends Database {
  private server: MongoClient;
  private db: Db;

  public static async init(): Promise<Database> {
    const server = await MongoConnector.connect();

    const connector = new MongoConnector(server);

    await Updater.apply(connector.db);

    return connector;
  }

  private static async connect(): Promise<MongoClient> {
    const config = Config.get().database;
    console.log(config.uri);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await MongoClient.connect(config.uri, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        });
        break;
      } catch (err) {
        console.warn('Failed to connect to database, retrying in 10 seconds', err.message);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  private constructor(server: MongoClient) {
    super();
    this.server = server;
    const dbName = Config.get().database.db;
    console.log(`Using database: ${dbName}`);
    this.db = this.server.db(dbName);
  }

  public async getUserConfig(): Promise<Configuration.Partial> {
    const meta = this.db.collection('config');
    const row = await meta.findOne({ _id: 'userconfig' });
    if (!row) {
      return {};
    }
    // The projection doesn't seem to remove _id so do it manually.

    delete row['_id'];
    return row;
  }

  public async saveUserConfig(config: Configuration.Partial): Promise<void> {
    const meta = this.db.collection('config');
    await meta.updateOne({ _id: 'userconfig' }, { $set: config }, { upsert: true });
  }

  public async getTags(): Promise<string[]> {
    const tags = this.db.collection<Tag>('tags');
    const rows = await tags.find({}).toArray();
    return rows.map(el => el.name).sort();
  }

  public async addTag(tag: string): Promise<void> {
    const tags = this.db.collection<Tag>('tags');
    try {
      await tags.insertOne({ name: tag });
    } catch (err) {
      if (err.message.startsWith('E11000 duplicate key')) {
        throw new BadRequest('Tag already exists');
      } else {
        throw err;
      }
    }
  }

  public async removeTag(tag: string): Promise<void> {
    const media = this.db.collection<BaseMedia>('media');
    await media.updateMany({}, { $pull: { tags: tag } });

    const tags = this.db.collection<Tag>('tags');
    await tags.deleteOne({ name: tag });
  }

  public async getActors(): Promise<string[]> {
    const actors = this.db.collection<Actor>('actors');
    const rows = await actors.find({}).toArray();
    return rows.map(el => el.name).sort();
  }

  public async addActor(actor: string): Promise<void> {
    const actors = this.db.collection<Actor>('actors');
    try {
      await actors.insertOne({ name: actor });
    } catch (err) {
      if (err.message.startsWith('E11000 duplicate key')) {
        throw new BadRequest('Actor already exists');
      } else {
        throw err;
      }
    }
  }

  public async removeActor(actor: string): Promise<void> {
    const media = this.db.collection<BaseMedia>('media');
    await Util.promisify(media.updateMany.bind(media))({}, { $pull: { actors: actor } });

    const actors = this.db.collection<Actor>('actors');
    await actors.deleteOne({ name: actor });
  }

  public async getMedia(hash: string): Promise<Media | undefined> {
    const media = this.db.collection<BaseMedia>('media');
    const result = await media.findOne({ hash });
    if (result) {
      return {
        ...result,
        absolutePath: Path.resolve(Config.get().libraryPath, result.path),
      };
    }
    return undefined;
  }

  public async resetClones(age: number): Promise<void> {
    const collection = this.db.collection<BaseMedia>('media');
    const result = await collection.updateMany(
      { cloneDate: { $lt: age } },
      { $unset: { clones: '' } },
    );
    console.log(`resetClones: ${result.matchedCount} reset`);
  }

  public async saveBulkMedia(constraints: SubsetConstraints, media: UpdateMedia): Promise<number> {
    console.log('Save Bulk', constraints, media);

    const collection = this.db.collection('media');

    // Filter out various old fields we no longer require.
    // This one is generated on get media and may be accidentally passed back.
    const oldMedia = media as any;
    if (oldMedia.absolutePath !== undefined) {
      delete oldMedia.absolutePath;
    }
    if (oldMedia.transcode !== undefined) {
      delete oldMedia.transcode;
    }
    if (oldMedia.cached !== undefined) {
      delete oldMedia.cached;
    }

    // Map all metadata keys to avoid over-writes, if the media already exists.
    if (media.metadata) {
      for (const key of Object.keys(media.metadata)) {
        (media as any)[`metadata.${key}`] = (media.metadata as any)[key];
      }
      delete media.metadata;
    }

    const result = await collection.updateMany(this.buildMediaMatch(constraints), { $set: media });
    return result.matchedCount;
  }

  public async saveMedia(hash: string, media: UpdateMedia): Promise<Media> {
    // Filter out various old fields we no longer require.
    // This one is generated on get media and may be accidentally passed back.
    const oldMedia = media as any;
    if (oldMedia.absolutePath !== undefined) {
      delete oldMedia.absolutePath;
    }
    if (oldMedia.transcode !== undefined) {
      delete oldMedia.transcode;
    }
    if (oldMedia.cached !== undefined) {
      delete oldMedia.cached;
    }

    const collection = this.db.collection<BaseMedia>('media');
    if (await this.getMedia(hash)) {
      // Map all metadata keys to avoid over-writes, if the media already exists.
      if (media.metadata) {
        for (const key of Object.keys(media.metadata)) {
          (media as any)[`metadata.${key}`] = (media.metadata as any)[key];
        }
        delete media.metadata;
      }
      await collection.updateOne({ hash }, { $set: media as any });
    } else {
      // If it's a new one then pre-validate it to show better errors.
      const result = MEDIA_VALIDATOR.validate(media);
      if (!result.success) {
        throw new BadRequest(result.errorText!);
      }

      await collection.insertOne(media as any);
    }

    return (await this.getMedia(hash))!;
  }

  public async removeMedia(hash: string): Promise<void> {
    const media = this.db.collection<BaseMedia>('media');
    await media.deleteOne({ hash });
  }

  public async addMediaTag(hash: string, tag: string): Promise<void> {
    await this.db.collection<BaseMedia>('media').updateOne({ hash }, { $addToSet: { tags: tag } });
  }

  public async removeMediaTag(hash: string, tag: string): Promise<void> {
    await this.db.collection<BaseMedia>('media').updateOne({ hash }, { $pull: { tags: tag } });
  }

  public async addMediaActor(hash: string, actor: string): Promise<void> {
    await this.db
      .collection<BaseMedia>('media')
      .updateOne({ hash }, { $addToSet: { actors: actor } });
  }

  public async removeMediaActor(hash: string, actor: string): Promise<void> {
    await this.db.collection<BaseMedia>('media').updateOne({ hash }, { $pull: { actors: actor } });
  }

  public async subsetFields(
    constraints: SubsetConstraints,
    fields?: SubsetFields,
  ): Promise<BaseMedia[]> {
    const mediaCollection = this.db.collection<BaseMedia>('media');

    const pipeline: object[] = [{ $match: this.buildMediaMatch(constraints) }];

    if (constraints.sample) {
      pipeline.push({ $sample: { size: constraints.sample } });
    }

    const sort: object = {};
    if (constraints.sortBy) {
      switch (constraints.sortBy) {
        case 'hashDate': // Fallthrough
        case 'rating':
          Object.assign(sort, { [constraints.sortBy]: -1 });
          break;
        case 'path':
          Object.assign(sort, { [constraints.sortBy]: 1 });
          break;
        case 'length': // Fallthrough
        case 'createdAt':
          Object.assign(sort, { [`metadata.${constraints.sortBy}`]: -1 });
          break;
        case 'recommended': // Skip, handled by subset wrapper.
          break;
        default:
          throw new Error(`Unknown sortBy - ${constraints.sortBy}`);
      }
    }

    if (constraints.keywordSearch) {
      pipeline.push({ $addFields: { score: { $meta: 'textScore' } } });
      pipeline.push({
        $sort: {
          score: {
            $meta: 'textScore',
          },
          ...sort,
        },
      });
    } else if (Object.keys(sort).length > 0) {
      pipeline.push({
        $sort: sort,
      });
    }

    pipeline.push({
      $project: fields || {
        hash: 1,
      },
    });

    return mediaCollection.aggregate(pipeline).toArray();
  }

  public async subset(constraints: SubsetConstraints): Promise<string[]> {
    const result = await this.subsetFields(constraints);
    const mapped = result.map(media => media.hash);

    if (constraints.sortBy === 'recommended') {
      const insights = new Insights(this);
      console.time('Generating analytics');
      const metadata = await insights.analyse();
      console.timeEnd('Generating analytics');
      console.time('Scoring and sorting recommendations');
      const scored = await insights.getRecommendations(mapped, metadata);
      console.timeEnd('Scoring and sorting recommendations');
      return scored.map(el => el.hash);
    } else {
      return mapped;
    }
  }

  public async close(): Promise<void> {
    await this.server.close();
  }

  private buildMediaMatch(constraints: SubsetConstraints): object {
    console.log('subset', constraints);

    const filters: object[] = [];

    if (constraints.keywordSearch) {
      filters.push({ $text: { $search: constraints.keywordSearch } });
    }

    filters.push(createArrayFilter('tags', constraints.tags));
    filters.push(createArrayFilter('actors', constraints.actors));
    filters.push(createArrayFilter('type', constraints.type));

    filters.push(createStringFilter('metadata.artist', constraints.artist));
    filters.push(createStringFilter('metadata.album', constraints.album));
    filters.push(createStringFilter('metadata.title', constraints.title));
    filters.push(createStringFilter('dir', constraints.dir));
    filters.push(createStringFilter('path', constraints.path));

    filters.push(createNumberFilter('metadata.height', constraints.quality));
    filters.push(createNumberFilter('rating', constraints.rating));
    filters.push(createNumberFilter('metadata.length', constraints.length));

    filters.push(createBooleanFilter('corrupted', constraints.corrupted));
    filters.push(createBooleanFilter('thumbnail', constraints.thumbnail));
    filters.push(createBooleanFilter('preview', constraints.preview));

    if (constraints.phashed !== undefined) {
      filters.push({ phash: { $exists: constraints.phashed } });
    }

    if (constraints.cached !== undefined) {
      if (constraints.cached) {
        filters.push({
          $or: [{ 'metadata.qualityCache.0': { $exists: true } }, { type: { $ne: 'video' } }],
        });
      } else {
        filters.push({
          $and: [{ 'metadata.qualityCache.0': { $exists: false } }, { type: 'video' }],
        });
      }
    }

    if (constraints.indexed !== undefined) {
      filters.push({ metadata: { $exists: constraints.indexed } });
    }

    if (constraints.hasClones !== undefined) {
      filters.push({ 'clones.0': { $exists: constraints.hasClones } });
    }

    const filteredFilters = filters.filter(filter => Object.keys(filter).length > 0);

    if (filteredFilters.length === 0) {
      return {};
    }

    return {
      $and: filteredFilters,
    };
  }
}
