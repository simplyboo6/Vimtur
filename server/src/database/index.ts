import Path from 'path';
import type { Configuration } from '@vimtur/common';
import Config from '../config';
import type { Database } from '../types';

import { MongoConnector } from './mongodb';
import { SqliteConnector } from './sqlite';
import { isInMemoryDatabase } from './sqlite/utils';

export async function setup(): Promise<Database> {
  const dbConfig = Config.get().database;
  if (!dbConfig) {
    throw new Error('db config missing');
  }
  switch (dbConfig.provider as string) {
    case 'mongodb':
      return MongoConnector.init();
    case 'sqlite': {
      const path = (Config.get().database as Configuration.SqliteDbConfig | undefined)?.path;
      if (path !== undefined && isInMemoryDatabase(path)) {
        // ':memory:' is a node:sqlite magic filename, not a path; pass it
        // through verbatim (used by API tests).
        return SqliteConnector.init({ filename: path, libraryPath: Config.get().libraryPath });
      }
      return SqliteConnector.init({
        filename: Path.resolve(path ?? Config.get().cachePath, 'vimtur.db'),
        libraryPath: Config.get().libraryPath,
      });
    }
    default:
      throw new Error(`Unsupported database type: ${dbConfig.provider}`);
  }
}
