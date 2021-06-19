import Config from '../config';
import type { Database } from '../types';

import { MongoConnector } from './mongodb';

export async function setup(): Promise<Database> {
  const dbConfig = Config.get().database;
  if (!dbConfig) {
    throw new Error('db config missing');
  }
  switch (dbConfig.provider) {
    case 'mongodb':
      return MongoConnector.init();
    default:
      throw new Error(`Unsupported database type: ${dbConfig.provider}`);
  }
}
