import OS from 'os';
import Path from 'path';
import { Worker } from 'worker_threads';
import { isInMemoryDatabase } from './utils';
import type { SqliteWorkerRequest, SqliteWorkerResult } from './worker';

interface QueueItem {
  resolve: (result: SqliteWorkerResult[]) => void;
  request: SqliteWorkerRequest | SqliteWorkerRequest[];
  reject: (err: Error) => void;
}

// Read requests may fan out across every worker connection — WAL supports
// concurrent readers, and secondary connections are preferred for them so the
// first (writer) connection stays free for writes; see spawnWorker. Everything
// else (run, exec, and transaction batches) writes, and SQLite allows a single
// writer at a time: concurrent writers on separate connections fail with
// "database is locked" (a deferred transaction's upgrade to writer returns
// BUSY immediately instead of waiting out the busy timeout), which has been
// observed losing parallel indexer writes on a file-backed database.
function isWriteRequest(request: SqliteWorkerRequest | SqliteWorkerRequest[]): boolean {
  return Array.isArray(request) || request.type === 'run' || request.type === 'exec';
}

interface WorkerWrapper {
  worker: Worker;
  busy: boolean;
  takeWork: () => void;
}

interface TransactCallbackArg {
  run: (query: string, values?: unknown[]) => void;
}

export class SqliteController {
  // TODO Regular WAL flush
  private queue: QueueItem[] = [];
  private workers: WorkerWrapper[] = [];
  private filename: string;
  private interval?: NodeJS.Timeout;

  public constructor(filename: string) {
    this.filename = filename;
    // Each worker opens its own connection. Reads fan out across them (WAL
    // supports concurrent readers), preferring secondary connections so the
    // first connection stays free for writes; writes are serialised onto the
    // first connection (see isWriteRequest). `:memory:` databases are
    // per-connection,
    // so in-memory mode must use a single worker or every worker would see a
    // separate empty database — the single connection also serialises writes
    // for free.
    const workerCount = isInMemoryDatabase(filename) ? 1 : OS.cpus().length;
    for (let i = 0; i < workerCount; i++) {
      this.spawnWorker();
    }

    // The WAL-size flush is meaningless for an in-memory database (no file to
    // stat, nothing to checkpoint), so don't even start the timer for one.
    if (!isInMemoryDatabase(filename)) {
      this.interval = setInterval(() => {
        const wrapper = this.workers[0];
        if (wrapper) {
          wrapper.worker.postMessage({ type: 'flush' });
        }
      }, 30000);
    }
  }

  public close(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
    for (const wrapper of this.workers) {
      wrapper.worker.postMessage({ type: 'exit' });
    }
  }

  public async run(query: string, values?: unknown[]): Promise<{ changes: number }> {
    const result = await this.queryAsync({
      type: 'run',
      query,
      values,
    });
    if (result[0]?.type !== 'run') {
      throw new Error('run did not return run result');
    }
    return { changes: result[0].changes };
  }

  public async exec(query: string): Promise<void> {
    await this.queryAsync({
      type: 'exec',
      query,
    });
  }

  public async get<T>(query: string, values?: unknown[]): Promise<T | undefined> {
    const result = await this.queryAsync({
      type: 'get',
      query,
      values,
    });
    if (result[0]?.type !== 'get') {
      throw new Error('get did not return get result');
    }
    return result[0].data as T | undefined;
  }

  public async all<T>(query: string, values?: unknown[]): Promise<T[]> {
    const result = await this.queryAsync({
      type: 'all',
      query,
      values,
    });
    if (result[0]?.type !== 'all') {
      throw new Error('all did not return all result');
    }
    return result[0].data as T[];
  }

  public async transaction(callback: (arg: TransactCallbackArg) => void): Promise<void> {
    const jobs: SqliteWorkerRequest[] = [];
    callback({
      run: (query: string, values?: unknown[]): void => {
        jobs.push({ type: 'run', query, values });
      },
    });
    if (jobs.length === 0) {
      return;
    }
    await this.queryAsync(jobs);
  }

  private spawnWorker(): void {
    const worker = new Worker(Path.resolve(__dirname, 'worker.js'), {
      workerData: { filename: this.filename },
    });

    // Created up-front so takeWork can report this worker's idleness while
    // other workers decide what to pick up.
    const wrapper: WorkerWrapper = { worker, busy: false, takeWork: () => undefined };
    let job: QueueItem | undefined = undefined;
    let error: unknown = undefined;

    const takeWork = () => {
      if (job) {
        return;
      }
      error = undefined;
      wrapper.busy = false;
      // Writes go to the first worker only so they are serialised on a
      // single connection; reads may run on any connection. Reads are
      // preferred on secondary connections so the primary connection stays
      // free for queued writes — a read occupying the primary delays every
      // write behind it. The primary picks reads up itself only when every
      // secondary is busy, or when it is the only worker (in-memory mode,
      // single-cpu machines).
      const isWriter = this.workers[0]?.worker === worker;
      const hasIdleSecondary = this.workers.some((w, i) => i > 0 && !w.busy);
      const index = this.queue.findIndex((item) => {
        if (isWriteRequest(item.request)) {
          return isWriter;
        }
        return !isWriter || !hasIdleSecondary;
      });
      if (index >= 0) {
        const [item] = this.queue.splice(index, 1);
        job = item;
        wrapper.busy = true;
        worker.postMessage(job.request);
      }
    };
    wrapper.takeWork = takeWork;

    worker
      .on('online', () => {
        this.workers.push(wrapper);
        takeWork();
      })
      .on('message', (result: SqliteWorkerResult[]) => {
        if (job) {
          if (result[0]?.type === 'err') {
            job.reject(new Error(result[0].message));
          } else {
            job.resolve(result);
          }
          job = undefined;
        } else {
          console.warn('Missing job to post result to');
        }
        takeWork();
      })
      .on('error', (err) => {
        console.error(err);
        error = err;
      })
      .on('exit', (code) => {
        this.workers = this.workers.filter((w) => w.worker !== worker);
        if (job) {
          job.reject(error && error instanceof Error ? error : new Error('worker exited'));
          job = undefined;
        }
        if (code !== 0) {
          console.error(`worker exited with code ${code}`);
          this.spawnWorker();
        }
      });
  }

  private queryAsync(request: SqliteWorkerRequest | SqliteWorkerRequest[]): Promise<SqliteWorkerResult[]> {
    return new Promise<SqliteWorkerResult[]>((resolve, reject) => {
      this.queue.push({
        resolve,
        request,
        reject: (err) => {
          let message = err instanceof Error ? err.message : 'Unknown';
          message += ` - ${JSON.stringify(request)}`;
          reject(new Error(message));
        },
      });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    for (const worker of this.workers) {
      worker.takeWork();
    }
  }
}
