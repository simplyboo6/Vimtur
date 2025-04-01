import OS from 'os';
import Path from 'path';
import { Worker } from 'worker_threads';
import type { SqliteWorkerData, SqliteWorkerRequest, SqliteWorkerResult } from './worker';

interface QueueItem {
  resolve: (result: SqliteWorkerResult[]) => void;
  request: SqliteWorkerRequest | SqliteWorkerRequest[];
  reject: (err: Error) => void;
}

interface WorkerWrapper {
  worker: Worker;
  busy?: boolean;
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
  private interval: NodeJS.Timeout;

  public constructor(filename: string) {
    this.filename = filename;
    for (let i = 0; i < OS.cpus().length; i++) {
      this.spawnWorker();
    }

    this.interval = setInterval(() => {
      const wrapper = this.workers[0];
      if (wrapper) {
        wrapper.worker.postMessage({ type: 'flush' });
      }
    }, 30000);
  }

  public close(): void {
    clearInterval(this.interval);
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
      workerData: { filename: this.filename } as SqliteWorkerData,
    });

    let job: QueueItem | undefined = undefined;
    let error: unknown = undefined;

    const takeWork = () => {
      if (!job) {
        error = undefined;
        job = this.queue.shift();
        if (job) {
          worker.postMessage(job.request);
        }
      }
    };

    worker
      .on('online', () => {
        this.workers.push({ worker, takeWork });
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
