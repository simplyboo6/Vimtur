import Path from 'path';
import { SHARE_ENV, Worker } from 'worker_threads';

import { asError } from '../../../utils';
import type { CaptionPreprocess } from '../preprocess';

export interface CaptionWorkerRequest {
  /**
   * Per-wrapper request id, strictly increasing from 0 and never reused;
   * echoed back to match the pending entry (not lowest-unused).
   */
  id: number;
  type: 'caption';
  /** Encoder and decoder graph paths, resolved by the caller after download. */
  encoderPath: string;
  decoderPath: string;
  preprocess: CaptionPreprocess;
  startTokenId: number;
  endTokenIds: readonly number[];
  maxNewTokens: number;
  absolutePath: string;
}

export interface CaptionWorkerError {
  id: number;
  err: string;
  stack?: string;
}

export interface CaptionWorkerSuccess {
  id: number;
  /** Decoded token ids; the main thread detokenises them. */
  ids: number[];
}

export type CaptionWorkerResponse = CaptionWorkerError | CaptionWorkerSuccess;

/**
 * One worker instance behind the pool. Known limitation of the inherited pool:
 * a crashed instance is not evicted mid-pool, so its queued item fails via the
 * task's continueOnError and the task ends with partial work.
 */
export class CaptionWorkerWrapper {
  private worker: Worker;
  private nextRequestId = 0;
  private pending = new Map<number, { resolve: (ids: number[]) => void; reject: (err: Error) => void }>();

  // Set when the worker exits or crashes. A worker that can no longer answer
  // must reject eagerly, otherwise the item awaiting its reply stays running
  // forever and the whole task queue serialises behind it.
  private dead = false;

  public constructor() {
    this.worker = new Worker(Path.resolve(__dirname, 'caption-worker.js'), {
      env: SHARE_ENV,
      // `true` stops the worker's stdout/stderr being piped to the parent
      // process (the default pipes them), keeping native warnings like
      // onnxruntime's out of the server logs.
      stdout: true,
      stderr: true,
    });
    this.worker.on('message', (response: CaptionWorkerResponse) => {
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
        entry.resolve(response.ids);
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
        fail(new Error(`Caption worker exited with code ${code}`));
        return;
      }
      this.dead = true;
      // A clean exit is only expected after terminate(); anything still
      // pending can never be answered.
      for (const entry of this.pending.values()) {
        entry.reject(new Error('Caption worker exited before replying'));
      }
      this.pending.clear();
    });
  }

  public async quit(): Promise<void> {
    await this.worker.terminate();
  }

  public caption(request: Omit<CaptionWorkerRequest, 'type' | 'id'>): Promise<number[]> {
    const id = this.nextRequestId++;
    return this.enqueue({ ...request, type: 'caption', id });
  }

  // The dead-worker guard lives here so a future request kind cannot drift;
  // the concrete sender builds a fully typed request, no cast needed.
  private enqueue(message: CaptionWorkerRequest): Promise<number[]> {
    if (this.dead) {
      return Promise.reject(new Error('Caption worker is no longer usable (exited or terminated)'));
    }
    return new Promise<number[]>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      this.worker.postMessage(message);
    });
  }
}
