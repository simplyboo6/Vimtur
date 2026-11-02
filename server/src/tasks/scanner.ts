import FS from 'fs/promises';
import Path from 'path';

import type * as Types from '@vimtur/common';
import { Router } from 'express';
import { execute } from 'proper-job';
import type { WalkStats } from 'walk';
import Walk from 'walk';

// Local
import { ImportUtils } from '../cache/import-utils';
import Config from '../config';
import { NotFound } from '../errors';
import type { Database, RouterTask } from '../types';
import { asError } from '../utils';

type FilterResults = Types.Scanner.FilterResults;
type ScanResults = Types.Scanner.ScanResults;

// Pending work is keyed by the SCAN definition id (never the queue instance
// id like SCAN-0, which is ephemeral and reused) in the generic task_state
// store, so a restart between SCAN and INDEX / DELETE-MISSING keeps the work set.
const SCAN_TASK_ID = 'SCAN';
const SCAN_RESULTS_KEY = 'results';

/** Reads the persisted pending-work lists, or undefined when no scan has been stored yet (or the stored value is unreadable). */
export async function loadScanResults(database: Database): Promise<ScanResults | undefined> {
  let stored: unknown;
  try {
    stored = await database.getTaskState<unknown>(SCAN_TASK_ID, SCAN_RESULTS_KEY);
  } catch (errUnknown: unknown) {
    // Only unparseable stored JSON is treated as "no scan": sqlite parses the
    // row on read, so a hand-edited or partially written value throws a
    // SyntaxError, and an operator re-scan replaces it. Transport and engine
    // errors propagate, mirroring the state endpoint (routes/tasks.ts, which
    // deliberately does not catch) and the client's getTaskState comment
    // (tasks.service.ts): turning a connectivity problem into "no scan" would
    // silently hide a broken database.
    if (errUnknown instanceof SyntaxError) {
      console.warn('Failed to parse persisted scan results', errUnknown);
      return undefined;
    }
    throw errUnknown;
  }
  if (stored === undefined) {
    return undefined;
  }

  // JSON-serialisable but mis-shaped records exist too (hand-edited rows, or a
  // future writer's shape drift). They used to 500 /results (reading .length on
  // a non-array) and answer /results/new with an empty 200 body. Treating them
  // as "no scan" is safe for the same reason as unparseable JSON: the 404 sends
  // the operator down the re-scan path, which replaces the record.
  const results = stored as Partial<ScanResults>;
  if (
    typeof results.generatedAt !== 'number' ||
    !Array.isArray(results.newPaths) ||
    !Array.isArray(results.missingPaths)
  ) {
    console.warn('Ignoring mis-shaped persisted scan results');
    return undefined;
  }
  return results as ScanResults;
}

/** Persists pending-work lists, replacing any previous scan's value. */
export async function saveScanResults(database: Database, results: ScanResults): Promise<void> {
  await database.setTaskState(SCAN_TASK_ID, SCAN_RESULTS_KEY, results);
}

