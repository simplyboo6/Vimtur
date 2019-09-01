import Path from 'path';
import Types from '@vimtur/common';
import Walk from 'walk';

// Local
import { ImportUtils } from './import-utils';
import Config from '../config';

type FilterResults = Types.Scanner.FilterResults;

export class Scanner {
  public static async getFileList(): Promise<string[]> {
    const dir = Config.get().libraryPath;
    const options = {
      followLinks: false,
    };
    const walker = Walk.walk(dir, options);
    const files: string[] = [];

    walker.on('file', (root, fileStats, next) => {
      try {
        ImportUtils.getType(fileStats.name);
        files.push(Path.relative(dir, Path.resolve(root, fileStats.name)));
      } catch (err) {
        // Ignore
      } finally {
        next();
      }
    });

    return new Promise<string[]>(resolve => {
      walker.on('end', () => {
        resolve(files);
      });
    });
  }

  public static async filterNewAndMissing(
    databasePaths: string[],
    fileList: string[],
  ): Promise<FilterResults> {
    const results: FilterResults = {
      newPaths: [],
      missingPaths: [],
    };

    // These need to be maps because otherwise the duplication check
    // takes a bloody long time.
    const databasePathsMap = Scanner.arrayAsMap(databasePaths);
    const fileListMap = Scanner.arrayAsMap(fileList);

    // Throw some waits throughout here because this is quite intensive and blocking.
    await ImportUtils.wait();

    for (const file of fileList) {
      if (!databasePathsMap[file]) {
        results.newPaths.push(file);
      }
    }

    await ImportUtils.wait();

    for (const file of databasePaths) {
      if (!fileListMap[file]) {
        results.missingPaths.includes(file);
      }
    }

    await ImportUtils.wait();

    return results;
  }

  private static arrayAsMap(arr: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const el of arr) {
      result[el] = el;
    }
    return result;
  }
}
