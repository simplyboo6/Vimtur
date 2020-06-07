import { Db, MongoClient, ObjectId } from 'mongodb';
import Path from 'path';
import Util from 'util';

import { BadRequest, NotFound } from '../../errors';
import {
  BaseMedia,
  Configuration,
  Database,
  Media,
  Playlist,
  PlaylistCreate,
  PlaylistEntryUpdate,
  PlaylistUpdate,
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

  public async addPlaylist(request: PlaylistCreate): Promise<Playlist> {
    const playlists = this.db.collection('playlists');
    const result = await playlists.insertOne({ ...request, size: 0 });
    const fetched = await this.getPlaylist(result.insertedId.toHexString());
    if (!fetched) {
      throw new Error('Error adding playlist');
    }
    return fetched;
  }

  public async removePlaylist(id: string): Promise<void> {
    const media = this.db.collection('media');
    await media.updateMany(
      {
        'playlists._id': new ObjectId(id),
      },
      {
        $pull: {
          playlists: { _id: new ObjectId(id) },
        },
      },
    );

    const playlists = this.db.collection('playlists');
    await playlists.deleteOne({ _id: new ObjectId(id) });
  }

  public async updatePlaylist(id: string, request: PlaylistUpdate): Promise<void> {
    const playlists = this.db.collection('playlists');
    await playlists.updateOne({ _id: new ObjectId(id) }, { $set: request });
  }

  public getPlaylists(): Promise<Playlist[]> {
    const playlists = this.db.collection('playlists');

    return playlists
      .aggregate([
        {
          $addFields: {
            id: {
              $convert: {
                input: '$_id',
                to: 'string',
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
          },
        },
      ])
      .toArray();
  }

  public async getPlaylist(id: string): Promise<Playlist | undefined> {
    const playlists = this.db.collection('playlists');

    const raw = await playlists.findOne({ _id: new ObjectId(id) });
    if (!raw) {
      return undefined;
    }

    raw.id = raw._id.toHexString();
    delete raw._id;

    return raw;
  }

  public async addMediaToPlaylist(hash: string, playlistId: string): Promise<void> {
    const media = await this.getMedia(hash);
    if (!media) {
      throw new NotFound(`Media not found: ${hash}`);
    }

    if (media.playlists && media.playlists.find(playlist => playlist.id === playlistId)) {
      // If already in the playlist, then ignore.
      return;
    }

    const playlistCollection = this.db.collection('playlists');
    const updateResult = await playlistCollection.findOneAndUpdate(
      {
        _id: new ObjectId(playlistId),
      },
      {
        $inc: {
          size: 1,
        },
      },
    );

    if (!updateResult.value || !updateResult.ok) {
      throw new NotFound(`Playlist not found: ${playlistId}`);
    }
    const order = updateResult.value.size;
    const mediaCollection = this.db.collection('media');

    // If the update failed attempt a rollback, this may include ones
    // that have been added to the set after this one.
    const updateRollback = async (): Promise<void> => {
      // In an ideal world these need to be done in parallel, atomically.
      // Doing this one first at least means worse case is a gap of 1.

      await mediaCollection.updateMany(
        {
          'playlists._id': new ObjectId(playlistId),
        },
        {
          $inc: {
            'playlists.$[playlist].order': -1,
          },
        },
        {
          arrayFilters: [
            { 'playlist.order': { $gt: order }, 'playlist._id': new ObjectId(playlistId) },
          ],
        },
      );

      await playlistCollection.updateOne(
        {
          _id: new ObjectId(playlistId),
        },
        {
          $inc: {
            size: -1,
          },
        },
      );
    };

    try {
      const mediaUpdateResult = await mediaCollection.updateOne(
        {
          hash,
          'playlists._id': { $ne: new ObjectId(playlistId) },
        },
        {
          $push: {
            playlists: {
              _id: new ObjectId(playlistId),
              order,
            },
          },
        },
      );
      // If it's been added sometime between the initial check and now, rollback.
      if (mediaUpdateResult.modifiedCount === 0) {
        await updateRollback();
      }

      await playlistCollection.updateOne(
        {
          _id: new ObjectId(playlistId),
          thumbnail: { $exists: false },
        },
        {
          $set: { thumbnail: hash },
        },
      );
    } catch (err) {
      console.warn('Add to playlist failed', hash, playlistId, err);
      await updateRollback();
      throw err;
    }
  }

  public async removeMediaFromPlaylist(hash: string, playlistId: string): Promise<void> {
    const mediaCollection = this.db.collection('media');

    const result = await mediaCollection.findOneAndUpdate(
      {
        hash,
        'playlists._id': new ObjectId(playlistId),
      },
      {
        $pull: {
          playlists: { _id: new ObjectId(playlistId) },
        },
      },
    );

    if (result.ok && result.value) {
      const mediaPlaylist = result.value.playlists.find(
        (pl: any) => pl._id.toHexString() === playlistId,
      );
      if (!mediaPlaylist) {
        throw new Error(
          `Media playlist fetched and updated with no matching playlist (${hash}/${playlistId})`,
        );
      }

      await mediaCollection.updateMany(
        {
          'playlists._id': new ObjectId(playlistId),
        },
        {
          $inc: {
            'playlists.$[playlist].order': -1,
          },
        },
        {
          arrayFilters: [
            {
              'playlist.order': { $gt: mediaPlaylist.order },
              'playlist._id': new ObjectId(playlistId),
            },
          ],
        },
      );

      const playlistCollection = this.db.collection('playlists');

      await playlistCollection.updateOne(
        {
          _id: new ObjectId(playlistId),
        },
        {
          $inc: {
            size: -1,
          },
        },
      );
    }
  }

  public async updateMediaPlaylistOrder(
    hash: string,
    playlistId: string,
    update: PlaylistEntryUpdate,
  ): Promise<void> {
    const mediaCollection = this.db.collection('media');

    const matchedMedia = await this.subsetFields(
      {
        playlist: playlistId,
        hash: { equalsAll: [hash] },
      },
      { order: 1, hash: 1 },
    );

    const media = matchedMedia[0];
    if (!media) {
      throw new NotFound(`No media found: ${hash} that has playlist ${playlistId}`);
    }

    const playlist = await this.getPlaylist(playlistId);
    if (!playlist) {
      throw new NotFound(`No playlist found with id ${playlistId}`);
    }

    if (update.order >= playlist.size) {
      throw new BadRequest(
        `Requested location (${update.order}) is >= playlist size (${playlist.size})`,
      );
    }

    const newLocation = update.order;
    if (newLocation < 0) {
      throw new BadRequest(`Requested location (${update.order}) is less than 0`);
    }

    const existingLocation = media.order;
    if (existingLocation === undefined) {
      throw new Error('Could not retrieve existing location for media in playlist');
    }

    if (newLocation === existingLocation) {
      return;
    }

    if (newLocation > existingLocation) {
      await mediaCollection.updateMany(
        {
          'playlists._id': new ObjectId(playlistId),
        },
        {
          $inc: {
            'playlists.$[playlist].order': -1,
          },
        },
        {
          arrayFilters: [
            {
              'playlist.order': { $gt: existingLocation, $lte: newLocation },
              'playlist._id': new ObjectId(playlistId),
            },
          ],
        },
      );
    } else {
      await mediaCollection.updateMany(
        {
          'playlists._id': new ObjectId(playlistId),
        },
        {
          $inc: {
            'playlists.$[playlist].order': 1,
          },
        },
        {
          arrayFilters: [
            {
              'playlist.order': { $lt: existingLocation, $gte: newLocation },
              'playlist._id': new ObjectId(playlistId),
            },
          ],
        },
      );
    }

    await mediaCollection.updateOne(
      {
        hash,
        'playlists._id': new ObjectId(playlistId),
      },
      {
        $set: {
          'playlists.$.order': newLocation,
        },
      },
    );
  }

  public async getMedia(hash: string): Promise<Media | undefined> {
    const media = this.db.collection<BaseMedia>('media');
    const result = await media.findOne({ hash });
    if (result) {
      return {
        ...result,
        absolutePath: Path.resolve(Config.get().libraryPath, result.path),
        ...(result.playlists
          ? {
              playlists: result.playlists.map(playlist => ({
                id: (playlist as any)._id.toHexString(),
                order: playlist.order,
              })),
            }
          : {}),
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

  public async saveMedia(hash: string, media: UpdateMedia | BaseMedia): Promise<Media> {
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
      (media as BaseMedia).hash = hash;
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

    if (constraints.playlist) {
      if (!constraints.sortBy) {
        constraints.sortBy = 'order';
      }

      pipeline.push({
        $addFields: {
          playlist: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$playlists',
                  as: 'playlist',
                  cond: { $eq: ['$$playlist._id', new ObjectId(constraints.playlist)] },
                },
              },
              0,
            ],
          },
        },
      });

      pipeline.push({
        $addFields: {
          order: '$playlist.order',
          playlist: {
            $convert: {
              input: '$playlist._id',
              to: 'string',
            },
          },
        },
      });
    }

    const sort: object = {};
    if (constraints.sortBy) {
      switch (constraints.sortBy) {
        case 'hashDate': // Fallthrough
        case 'rating':
          Object.assign(sort, { [constraints.sortBy]: -1 });
          break;
        case 'order': // Fallthrough
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
    const filters: object[] = [];

    if (constraints.keywordSearch) {
      filters.push({ $text: { $search: constraints.keywordSearch } });
    }
    if (constraints.playlist) {
      filters.push({
        playlists: {
          $elemMatch: {
            _id: new ObjectId(constraints.playlist),
          },
        },
      });
    }

    filters.push(createArrayFilter('tags', constraints.tags));
    filters.push(createArrayFilter('actors', constraints.actors));
    filters.push(createArrayFilter('type', constraints.type));

    filters.push(createStringFilter('metadata.artist', constraints.artist));
    filters.push(createStringFilter('metadata.album', constraints.album));
    filters.push(createStringFilter('metadata.title', constraints.title));
    filters.push(createStringFilter('hash', constraints.hash));
    filters.push(createStringFilter('dir', constraints.dir));
    filters.push(createStringFilter('path', constraints.path));
    filters.push(createStringFilter('duplicateOf', constraints.duplicateOf));

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
