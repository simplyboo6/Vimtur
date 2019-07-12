import { Database } from '../types';
import { MongoConnector } from './mongodb';
import Config from '../config';

export async function setup(): Promise<Database> {
  switch (Config.get().database.provider) {
    case 'mongodb':
      return MongoConnector.init();
    default:
      throw new Error(`Unsupported database type: ${Config.get().database.provider}`);
  }
}
