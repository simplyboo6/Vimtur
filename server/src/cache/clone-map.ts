import { Worker } from 'worker_threads';
import OS from 'os';
import Path from 'path';

import { ExecutorPromise, execute } from 'proper-job';

import type { Database } from '../types';

const WORKER_COUNT = Math.ceil(OS.cpus().length / 2);
const HAMMING_DISTANCE_THRESHOLD = 2;

export interface MediaClone {
  hash: string;
  difference: number;
}

export interface MediaPhash {
  hash: string;
  phash: string;
  clones?: string[];
}

export interface Job {
  data: MediaPhash[];
  threshold: number;
}

export interface JobResult {
  hash: string;
  err?: string;
  clones?: MediaClone[];
}

interface WorkerWrapper {
  worker: Worker;
  idle: boolean;
}

export function generateImageCloneMap(
  database: Database,
  updateStatus: (current: number, max: number) => void,
): ExecutorPromise<any> {
  return execute(
    async () => {
      // First reset the clone map.
      await database.resetClones();

      // Now find all phashed
      const imagesRaw = await database.subsetFields(
        { type: { equalsAll: ['still'] }, phashed: true, duplicateOf: { exists: false } },
        { phash: 1, hash: 1, clones: 1 },
      );

      const images: MediaPhash[] = imagesRaw.map((image) => {
        return {
          hash: image.hash,
          phash: image.phash!,
          clones: image.clones,
        };
      });

      console.log(`Generating clone map for ${images.length} images`);

      const workers: WorkerWrapper[] = [];
      for (let i = 0; i < WORKER_COUNT; i++) {
        const worker = new Worker(Path.resolve(__dirname, 'clone-map-worker.js'), {
          workerData: {
            data: images,
            threshold: HAMMING_DISTANCE_THRESHOLD,
          },
        });

        worker.on('exit', (code) => {
          // If it's an error code, log it.
          if (code !== 0) {
            console.error('Worker exited with code', code);
          }
        });

        worker.on('error', (err) => {
          console.error('Worker failed', err);
        });

        worker.stdout.pipe(process.stdout);
        worker.stderr.pipe(process.stderr);

        workers.push({
          worker,
          idle: true,
        });
      }

      const workerRun = (image: MediaPhash): Promise<void> => {
        if (image.clones !== undefined) {
          return Promise.resolve();
        }

        const workerWrapper = workers.find((it) => it.idle);
        if (!workerWrapper) {
          throw new Error('No available worker');
        }
        workerWrapper.idle = false;

        return new Promise((resolve, reject) => {
          workerWrapper.worker.once('message', (data: JobResult) => {
            workerWrapper.idle = true;

            // If there's an error just log it.
            if (data.err) {
              reject(data.err);
            } else if (data.clones) {
              database
                .saveMedia(data.hash, {
                  clones: data.clones.map((c) => c.hash),
                  cloneDate: Math.floor(Date.now() / 1000),
                })
                .then(() => {
                  if (data.clones && data.clones.length > 0) {
                    console.log(`${data.hash} has ${data.clones.length} possible clones`);
                  }
                  resolve();
                })
                .catch((err) => reject(err));
            }
          });

          workerWrapper.worker.postMessage(image);
        });
      };

      const filteredImages = images.filter((i) => i.clones === undefined);

      return {
        init: {
          workerRun,
          workers,
          complete: 0,
          max: filteredImages.length,
        },
        iterable: filteredImages,
      };
    },
    async (image, init) => {
      if (!init) {
        throw new Error('init not set');
      }
      await init.workerRun(image);
      updateStatus(init.complete++, init.max);
    },
    { parallel: WORKER_COUNT },
    async (init) => {
      if (!init) {
        throw new Error('init not set in teardown');
      }
      console.log(`Terminating ${init.workers.length} worker threads`);
      const terminations = init.workers.map((workerWrapper) => workerWrapper.worker.terminate());
      for (const termination of terminations) {
        await termination;
      }
    },
  );
}
