import type { Collection, Db } from 'mongodb';

export class Updater {
  public static async apply(db: Db): Promise<void> {
    const updatesExists = await Updater.collectionExists(db, 'updates');

    const updatesCollection = db.collection('updates');

    if (!updatesExists) {
      console.log('Updates collection does not exist, running original setup');
      await db.createCollection('updates');
      await updatesCollection.createIndex({ name: 1 }, { unique: true });
      await Updater.saveUpdate(updatesCollection, '015_remove-validator');
    }

    await Updater.createCollections(db);

    // Remove the validator. Good experiment in strictness but updating it
    // was just mad. Rebuilding the DB for every change.
    if (!(await Updater.hasRun(updatesCollection, '015_remove-validator'))) {
      await db.command({
        collMod: 'media',
        validator: {},
        validationLevel: 'off',
      });
      await Updater.saveUpdate(updatesCollection, '015_remove-validator');
    }

    if (!(await Updater.hasRun(updatesCollection, '016_auto-tag-text-index'))) {
      const collection = db.collection('media');
      await collection.dropIndex('keyword_index');
      await Updater.createMediaCollectionTextIndex(db, 'media');
      await Updater.saveUpdate(updatesCollection, '016_auto-tag-text-index');
    }

    if (!(await Updater.hasRun(updatesCollection, '017_change-phash-method'))) {
      const collection = db.collection('media');
      await collection.updateMany({}, { $unset: { phash: 1 } });
      await Updater.saveUpdate(updatesCollection, '017_change-phash-method');
    }
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

  private static async createMediaCollectionTextIndex(db: Db, name: string): Promise<void> {
    const mediaCollection = db.collection(name);
    await mediaCollection.createIndex(
      {
        path: 'text',
        type: 'text',
        tags: 'text',
        autoTags: 'text',
        actors: 'text',
        'metadata.artist': 'text',
        'metadata.album': 'text',
        'metadata.title': 'text',
      },
      {
        name: 'keyword_index',
        weights: {
          // Least important to most
          path: 1,
          autoTags: 1,

          tags: 3,
          'metadata.artist': 5,

          'metadata.album': 7,
          'metadata.title': 7,

          actors: 8,

          type: 10,
        },
      },
    ); // Bug with weights not being recognised.
  }

  private static async createMediaCollection(db: Db, name: string): Promise<void> {
    await db.createCollection(name);

    await Updater.createMediaCollectionTextIndex(db, name);

    const mediaCollection = db.collection(name);

    await mediaCollection.createIndex({ hash: 1 }, { unique: true });
    await mediaCollection.createIndex({ hashDate: 1 }, { unique: false });
    await mediaCollection.createIndex({ rating: 1 }, { unique: false });

    await mediaCollection.createIndex({ 'metadata.createdAt': 1 }, { unique: false });

    await mediaCollection.createIndex({ path: 1 }, { unique: false });

    await mediaCollection.createIndex({
      aliases: 1,
    });
    await mediaCollection.createIndex({
      related: 1,
    });
    await mediaCollection.createIndex({
      unrelated: 1,
    });

    await mediaCollection.createIndex({
      duplicateOf: 1,
    });
  }

  private static async createCollections(db: Db): Promise<void> {
    if (!(await Updater.collectionExists(db, 'media'))) {
      await Updater.createMediaCollection(db, 'media');
    }

    if (!(await Updater.collectionExists(db, 'media.deleted'))) {
      await Updater.createMediaCollection(db, 'media.deleted');
      const deletedCollection = db.collection('media.deleted');
      await deletedCollection.createIndex({ hash: 1 }, { unique: true });
    }

    if (!(await Updater.collectionExists(db, 'config'))) {
      await db.createCollection('config');
    }

    if (!(await Updater.collectionExists(db, 'actors'))) {
      await db.createCollection('actors');
      const actorsCollection = db.collection('actors');
      await actorsCollection.createIndex({ name: 1 }, { unique: true });
    }

    if (!(await Updater.collectionExists(db, 'tags'))) {
      await db.createCollection('tags');
      const tagsCollection = db.collection('tags');
      await tagsCollection.createIndex({ name: 1 }, { unique: true });
    }

    if (!(await Updater.collectionExists(db, 'playlists'))) {
      await db.createCollection('playlists');
      const playlistsCollection = db.collection('playlists');
      await playlistsCollection.createIndex({ name: 1 }, { unique: true });
    }
  }
}
