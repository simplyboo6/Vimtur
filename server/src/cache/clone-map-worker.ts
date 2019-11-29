import { Job, JobResult, MediaClone } from './clone-map';
import { parentPort, workerData } from 'worker_threads';
import PHash from 'phash2';

if (!parentPort || !workerData) {
  throw new Error('Worker missing fields');
}

// Type the input data.
const job: Job = workerData;

// Wrapper to enforce typing of response.
function postResult(result: JobResult): void {
  parentPort!.postMessage(result);
}

// For each image within the defined input range...
for (let i = job.offset; i < job.data.length && i < job.offset + job.count; i++) {
  const imageA = job.data[i];

  // If there's already clones, skip this one.
  if (imageA.clones !== undefined) {
    continue;
  }

  const clones: MediaClone[] = [];
  try {
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
    postResult({ err: err.message, hash: imageA.hash, clones });
  }
}
