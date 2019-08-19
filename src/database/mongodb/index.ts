import { Db, MongoClient } from 'mongodb';
import FS from 'fs';
import Path from 'path';
import StripJsonComments from 'strip-json-comments';
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
import { Updater } from './updater';
import { Validator } from '../../utils/validator';
import Config from '../../config';

interface Actor {
  name: string;
}

interface Tag {
  name: string;
}

export class MongoConnector extends Database {
  private server: MongoClient;
  private db: Db;
  private mediaValidator: Validator;

  public static async init(): Promise<Database> {
    const server = await MongoConnector.connect();

    if (!require.main) {
      throw new Error('require.main not found');
    }

    const mediaSchemaPath = `${__dirname}/../../media.schema.json`;
    const rawSchema = await Util.promisify(FS.readFile)(mediaSchemaPath);
    const mediaSchema = JSON.parse(StripJsonComments(rawSchema.toString()));
    // The $schema element isn't supported by Mongo.
    if (mediaSchema['$schema']) {
      delete mediaSchema['$schema'];
    }
    mediaSchema.properties['_id'] = {};

    const connector = new MongoConnector(server, await Validator.load(mediaSchemaPath));

    await Updater.apply(connector.db, mediaSchema);

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
        });
        break;
      } catch (err) {
        console.warn('Failed to connect to database, retrying in 10 seconds', err.message);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  private constructor(server: MongoClient, mediaValidator: Validator) {
    super();
    this.server = server;
    const dbName = Config.get().database.db;
    console.log(`Using database: ${dbName}`);
    this.db = this.server.db(dbName);
    this.mediaValidator = mediaValidator;
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
    await tags.insertOne({ name: tag });
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
    await actors.insertOne({ name: actor });
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
      await collection.updateOne({ hash }, { $set: media });
    } else {
      // If it's a new one then pre-validate it to show better errors.
      const result = this.mediaValidator.validate(media);
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

  public async subsetFields(
    constraints: SubsetConstraints,
    fields: SubsetFields,
  ): Promise<BaseMedia[]> {
    console.log('subset', constraints);
    const mediaCollection = this.db.collection<BaseMedia>('media');

    const query: any = {};

    if (constraints.any === '*') {
      query['tags.0'] = { $exists: true };
    } else if (constraints.any) {
      query.tags = query.tags || {};
      query.tags['$in'] = constraints.any;
    }

    if (constraints.all) {
      query.tags = query.tags || {};
      query.tags['$all'] = constraints.all;
    }

    if (constraints.none === '*') {
      query['tags.0'] = { $exists: false };
    } else if (Array.isArray(constraints.none)) {
      query.tags = query.tags || {};
      query.tags['$nin'] = constraints.none;
    }

    if (constraints.quality) {
      if (constraints.quality.all) {
        query['metadata.qualityCache'] = { $all: constraints.quality.all };
      }
      if (constraints.quality.any) {
        query['metadata.qualityCache'] = { $in: constraints.quality.all };
      }
      if (constraints.quality.none) {
        query['metadata.qualityCache'] = { $nin: constraints.quality.all };
      }
    }

    if (constraints.type) {
      query.type = {
        $in: constraints.type,
      };
    }

    if (constraints.rating) {
      if (constraints.rating.max === 0) {
        query['$or'] = [{ rating: { $lte: 0 } }, { rating: { $exists: false } }];
      } else {
        query.rating = {};
        if (constraints.rating.min !== undefined) {
          query.rating['$gte'] = constraints.rating.min;
        }
        if (constraints.rating.max !== undefined) {
          query.rating['$lte'] = constraints.rating.max;
        }
      }
    }

    if (constraints.width) {
      query['metadata.width'] = {
        $gte: constraints.width,
      };
    }

    if (constraints.height) {
      query['metadata.height'] = {
        $gte: constraints.height,
      };
    }

    if (constraints.dir !== undefined) {
      query['dir'] = constraints.dir;
    }

    if (constraints.keywordSearch) {
      query['$text'] = {
        $search: constraints.keywordSearch,
      };
    }

    if (constraints.corrupted !== undefined) {
      if (constraints.corrupted) {
        query['corrupted'] = true;
      } else {
        query['corrupted'] = { $in: [null, false] };
      }
    }

    if (constraints.thumbnail !== undefined) {
      if (constraints.thumbnail) {
        query['thumbnail'] = true;
      } else {
        query['thumbnail'] = { $in: [null, false] };
      }
    }

    if (constraints.cached !== undefined) {
      query['metadata.qualityCache.0'] = { $exists: constraints.cached };
    }

    let queryResult = mediaCollection.find(query).project({
      ...fields,
      score: {
        $meta: 'textScore',
      },
      hash: 1,
      _id: 0,
    });

    if (constraints.keywordSearch) {
      queryResult = queryResult.sort({
        score: {
          $meta: 'textScore',
        },
        // After sorting by score put the highest rated after.
        rating: -1,
      });
    } else if (constraints.sortBy) {
      switch (constraints.sortBy) {
        case 'hashDate':
          queryResult = queryResult.sort({
            hashDate: 1,
          });
          break;
        default:
          throw new Error(`Unknown sortBy - ${constraints.sortBy}`);
      }
    }

    return queryResult.toArray();
  }

  public async subset(constraints: SubsetConstraints): Promise<string[]> {
    const result = await this.subsetFields(constraints, { hash: 1 });
    return result.map(media => media.hash);
  }

  public async close(): Promise<void> {
    await this.server.close();
  }
}
