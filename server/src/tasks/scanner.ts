import FS from 'fs/promises';
import Path from 'path';

import type * as Types from '@vimtur/common';
import { execute } from 'proper-job';
import type { WalkStats } from 'walk';
import Walk from 'walk';

// Local
import { ImportUtils } from '../cache/import-utils';
import Config from '../config';
import type { Database, Task } from '../types';
import { asError } from '../utils';

type FilterResults = Types.Scanner.FilterResults;
type ScanResults = Types.Scanner.ScanResults;

// Pending work is keyed by the SCAN definition id (never the queue instance
// id like SCAN-0, which is ephemeral and reused) in the generic task_state
// store, so a restart between SCAN and INDEX / DELETE-MISSING keeps the work set.
const SCAN_TASK_ID = 'SCAN';
// One key per list so a consumer rewrites only its own list: the task_state
// store has no delete, so consuming writes [].
const SCAN_NEW_PATHS_KEY = 'new-paths';
const SCAN_MISSING_PATHS_KEY = 'missing-paths';
const SCAN_GENERATED_AT_KEY = 'generated-at';

/** Reads the persisted pending-work state, or undefined when no scan has been stored yet (or the stored state is unreadable). */
export async function loadScanResults(database: Database): Promise<ScanResults | undefined> {
  let generatedAt: unknown;
  let newPaths: unknown;
  let missingPaths: unknown;
  try {
    newPaths = await database.getTaskState<unknown>(SCAN_TASK_ID, SCAN_NEW_PATHS_KEY);
    missingPaths = await database.getTaskState<unknown>(SCAN_TASK_ID, SCAN_MISSING_PATHS_KEY);
    generatedAt = await database.getTaskState<unknown>(SCAN_TASK_ID, SCAN_GENERATED_AT_KEY);
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
  // Any absent key means the scan's write did not complete (see saveScanResults).
  if (generatedAt === undefined || newPaths === undefined || missingPaths === undefined) {
    return undefined;
  }

  // JSON-serialisable but mis-shaped values exist too (hand-edited rows, or a
  // future writer's shape drift). Reading .length on a non-array previously
  // turned into a 500. Treating them as "no scan" is safe for the same reason
  // as unparseable JSON: the missing-state path sends the operator down the
  // re-scan path, which rewrites all three keys.
  if (typeof generatedAt !== 'number' || !Array.isArray(newPaths) || !Array.isArray(missingPaths)) {
    console.warn('Ignoring mis-shaped persisted scan results');
    return undefined;
  }
  return {
    generatedAt,
    newPaths: newPaths as string[],
    missingPaths: missingPaths as string[],
  };
}

/**
 * Persists a successful scan's pending-work state, replacing any previous scan's value.
 *
 * The three upserts are not atomic, so `generated-at` is written LAST and acts as the commit
 * marker: it only exists once both lists are fresh. A crash part-way through leaves a
 * self-consistent-enough state - the lists may be newer than the timestamp, but no consumer or
 * count depends on the timestamp - and the next successful scan rewrites all three.
 */
export async function saveScanResults(database: Database, filtered: FilterResults): Promise<void> {
  await database.setTaskState(SCAN_TASK_ID, SCAN_NEW_PATHS_KEY, filtered.newPaths);
  await database.setTaskState(SCAN_TASK_ID, SCAN_MISSING_PATHS_KEY, filtered.missingPaths);
  await database.setTaskState(SCAN_TASK_ID, SCAN_GENERATED_AT_KEY, Date.now());
}

/**
 * Clears the pending new-file list once INDEX has consumed it. Only this key is written:
 * `generated-at` survives consumption deliberately so the UI can still show when the last scan ran.
 */
export async function clearScanNewPaths(database: Database): Promise<void> {
  await database.setTaskState(SCAN_TASK_ID, SCAN_NEW_PATHS_KEY, []);
}

/** Clears the pending missing-file list once DELETE-MISSING has consumed it. Only this key is written: see clearScanNewPaths. */
export async function clearScanMissingPaths(database: Database): Promise<void> {
  await database.setTaskState(SCAN_TASK_ID, SCAN_MISSING_PATHS_KEY, []);
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

export function getTask(db: Database): Task {
  return {
    // Registered under the same definition id the store helpers key state
    // under, so a rename cannot silently diverge the two.
    id: SCAN_TASK_ID,
    description: 'Scan for new files',
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

          await saveScanResults(db, await Scanner.filterNewAndMissing(normalisedPaths, files, db));

          return [];
        },
        () => Promise.resolve(),
      );
    },
  };
}
