import Path from 'path';
import { SHARE_ENV, Worker } from 'worker_threads';

import type { TensorFlowHubModel } from '../imagenet';

export interface ClassifierWorkerRequest {
  definition: TensorFlowHubModel;
  absolutePath: string;
}

export interface ClassifierWorkerError {
  err: string;
}

export interface ClassifierWorkerSuccess {
  probabilities: string[];
}

export type ClassifierWorkerResponse = ClassifierWorkerError | ClassifierWorkerSuccess;

export class ClassifierWorkerWrapper {
  // Silence stdout and stderr.
  private worker = new Worker(Path.resolve(__dirname, 'classifier-worker.js'), {
    env: SHARE_ENV,
    stdout: true,
    stderr: true,
  });

  public async quit(): Promise<void> {
    await this.worker.terminate();
  }

  public classify(request: ClassifierWorkerRequest): Promise<ClassifierWorkerSuccess> {
    return new Promise<ClassifierWorkerSuccess>((resolve, reject) => {
      this.worker.once('message', (response: ClassifierWorkerResponse) => {
        if ((response as ClassifierWorkerError).err) {
          reject(new Error((response as ClassifierWorkerError).err));
        } else {
          resolve(response as ClassifierWorkerSuccess);
        }
      });
      this.worker.postMessage(request);
    });
  }
}
