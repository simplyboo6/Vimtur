import 'source-map-support/register';

process.env.DATA_PATH='/tmp/vimtur_data';
process.env.CACHE_PATH='/tmp/vimtur_cache';

import { describe, afterEach } from 'mocha';
import { SqliteConnector } from '../database/sql/sqlite';
import { createDatabaseTests } from './database';

describe('SQLite Tests', () => {
  const database = SqliteConnector.init(':memory:');

  afterEach(async () => {
    const db = await database;
    await db.query([{
      sql: 'DELETE FROM playlists',
      run: true
    }]);
    await db.query([{
      sql: 'DELETE FROM media',
      run: true
    }]);
  });

  createDatabaseTests(database);
});
