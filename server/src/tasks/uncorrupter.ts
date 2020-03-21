import { Database, RouterTask } from '../types';
import { execute } from 'proper-job';

export class Uncorrupter {
  public static getTask(database: Database): RouterTask {
    return {
      description: 'Mark all media as not corrupted (Allows retrying other tasks)',
      runner: () => {
        return execute(
          async () => {
            await database.saveBulkMedia({ corrupted: true }, { corrupted: false });
            return [];
          },
          () => Promise.resolve(),
        );
      },
    };
  }
}
