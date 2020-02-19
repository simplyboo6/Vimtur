import { Database, RouterTask } from '../types';

export class Uncorrupter {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Mark all media as not corrupted (Allows retrying other tasks)',
      runner: async () => {
        await database.saveBulkMedia({ corrupted: true }, { corrupted: false });
      },
    };
  }
}
