import Path from 'path';
import { SHARE_ENV, Worker } from 'worker_threads';

import { asError } from '../../../utils';

import type { ModelDefinition } from '../models';

export interface ClassifierWorkerRequest {
  id: number;
  definition: ModelDefinition;
  absolutePath: string;
}

export interface ClassifierWorkerError {
  id: number;
  err: string;
}

export interface ClassifierWorkerSuccess {
  id: number;
  labels: string[];
}

export type ClassifierWorkerResponse = ClassifierWorkerError | ClassifierWorkerSuccess;

// Distinct from the old one-shot wrapper: sessions cost ~130ms to load, so the
// worker persists for the pool's lifetime and answers multiple classifications.
export class ClassifierWorkerWrapper {
  private worker: Worker;

  private nextRequestId = 0;

  private pending = new Map<number, { resolve: (labels: string[]) => void; reject: (err: Error) => void }>();

  constructor() {
    this.worker = new Worker(Path.resolve(__dirname, 'classifier-worker.js'), {
      env: SHARE_ENV,
      // Silence stdout and stderr.
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
        entry.reject(new Error(response.err));
      } else {
        entry.resolve(response.labels);
      }
    });
    this.worker.on('error', (err: unknown) => {
      const error = asError(err);
      for (const entry of this.pending.values()) {
        entry.reject(error);
      }
      this.pending.clear();
    });
  }

  public async quit(): Promise<void> {
    await this.worker.terminate();
  }

  public classify(definition: ModelDefinition, absolutePath: string): Promise<string[]> {
    const id = this.nextRequestId++;
    return new Promise<string[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, definition, absolutePath } satisfies ClassifierWorkerRequest);
    });
  }
}
