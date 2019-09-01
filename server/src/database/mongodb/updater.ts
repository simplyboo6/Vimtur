import { Collection, Db } from 'mongodb';
import Config from '../../config';
import Util from 'util';

export class Updater {
  public static async apply(db: Db, mediaSchema: object): Promise<void> {
    if (!(await db.listCollections({ name: 'updates' }).hasNext())) {
      console.log('Updates collection does not exist, running original setup');
      // The v1 of out MongoDb collections
      await Updater.initialSetup(db, mediaSchema);
    }

    const updatesCollection = db.collection('updates');
    await db.createCollection('updates');
    await Util.promisify((updatesCollection.createIndex as any).bind(updatesCollection))(
      { name: 1 },
      { unique: true },
    );

    if (!(await Updater.hasRun(updatesCollection, '001_update_media_with_keyframes'))) {
      console.log('Applying update 001_update_media_with_keyframes...');
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
      await Updater.saveUpdate(updatesCollection, '001_update_media_with_keyframes');
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
}
