import { Collection, Db } from 'mongodb';
import { Validator } from '../../utils/validator';
import Config from '../../config';
import Util from 'util';

export class Updater {
  public static async apply(db: Db): Promise<void> {
    const oldRebuildUpdates: string[] = [
      '001_update_media_with_keyframes',
      '003_add_mhHash_field',
      '004_add_clone_map',
      '005_remove-segment-copy-ts',
      '006_add_preview',
    ];

    const updatesCollection = db.collection('updates');
    await db.createCollection('updates');
    await Util.promisify((updatesCollection.createIndex as any).bind(updatesCollection))(
      { name: 1 },
      { unique: true },
    );

    if (!(await db.listCollections({ name: 'updates' }).hasNext())) {
      console.log('Updates collection does not exist, running original setup');
      // The v1 of out MongoDb collections
      const currentSchema = Updater.loadMediaSchema();
      await Updater.initialSetup(db, currentSchema);
      const completed: string[] = [...oldRebuildUpdates, '002_fix_prefixed_dir_names'];
      await Promise.all(completed.map(key => Updater.saveUpdate(updatesCollection, key)));
    }

    const runOldRebuilds = await Promise.all(
      oldRebuildUpdates.map(key => Updater.hasRun(updatesCollection, key)),
    );
    if (runOldRebuilds.find(run => !run)) {
      console.log('Running old bulk rebuild...');
      const mediaSchema = Updater.loadMediaSchema('077a1332');
      const collection = db.collection('media');
      await collection.updateMany({ type: 'video' }, { $unset: { 'metadata.segments.copy': '' } });

      await Updater.recreateMediaCollection(db, mediaSchema);
      await Promise.all(oldRebuildUpdates.map(key => Updater.saveUpdate(updatesCollection, key)));
      console.log('Old bulk rebuild complete');
    }

    if (!(await Updater.hasRun(updatesCollection, '002_fix_prefixed_dir_names'))) {
      // This is only the case with older collections pre-TS conversion.
      // This won't work if the collection has been moved.
      console.log('Applying update 002_fix_prefixed_dir_names...');
      const cursor = db.collection('media').find({});
      while (await cursor.hasNext()) {
        const media = await cursor.next();
        console.log(media.dir, Config.get().libraryPath);
        if (media.dir.startsWith(Config.get().libraryPath)) {
          let dir = media.dir.substring(Config.get().libraryPath.length);
          if (dir.startsWith('/')) {
            dir = dir.substring(1);
          }
          await db.collection('media').updateOne({ hash: media.hash }, { $set: { dir } });
        }
      }

      await Updater.saveUpdate(updatesCollection, '002_fix_prefixed_dir_names');
    }

    if (!(await Updater.hasRun(updatesCollection, '007_add_rating_index'))) {
      console.log('Applying update 007_add_rating_index...');
      const collection = db.collection('media');
      await Util.promisify((collection.createIndex as any).bind(collection))(
        { rating: 1 },
        { unique: false },
      );
      await Updater.saveUpdate(updatesCollection, '007_add_rating_index');
    }

    if (!(await Updater.hasRun(updatesCollection, '008_remove-segment-copy-ts-properly'))) {
      console.log('Applying update 008_remove-segment-copy-ts-properly...');
      const mediaSchema = Updater.loadMediaSchema('1dba1b82');
      await Updater.recreateMediaCollection(db, mediaSchema);
      await Updater.saveUpdate(updatesCollection, '008_remove-segment-copy-ts-properly');
    }

    if (!(await Updater.hasRun(updatesCollection, '009_add-phash-resolutions'))) {
      console.log('Applying update 009_add-phash-resolutions...');
      const mediaSchema = Updater.loadMediaSchema('f33d9138');
      await Updater.recreateMediaCollection(db, mediaSchema);
      await Updater.saveUpdate(updatesCollection, '009_add-phash-resolutions');
    }

    if (!(await Updater.hasRun(updatesCollection, '010_add-created-at'))) {
      console.log('Applying update 010_add-created-at...');
      const mediaSchema = Updater.loadMediaSchema('9b0cfbc2');
      await Updater.recreateMediaCollection(db, mediaSchema);
      await Updater.saveUpdate(updatesCollection, '010_add-created-at');
    }

    // Media missing the PTS data completely broke streaming. This drops all those bad
    // caches. Should only need to be done once rather than a task.
    if (!(await Updater.hasRun(updatesCollection, '011_drop-invalid-segment-cache'))) {
      console.log('Applying update 011_drop-invalid-segment-cache...');
      await db
        .collection('media')
        .updateMany(
          { 'metadata.segments.standard.0.start': NaN },
          { $unset: { 'metadata.segments': '' } },
        );
      await Updater.saveUpdate(updatesCollection, '011_drop-invalid-segment-cache');
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
  }

  private static async initialSetup(db: Db, mediaSchema: object): Promise<void> {
    await Updater.createMediaCollection(db, mediaSchema, 'media');

    await db.createCollection('config');

    await db.createCollection('actors');
    const actorsCollection = db.collection('config');
    await Util.promisify((actorsCollection.createIndex as any).bind(actorsCollection))(
      { name: 1 },
      { unique: true },
    );

    await db.createCollection('tags');
    const tagsCollection = db.collection('tags');
    await Util.promisify((tagsCollection.createIndex as any).bind(tagsCollection))(
      { name: 1 },
      { unique: true },
    );
  }

  private static loadMediaSchema(version?: string): any {
    const mediaSchema = Validator.loadSchema('BaseMedia', version);
    // The $schema element isn't supported by Mongo.
    if (mediaSchema['$schema']) {
      delete mediaSchema['$schema'];
    }
    mediaSchema.properties['_id'] = {};

    return mediaSchema;
  }
}
