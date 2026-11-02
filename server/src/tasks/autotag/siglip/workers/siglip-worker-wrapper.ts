import Path from 'path';
import { SHARE_ENV, Worker } from 'worker_threads';

import { asError } from '../../../../utils';
import type { Preprocessing } from '../../preprocess';

export interface SiglipWorkerRequestImages {
  /**
   * Per-wrapper request id, strictly increasing from 0 and never reused;
   * echoed back to match the pending entry (not lowest-unused).
   */
  id: number;
  type: 'images';
  /** Image and text graph paths, resolved by the task runner after download. */
  imagePath: string;
  preprocess: Preprocessing;
  absolutePaths: string[];
}

export interface SiglipWorkerRequestTexts {
  /**
   * Per-wrapper request id, strictly increasing from 0 and never reused;
   * echoed back to match the pending entry (not lowest-unused).
   */
  id: number;
  type: 'texts';
  textPath: string;
  /** Fixed token-row length (the pack's context length). */
  contextLength: number;
  /** Token ids pre-computed in the main thread; workers never parse the tokenizer. */
  rows: number[][];
}

// Discriminated so a stray response can never be read with the wrong shape.
export type SiglipWorkerRequest = SiglipWorkerRequestImages | SiglipWorkerRequestTexts;

export interface SiglipWorkerError {
  id: number;
  err: string;
  stack?: string;
}

export interface SiglipWorkerSuccess {
  id: number;
  /** One L2-normalised vector per input, in input order. */
  embeddings: Float32Array[];
}

export type SiglipWorkerResponse = SiglipWorkerError | SiglipWorkerSuccess;

/**
 * One worker instance behind the pool. Known limitation of the inherited pool:
 * a crashed instance is not evicted mid-pool, so its queued chunk fails via the
 * task's continueOnError and the task ends with partial work.
 */
export class SiglipWorkerWrapper {
  private worker: Worker;
  private nextRequestId = 0;
  private pending = new Map<number, { resolve: (embeddings: Float32Array[]) => void; reject: (err: Error) => void }>();

  // Set when the worker exits or crashes. A worker that can no longer answer
  // must reject eagerly, otherwise the item awaiting its reply stays running
  // forever and the whole task queue serialises behind it.
  private dead = false;

  public constructor() {
    this.worker = new Worker(Path.resolve(__dirname, 'siglip-worker.js'), {
      env: SHARE_ENV,
      // `true` stops the worker's stdout/stderr being piped to the parent
      // process (the default pipes them), keeping native warnings like
      // onnxruntime's out of the server logs.
      stdout: true,
      stderr: true,
    });
    this.worker.on('message', (response: SiglipWorkerResponse) => {
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
        entry.resolve(response.embeddings);
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
        fail(new Error(`SigLIP encoder worker exited with code ${code}`));
        return;
      }
      this.dead = true;
      // A clean exit is only expected after terminate(); anything still
      // pending can never be answered.
      for (const entry of this.pending.values()) {
        entry.reject(new Error('SigLIP encoder worker exited before replying'));
      }
      this.pending.clear();
    });
  }

  public async quit(): Promise<void> {
    await this.worker.terminate();
  }

  public encodeImages(request: Omit<SiglipWorkerRequestImages, 'type' | 'id'>): Promise<Float32Array[]> {
    return this.enqueueImages({ ...request, type: 'images' });
  }

  public encodeTexts(request: Omit<SiglipWorkerRequestTexts, 'type' | 'id'>): Promise<Float32Array[]> {
    return this.enqueueTexts({ ...request, type: 'texts' });
  }

  private enqueueImages(request: Omit<SiglipWorkerRequestImages, 'id'>): Promise<Float32Array[]> {
    const id = this.nextRequestId++;
    return this.enqueue(id, { ...request, id });
  }

  private enqueueTexts(request: Omit<SiglipWorkerRequestTexts, 'id'>): Promise<Float32Array[]> {
    const id = this.nextRequestId++;
    return this.enqueue(id, { ...request, id });
  }

  // The dead-worker guard lives here so both request kinds cannot drift; each
  // concrete sender builds a fully typed request, no cast needed.
  private enqueue(id: number, message: SiglipWorkerRequest): Promise<Float32Array[]> {
    if (this.dead) {
      return Promise.reject(new Error('SigLIP encoder worker is no longer usable (exited or terminated)'));
    }
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message);
    });
  }
}
