import Util from 'util';

import type { Collection, Db } from 'mongodb';

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
    // Bloody thing doesn't return a promise.
    await Util.promisify((mediaCollection.createIndex as any).bind(mediaCollection))(
      {
        'path': 'text',
        'type': 'text',
        'tags': 'text',
        'autoTags': 'text',
        'actors': 'text',
        'metadata.artist': 'text',
        'metadata.album': 'text',
        'metadata.title': 'text',
      },
      {
        name: 'keyword_index',
        weights: {
          // Least important to most
          'path': 1,
          'autoTags': 1,

          'tags': 3,
          'metadata.artist': 5,

          'metadata.album': 7,
          'metadata.title': 7,

          'actors': 8,

          'type': 10,
        },
      },
    ); // Bug with weights not being recognised.
  }

  private static async createMediaCollection(db: Db, name: string): Promise<void> {
    await db.createCollection(name);

    await Updater.createMediaCollectionTextIndex(db, name);

    const mediaCollection = db.collection(name);

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
    if (!(await Updater.collectionExists(db, 'media'))) {
      await Updater.createMediaCollection(db, 'media');
    }

    if (!(await Updater.collectionExists(db, 'media.deleted'))) {
      await Updater.createMediaCollection(db, 'media.deleted');
      const deletedCollection = db.collection('media.deleted');
      await Util.promisify((deletedCollection.createIndex as any).bind(deletedCollection))(
        { hash: 1 },
        { unique: true },
      );
    }

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
}
