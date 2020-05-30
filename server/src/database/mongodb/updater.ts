import { Collection, Db } from 'mongodb';
import { Validator } from '../../utils/validator';
import Util from 'util';

export class Updater {
  public static async apply(db: Db): Promise<void> {
    const updatesExists = await Updater.collectionExists(db, 'updates');

    const updatesCollection = db.collection('updates');

    if (!updatesExists) {
      console.log('Updates collection does not exist, running original setup');
      await db.createCollection('updates');
      await Util.promisify((updatesCollection.createIndex as any).bind(updatesCollection))(
        { name: 1 },
        { unique: true },
      );

      await Updater.saveUpdate(updatesCollection, '014_add-playlists');
    }

    await Updater.createCollections(db);

    if (!(await Updater.hasRun(updatesCollection, '014_add-playlists'))) {
      console.log('Applying update 014_add-playlists...');
      const mediaSchema = Updater.loadMediaSchema('ff1fa952');
      await Updater.recreateMediaCollection(db, mediaSchema);
      await Updater.saveUpdate(updatesCollection, '014_add-playlists');
    }
  }

  private static async recreateMediaCollection(db: Db, mediaSchema: object): Promise<void> {
    try {
      await db.collection('media_update').drop();
    } catch (err) {
      // Assume it doesn't exist.
    }
    console.log('Creating media_update collection...');
    await Updater.createMediaCollection(db, mediaSchema, 'media_update');

    console.log('Copying media to new collection (this may take some time)...');
    const cursor = db.collection('media').find({});
    while (await cursor.hasNext()) {
      await db.collection('media_update').insertOne(await cursor.next());
    }

    console.log('Renaming collections...');
    await db.collection('media').rename('media_old');
    await db.collection('media_update').rename('media');
    console.log('Dropping original...');
    await db.collection('media_old').drop();
  }

  private static async collectionExists(db: Db, name: string): Promise<boolean> {
    return db.listCollections({ name }).hasNext();
  }

  private static hasRun(updatesCollection: Collection, update: string): Promise<boolean> {
    return updatesCollection.find({ name: update }).hasNext();
  }

  private static async saveUpdate(updatesCollection: Collection, name: string): Promise<void> {
    console.log(`Saving update state: ${name}`);
    await updatesCollection.insertOne({ name });
  }

  private static async createMediaCollection(
    db: Db,
    mediaSchema: object,
    name: string,
  ): Promise<void> {
    await db.createCollection(name, {
      validator: { $jsonSchema: mediaSchema },
    });

    const mediaCollection = db.collection(name);
    // Bloody thing doesn't return a promise.
    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      {
        'path': 'text',
        'type': 'text',
        'tags': 'text',
        'actors': 'text',
        'metadata.artist': 'text',
        'metadata.album': 'text',
        'metadata.title': 'text',
      },
      {
        name: 'keyword_index',
        weights: {
          'path': 1,
          'type': 4,
          'tags': 2,
          'actors': 3,
          'metadata.artist': 2,
          'metadata.album': 3,
          'metadata.title': 3,
        },
      },
    ); // Bug with weights not being recognised.

    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      { hash: 1 },
      { unique: true },
    );
    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      { hashDate: 1 },
      { unique: false },
    );
    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      { rating: 1 },
      { unique: false },
    );

    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      { 'metadata.createdAt': 1 },
      { unique: false },
    );

    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      { path: 1 },
      { unique: false },
    );

    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))({
      aliases: 1,
    });
    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))({
      related: 1,
    });
    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))({
      unrelated: 1,
    });

    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))({
      duplicateOf: 1,
    });
  }

  private static async createCollections(db: Db): Promise<void> {
    await Updater.createMediaCollection(db, await Updater.loadMediaSchema(), 'media');

    if (!(await Updater.collectionExists(db, 'config'))) {
      await db.createCollection('config');
    }

    if (!(await Updater.collectionExists(db, 'actors'))) {
      await db.createCollection('actors');
      const actorsCollection = db.collection('actors');
      await Util.promisify((actorsCollection.createIndex as any).bind(actorsCollection))(
        { name: 1 },
        { unique: true },
      );
    }

    if (!(await Updater.collectionExists(db, 'tags'))) {
      await db.createCollection('tags');
      const tagsCollection = db.collection('tags');
      await Util.promisify((tagsCollection.createIndex as any).bind(tagsCollection))(
        { name: 1 },
        { unique: true },
      );
    }

    if (!(await Updater.collectionExists(db, 'playlists'))) {
      await db.createCollection('playlists');
      const playlistsCollection = db.collection('playlists');
      await Util.promisify((playlistsCollection.createIndex as any).bind(playlistsCollection))(
        { name: 1 },
        { unique: true },
      );
    }
  }

  private static loadMediaSchema(version?: string): any {
    const mediaSchema = Validator.loadSchema('BaseMedia', version);
    // The $schema element isn't supported by Mongo.
    if (mediaSchema['$schema']) {
      delete mediaSchema['$schema'];
    }
    // Patch in the _id
    mediaSchema.properties['_id'] = {};

    // If playlists exists then match id with _id.
    if (mediaSchema.properties['playlists']) {
      delete mediaSchema.properties['playlists'].items.properties.id;
      const index = mediaSchema.properties['playlists'].items.required.indexOf('id');
      if (index >= 0) {
        mediaSchema.properties['playlists'].items.required.splice(index, 1);
      }
      mediaSchema.properties['playlists'].items.properties['_id'] = {};
      mediaSchema.properties['playlists'].items.required.push('_id');
    }

    return mediaSchema;
  }
}
