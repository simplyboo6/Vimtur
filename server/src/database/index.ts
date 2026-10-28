import Path from 'path';
import type { Configuration } from '@vimtur/common';
import Config from '../config';
import type { Database } from '../types';

import { MongoConnector } from './mongodb';
import { SqliteConnector } from './sqlite';

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
      return SqliteConnector.init({
        // ':memory:' is a better-sqlite3 magic value, not a path; pass it through
        // verbatim (used by API tests). Anything else is resolved against the
        // cache path like before.
        filename: path === ':memory:' ? path : Path.resolve(path ?? Config.get().cachePath, 'vimtur.db'),
        libraryPath: Config.get().libraryPath,
      });
    }
    default:
      throw new Error(`Unsupported database type: ${dbConfig.provider}`);
  }
}
