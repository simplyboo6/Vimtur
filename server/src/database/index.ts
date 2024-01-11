import Path from 'path';
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
    case 'sqlite':
      return SqliteConnector.init({
        filename: Path.resolve(Config.get().cachePath, 'vimtur.db'),
        libraryPath: Config.get().libraryPath,
      });
    default:
      throw new Error(`Unsupported database type: ${dbConfig.provider}`);
  }
}
