import { Database } from '../types';
import { Worker } from 'worker_threads';
import OS from 'os';
import Path from 'path';
import Types from '@vimtur/common';

const WORKER_COUNT = OS.cpus().length;
const MH_THRESHOLD = 0.1;

export interface MediaClone {
  hash: string;
  difference: number;
}

export interface MediaPhash {
  hash: string;
  phash: Buffer;
  clones?: string[];
}

export interface Job {
  data: MediaPhash[];
  offset: number;
  count: number;
  threshold: number;
}

export interface JobResult {
  hash: string;
  err?: string;
  clones: MediaClone[];
}

export async function generateImageCloneMap(
  db: Database,
  images: MediaPhash[],
  callback: (progress: Types.Scanner.Progress) => void,
): Promise<void> {
  return new Promise<void>(resolve => {
    // Calculate the number of items to give each worker.
    const MEDIA_PER_SET = Math.ceil(images.length / WORKER_COUNT);

    // Callback to say started.
    const progress: Types.Scanner.Progress = {
      current: 0,
      max: images.filter(i => i.clones === undefined).length,
    };
    console.log(`${progress.max} media of ${images.length} require clone maps`);
    callback(progress);

    // Number of workers exited
    let complete = 0;

    // Create all the workers.
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(Path.resolve(__dirname, 'clone-map-worker.js'), {
        workerData: {
          offset: i * MEDIA_PER_SET,
          count: MEDIA_PER_SET,
          data: images,
          threshold: MH_THRESHOLD,
        },
      });

      worker.on('message', (data: JobResult) => {
        // If there's an error just log it.
        if (data.err) {
          console.error(data.err);
        } else {
          db.saveMedia(data.hash, {
            clones: data.clones.map(c => c.hash),
            cloneDate: Math.floor(Date.now() / 1000),
          }).catch(err => console.error(err));

          if (data.clones.length > 0) {
            console.log(`${data.hash} has ${data.clones.length} possible clones`);
          }
        }
        // Callback with progress.
        progress.current++;
        callback(progress);
      });

      worker.on('error', err => {
        console.error('Worker failed', err);
      });

      worker.on('exit', code => {
        // If it's an error code, log it.
        if (code !== 0) {
          console.error('Worker failed with exit code', code);
        }
        // If this is the last one (all others exited) then complete the promise.
        complete++;
        if (complete >= WORKER_COUNT) {
          resolve();
        }
      });
    }
  });
}
