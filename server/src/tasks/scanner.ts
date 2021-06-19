import Path from 'path';

import { Router } from 'express';
import { execute } from 'proper-job';
import Walk from 'walk';
import type Types from '@vimtur/common';

// Local
import { ImportUtils } from '../cache/import-utils';
import { wrap } from '../express-async';
import Config from '../config';
import type { Database, RouterTask } from '../types';

type FilterResults = Types.Scanner.FilterResults;

export class Scanner {
  public static results?: FilterResults;

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

    return new Promise<string[]>((resolve) => {
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
      if (!fileListMap[file] && !results.missingPaths.includes(file)) {
        results.missingPaths.push(file);
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

export function getTask(db: Database): RouterTask {
  const router = Router();
  router.get(
    '/results',
    wrap(async () => {
      return {
        data: Scanner.results
          ? {
              newPaths: Scanner.results.newPaths.length,
              missingPaths: Scanner.results.missingPaths.length,
            }
          : {
              newPaths: 0,
              missingPaths: 0,
            },
      };
    }),
  );

  router.get(
    '/results/missing',
    wrap(async () => {
      return {
        data: Scanner.results ? Scanner.results.missingPaths : [],
      };
    }),
  );

  router.get(
    '/results/new',
    wrap(async () => {
      return {
        data: Scanner.results ? Scanner.results.newPaths : [],
      };
    }),
  );

  return {
    id: 'SCAN',
    description: 'Scan for new files',
    router,
    runner: () => {
      // There's no nice way to parallelise this one at a glance.
      // So just do it all in the init.
      return execute(
        async () => {
          const files = await Scanner.getFileList();
          const mediaList = await db.subsetFields({}, { path: 1 });
          const normalisedPaths: string[] = [];
          for (const media of mediaList) {
            normalisedPaths.push(media.path);
          }
          // Not an outdated value of only one task runs at a time.
          // eslint-disable-next-line require-atomic-updates
          Scanner.results = await Scanner.filterNewAndMissing(normalisedPaths, files);

          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
