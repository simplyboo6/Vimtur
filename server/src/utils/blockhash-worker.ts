import { PNG } from 'pngjs';
import { blockhash } from './blockhash';
import { parentPort } from 'worker_threads';
import FS from 'fs/promises';

export interface BlockhashJob {
  id: string;
  path: string;
  bits: number;
}

export interface BlockhashJobResult {
  id: string;
  hash: string;
}

export interface BlockhashJobError {
  id: string;
  err: string;
}

if (!parentPort) {
  throw new Error('Worker missing fields');
}

// Wrapper to enforce typing of response.
function postResult(result: BlockhashJobResult | BlockhashJobError): void {
  parentPort!.postMessage(result);
}

function onError(job: BlockhashJob, err: Error): void {
  console.error(err);
  postResult({ err: err.message, id: job.id });
}

parentPort.on('message', (job: BlockhashJob) => {
  try {
    FS.readFile(job.path)
      .then((data) => {
        const hash = blockhash(PNG.sync.read(data), job.bits, 'precise');
        postResult({
          id: job.id,
          hash,
        });
      })
      .catch((err) => {
        onError(job, err);
      });
  } catch (err) {
    onError(job, err);
  }
});