export class Scanner {
  public static async getFileList(): Promise<string[]> {
    const dir = Config.get().libraryPath;
    // The walk library reports failures as events instead of rejecting, and
    // an unmounted or misconfigured libraryPath would otherwise silently
    // resolve to an empty list and mark every database path as missing.
    // Stat the root here so those fail loudly before walking.
    let fileStat: Awaited<ReturnType<typeof FS.stat>>;
    try {
      fileStat = await FS.stat(dir);
    } catch (errUnknown: unknown) {
      throw new Error(`Unable to read library path ${dir}: ${asError(errUnknown).message}`, { cause: errUnknown });
    }
    if (!fileStat.isDirectory()) {
      throw new Error(`Library path ${dir} is not a directory`);
    }

    const options = {
      followLinks: false,
    };
    const walker = Walk.walk(dir, options);
    const files: string[] = [];
    // Read errors for individual files AND unreadable directories (e.g.
    // permissions) arrive as events. A directory the walk cannot read makes
    // every file under it unknown to the scan, which DELETE-MISSING would
    // treat as missing - the same wipe hazard as an unreadable root - so
    // directory-level errors fail the whole scan (see the promise below).
    // Isolated file-level errors only hide one path (whose row and file
    // survive anyway), so they are logged and tolerated.
    const fileErrors: Error[] = [];
    const directoryErrors: Error[] = [];
    const collectWalkErrors = (stats: WalkStats[] | WalkStats): WalkStats[] => {
      // The walk library emits a single stat for directory errors even
      // though @types/walk types every event callback with an array, so
      // handle both shapes defensively.
      return (Array.isArray(stats) ? stats : [stats]).filter((failed) => Boolean(failed.error));
    };
    walker.on('errors', (_base, stats) => {
      for (const failed of collectWalkErrors(stats)) {
        fileErrors.push(asError(failed.error));
      }
    });
    walker.on('directoryError', (_base, stats) => {
      for (const failed of collectWalkErrors(stats)) {
        directoryErrors.push(asError(failed.error));
      }
    });

    walker.on('file', (root, fileStats, next) => {
      try {
        ImportUtils.getType(fileStats.name);
        files.push(Path.relative(dir, Path.resolve(root, fileStats.name)));
      } catch {
        // Deliberately ignored: files with unsupported extensions aren't part of the library.
      } finally {
        next();
      }
    });

    return new Promise<string[]>((resolve, reject) => {
      walker.on('end', () => {
        if (directoryErrors.length > 0) {
          reject(
            new Error(
              `Library walk of ${dir} could not read ${directoryErrors.length} directories. First: ${directoryErrors[0].message}. ` +
                `Files under them are unknown to the scan and would be treated as missing, so fix the errors and re-run.`,
            ),
          );
          return;
        }
        if (fileErrors.length > 0) {
          console.warn(
            `Walk of library path ${dir} hit ${fileErrors.length} file-level read errors. First: ${fileErrors[0].message}`,
          );
        }
        resolve(files);
      });
    });
  }

  public static async filterNewAndMissing(
    databasePaths: string[],
    fileList: string[],
    db: Database,
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

    // Add new paths to the new paths list if they're not in the database.
    for (const file of fileList) {
      if (!databasePathsMap[file]) {
        const isDeleted = await db.isDeletedPath(file);
        if (isDeleted) {
          console.log(`Ignoring deleted path: ${file}`);
        } else {
          results.newPaths.push(file);
        }
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
  // A stored record always exists once any scan has succeeded, even after
  // INDEX / DELETE-MISSING consumed their lists (the generatedAt timestamp is
  // kept). Only "never scanned" is a 404.
  router.get('/results', async (_req, res) => {
    const results = await loadScanResults(db);
    if (!results) {
      throw new NotFound('Scan results not found');
    }
    res.status(200).json({
      generatedAt: results.generatedAt,
      newPaths: results.newPaths.length,
      missingPaths: results.missingPaths.length,
    });
  });

  router.get('/results/missing', async (_req, res) => {
    const results = await loadScanResults(db);
    if (!results) {
      throw new NotFound('Scan results not found');
    }
    res.status(200).json(results.missingPaths);
  });

  router.get('/results/new', async (_req, res) => {
    const results = await loadScanResults(db);
    if (!results) {
      throw new NotFound('Scan results not found');
    }
    res.status(200).json(results.newPaths);
  });

  return {
    // Registered under the same definition id the store helpers key state
    // under, so a rename cannot silently diverge the two.
    id: SCAN_TASK_ID,
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
          // A walk resolving to nothing while the database still has media
          // means the scan is lying (unmounted volume or a moved library).
          // Storing those results would let DELETE-MISSING wipe the whole
          // library, so fail the task instead. An empty walk with no media
          // is a fresh install, not an error.
          if (files.length === 0 && normalisedPaths.length > 0) {
            throw new Error(
              `Library walk found no files but the database has ${normalisedPaths.length} media entries. ` +
                `Check that ${Config.get().libraryPath} is mounted and correct.`,
            );
          }

          const filtered = await Scanner.filterNewAndMissing(normalisedPaths, files, db);
          await saveScanResults(db, { ...filtered, generatedAt: Date.now() });

          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
