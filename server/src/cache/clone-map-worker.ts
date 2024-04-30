import { parentPort, workerData } from 'worker_threads';

import { asError } from '../utils';
import { hammingDistance } from '../utils/blockhash';

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

const blockCount = 4;

// Split a phash into a number of separate blocks.
function createChunks(hash: string): string[] {
  const blockSize = hash.length / blockCount;
  const chunks: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    chunks.push(hash.substring(i * blockSize, (i + 1) * blockSize));
  }
  return chunks;
}

// Create an index for each phash block that maps down to the image id/hash.
const blockIndexes: Array<Map<string, Set<string>>> = [];
for (let i = 0; i < blockCount; i++) {
  blockIndexes.push(new Map());
}
const hashPhashMap = new Map<string, string>();

const hashUnrelatedMap = new Map<string, string[]>();

for (const image of job.data) {
  if (image.unrelated) {
    hashUnrelatedMap.set(image.hash, image.unrelated);
  }
  hashPhashMap.set(image.hash, image.phash);
  const chunks = createChunks(image.phash);
  for (let i = 0; i < blockCount; i++) {
    if (!blockIndexes[i].has(chunks[i])) {
      blockIndexes[i].set(chunks[i], new Set());
    }
    blockIndexes[i].get(chunks[i])!.add(image.hash);
  }
}

// Put in a phash return a set of image IDs.
// For each of the blocks check the indexes above and add any matches to a set.
// For it not to match with at least one of the blocks it must be at least blockCount
// bits different.
function filterPotentialMatches(phash: string): Set<string> {
  const results = new Set<string>();
  const chunks = createChunks(phash);
  for (let i = 0; i < blockCount; i++) {
    const blockSet = blockIndexes[i].get(chunks[i]);
    if (blockSet) {
      for (const hash of blockSet) {
        results.add(hash);
      }
    }
  }
  return results;
}

parentPort.on('message', (imageA: MediaPhash) => {
  try {
    const clones: MediaClone[] = [];
    const potentialMatches = filterPotentialMatches(imageA.phash);
    for (const potentialMatch of potentialMatches) {
      if (potentialMatch === imageA.hash) {
        continue;
      }
      const potentialPhash = hashPhashMap.get(potentialMatch);
      if (!potentialPhash) {
        console.warn('Unable to lookup phash for hash', potentialPhash);
        continue;
      }
      const difference = hammingDistance(imageA.phash, potentialPhash);
      let related = false;
      const matchRelated = hashUnrelatedMap.get(potentialMatch);
      if (imageA.unrelated && imageA.unrelated.includes(potentialMatch)) {
        related = true;
      }
      if (matchRelated && matchRelated.includes(imageA.hash)) {
        related = true;
      }
      if (difference <= job.threshold && !related) {
        clones.push({
          hash: potentialMatch,
          difference,
        });
      }
    }

    postResult({ hash: imageA.hash, clones });
  } catch (errUnknown: unknown) {
    const err = asError(errUnknown);
    console.error('CloneMapWorker Error', err);
    postResult({ err: err.message, hash: imageA.hash });
  }
});
