import FS from 'fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { parentPort, workerData } from 'worker_threads';

export interface SqliteWorkerData {
  filename: string;
}

export type SqliteWorkerResult =
  | { type: 'exec' }
  | { type: 'run'; changes: number }
  | { type: 'get'; data?: unknown }
  | { type: 'all'; data: unknown[] }
  | { type: 'err'; message: string };

export interface SqliteWorkerRequest {
  type: 'exec' | 'run' | 'get' | 'all';
  query: string;
  values?: unknown[];
}

if (!parentPort || !workerData) {
  throw new Error('Worker missing fields');
}

// Requests come over the wire as unknown[], and bind behaviour is enforced
// here rather than inherited from node:sqlite, where it shifts between Node
// versions: undefined is a bind error on 24.x but binds as NULL from 26.10,
// and bare objects bind as named-parameter bags (silently writing NULL)
// rather than failing like better-sqlite3 did. Booleans are rejected for
// better-sqlite3 parity; the connector maps them to 0/1 before binding.
function assertBindable(value: unknown): void {
  if (
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value))
  ) {
    throw new Error(`Unbindable bind value: ${Object.prototype.toString.call(value)}`);
  }
}

const { filename } = workerData as SqliteWorkerData;

// 5s busy timeout to match the better-sqlite3 default: multiple worker
// threads share one database file, so lock contention must wait out the
// busy handler rather than fail immediately.
const db = new DatabaseSync(filename, { timeout: 5000 });
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

function postResult(result: SqliteWorkerResult[]): void {
  if (!parentPort) {
    throw new Error('parentPort disappeared');
  }
  parentPort.postMessage(result);
}

function runRequest(request: SqliteWorkerRequest): SqliteWorkerResult {
  const values = (request.values || []) as SQLInputValue[];
  for (const value of values) {
    assertBindable(value);
  }
  switch (request.type) {
    case 'exec':
      db.exec(request.query);
      return { type: 'exec' };
    case 'run':
      return {
        type: 'run',
        // changes is number | bigint depending on statement configuration;
        // the protocol and callers expect a plain number.
        changes: Number(db.prepare(request.query).run(...values).changes),
      };
    case 'get':
      return {
        type: 'get',
        data: db.prepare(request.query).get(...values),
      };
    case 'all':
      return {
        type: 'all',
        data: db.prepare(request.query).all(...values),
      };
  }
}

parentPort.on('message', (request: SqliteWorkerRequest[] | SqliteWorkerRequest | { type: 'exit' | 'flush' }) => {
  try {
    if (Array.isArray(request)) {
      const results: SqliteWorkerResult[] = [];
      // node:sqlite has no transaction helper; batched requests run in an
      // explicit transaction so they commit atomically or not at all.
      // IMMEDIATE takes the write lock up front (waiting out the busy
      // timeout) instead of failing with an immediate BUSY when a deferred
      // transaction upgrades to writer while an external reader holds the
      // file — the failure mode documented in SqliteController.
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const req of request) {
          results.push(runRequest(req));
        }
        db.exec('COMMIT');
      } catch (err) {
        // A failed statement must undo the whole batch. A rollback here can
        // itself fail (e.g. the BEGIN failed, or the connection is wedged);
        // report the original error, the transaction is dead either way.
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure to surface the original error below.
        }
        throw err;
      }
      postResult(results);
    } else {
      switch (request.type) {
        case 'exit':
          process.exit(0);
          break;
        case 'flush':
          // Attempt to flush the WAL cache forcefully if the size is too big.
          FS.stat(filename, (err, stat) => {
            if (err) {
              console.error(err);
            } else if (stat.size > 10 * 1024 * 1024) {
              try {
                db.exec('PRAGMA wal_checkpoint(RESTART)');
              } catch (err) {
                // A failed checkpoint (e.g. blocked by an open transaction)
                // must not become an uncaught exception: that would exit the
                // worker non-zero and make the controller respawn it.
                console.error(err);
              }
            }
          });
          break;
        default:
          postResult([runRequest(request)]);
          break;
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      postResult([{ type: 'err', message: err.message }]);
    } else {
      postResult([{ type: 'err', message: 'Unknown sqlite worker error' }]);
    }
  }
});
