import { Db, MongoClient } from 'mongodb';
import { describe } from 'mocha';

import { MongoConnector } from '../database/mongodb';
import Config from '../config';

import { createDatabaseTests } from './database';

describe('MongoDB Tests', () => {
  const database = MongoConnector.init();
  let connection: MongoClient;
  let mongo: Db;

  before(async () => {
    const config = Config.get().database;
    if (!config) {
      throw new Error('missing database config');
    }
    connection = await MongoClient.connect(config.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    const dbName = config.db;
    mongo = connection.db(dbName);
  });

  afterEach(async () => {
    await mongo.collection('playlists').deleteMany({});
    await mongo.collection('media').deleteMany({});
  });

  after(async () => {
    await connection.close();
  });

  createDatabaseTests(database);
});
