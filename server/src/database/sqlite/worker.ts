import { parentPort, workerData } from 'worker_threads';
import Sqlite from 'better-sqlite3';

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

const { filename } = workerData as SqliteWorkerData;

const db = new Sqlite(filename);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function postResult(result: SqliteWorkerResult[]): void {
  if (!parentPort) {
    throw new Error('parentPort disappeared');
  }
  parentPort.postMessage(result);
}

function runRequest(request: SqliteWorkerRequest): SqliteWorkerResult {
  switch (request.type) {
    case 'exec':
      db.exec(request.query);
      return { type: 'exec' };
    case 'run':
      return {
        type: 'run',
        changes: db.prepare(request.query).run(...(request.values || [])).changes,
      };
    case 'get':
      return {
        type: 'get',
        data: db.prepare(request.query).get(...(request.values || [])),
      };
    case 'all':
      return {
        type: 'all',
        data: db.prepare(request.query).all(...(request.values || [])),
      };
  }
}

parentPort.on('message', (request: SqliteWorkerRequest[] | SqliteWorkerRequest | { type: 'exit' }) => {
  try {
    if (Array.isArray(request)) {
      const results: SqliteWorkerResult[] = [];
      db.transaction(() => {
        for (const req of request) {
          results.push(runRequest(req));
        }
      })();
      postResult(results);
    } else {
      if (request.type === 'exit') {
        process.exit(0);
      }
      postResult([runRequest(request)]);
    }
  } catch (err) {
    if (err instanceof Error) {
      postResult([{ type: 'err', message: err.message }]);
    } else {
      postResult([{ type: 'err', message: 'Unknown sqlite worker error' }]);
    }
  }
});
