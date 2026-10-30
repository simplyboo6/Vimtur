import Path from 'path';
import { SHARE_ENV, Worker } from 'worker_threads';

import { asError } from '../../../utils';
import type { ModelDefinition } from '../models';

export interface ClassifierWorkerRequest {
  id: number;
  definition: ModelDefinition;
  // Resolved by the task runner after ensureModelDownloaded, so workers don't
  // each re-download or re-probe the source.
  modelPath: string;
  absolutePath: string;
}

export interface ClassifierWorkerError {
  id: number;
  err: string;
  stack?: string;
}

export interface ClassifierWorkerSuccess {
  id: number;
  labels: string[];
}

export type ClassifierWorkerResponse = ClassifierWorkerError | ClassifierWorkerSuccess;

export class ClassifierWorkerWrapper {
  private worker: Worker;

  private nextRequestId = 0;

  private pending = new Map<number, { resolve: (labels: string[]) => void; reject: (err: Error) => void }>();

  // Set when the worker exits or crashes. A worker that can no longer answer
  // must reject eagerly, otherwise the item awaiting its reply stays running
  // forever and the whole task queue serialises behind it.
  private dead = false;

  constructor() {
    this.worker = new Worker(Path.resolve(__dirname, 'classifier-worker.js'), {
      env: SHARE_ENV,
      // `true` stops the worker's stdout/stderr being piped to the parent
      // process (the default pipes them), keeping native warnings like
      // onnxruntime's out of the server logs.
      stdout: true,
      stderr: true,
    });
    this.worker.on('message', (response: ClassifierWorkerResponse) => {
      const entry = this.pending.get(response.id);
      if (!entry) {
        return;
      }
      this.pending.delete(response.id);
      if ('err' in response) {
        const err = new Error(response.err);
        // The worker's stack does not survive into this thread; restore it so
        // continueOnError logging shows frames instead of a single line.
        if (response.stack) {
          err.stack = `${err.message}\n${response.stack}`;
        }
        entry.reject(err);
      } else {
        entry.resolve(response.labels);
      }
    });
    const fail = (errUnknown: unknown): void => {
      this.dead = true;
      const err = asError(errUnknown);
      for (const entry of this.pending.values()) {
        entry.reject(err);
      }
      this.pending.clear();
    };
    this.worker.on('error', fail);
    // Deserialisation failures never produce a caught error in the worker.
    this.worker.on('messageerror', fail);
    this.worker.on('exit', (code: number) => {
      if (code !== 0) {
        fail(new Error(`Auto-tag worker exited with code ${code}`));
        return;
      }
      this.dead = true;
      // A clean exit is only expected after terminate(); anything still
      // pending can never be answered.
      for (const entry of this.pending.values()) {
        entry.reject(new Error('Auto-tag worker exited before replying'));
      }
      this.pending.clear();
    });
  }

  public async quit(): Promise<void> {
    await this.worker.terminate();
  }

  public classify(request: Omit<ClassifierWorkerRequest, 'id'>): Promise<string[]> {
    if (this.dead) {
      return Promise.reject(new Error('Auto-tag worker is no longer usable (exited or terminated)'));
    }
    const id = this.nextRequestId++;
    return new Promise<string[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } satisfies ClassifierWorkerRequest);
    });
  }
}
