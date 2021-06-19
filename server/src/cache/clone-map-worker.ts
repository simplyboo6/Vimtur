import { parentPort, workerData } from 'worker_threads';

import PHash from '../phash';

import type { Job, JobResult, MediaClone, MediaPhash } from './clone-map';

if (!parentPort || !workerData) {
  throw new Error('Worker missing fields');
}

// Type the input data.
const job: Job = workerData;

// Wrapper to enforce typing of response.
function postResult(result: JobResult): void {
  parentPort!.postMessage(result);
}

parentPort.on('message', (imageA: MediaPhash) => {
  try {
    if (!PHash) {
      throw new Error('pHash not loaded');
    }

    const clones: MediaClone[] = [];
    // Compare it to every file in the set that isn't itself.
    for (const imageB of job.data) {
      if (imageA.hash === imageB.hash) {
        continue;
      }
      const difference = PHash.getHammingDistance2(imageA.phash, imageB.phash);
      if (difference <= job.threshold) {
        clones.push({
          hash: imageB.hash,
          difference,
        });
      }
    }
    postResult({ hash: imageA.hash, clones });
  } catch (err) {
    console.error('CloneMapWorker Error', err);
    postResult({ err: err.message, hash: imageA.hash });
  }
});
