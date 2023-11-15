import { Worker } from 'worker_threads';
import Path from 'path';
import type { BlockhashJob, BlockhashJobError, BlockhashJobResult } from './blockhash-worker';

interface PendingJob {
  resolve: (hash: string) => void;
  reject: (err: Error) => void;
}

function isError(result: BlockhashJobResult | BlockhashJobError): result is BlockhashJobError {
  return (result as unknown as { err?: unknown }).err !== undefined;
}

export class BlockhashAsync {
  private worker = new Worker(Path.resolve(__dirname, 'blockhash-worker.js'));
  private pendingJobs: Record<string, PendingJob> = {};
  private sequence = 0;

  public constructor() {
    this.worker.on('exit', (code) => {
      // If it's an error code, log it.
      if (code !== 0) {
        console.error('Worker exited with code', code);
        process.exit(1);
      }
    });

    this.worker.on('error', (err) => {
      console.error('Worker failed', err);
    });

    this.worker.on('message', (result: BlockhashJobResult | BlockhashJobError) => {
      const functions = this.pendingJobs[result.id];
      if (!functions) {
        console.warn('No functions for id', result);
      }
      delete this.pendingJobs[result.id];
      if (isError(result)) {
        functions.reject(new Error(result.err));
      } else {
        functions.resolve(result.hash);
      }
    });
  }

  public async hash(path: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const id = this.nextId();
      this.worker.postMessage({ id, path, bits: 16 } as BlockhashJob);
      this.pendingJobs[id] = { resolve, reject };
    });
  }

  private nextId(): string {
    this.sequence = (this.sequence + 1) % 65535;
    return `${Date.now()}-${this.sequence}`;
  }
}
