import { parentPort } from 'worker_threads';

import * as ort from 'onnxruntime-node';

import { asError } from '../../../../utils';
import { preprocessImage } from '../../preprocess';
import { IMAGE_BATCH } from '../pack';
import { l2NormaliseRow } from '../vector';
import type {
  SiglipWorkerError,
  SiglipWorkerRequest,
  SiglipWorkerResponse,
  SiglipWorkerSuccess,
} from './siglip-worker-wrapper';

if (!parentPort) {
  throw new Error('Worker missing fields');
}

interface TowerSession {
  input: string;
  output: string;
  instance: ort.InferenceSession;
}

let imageSession: TowerSession | undefined;
let textSession: TowerSession | undefined;

/**
 * Sessions are pinned single-threaded: ONNX execution reorders floating-point
 * reductions across op threads, which flaps knife-edge calibrated thresholds
 * between runs. Parallelism therefore comes from the pool running this worker
 * in multiple instances, never from inside a session (POC determinism
 * findings). The CPU provider is pinned so an optional-GPU host does not
 * silently move parallel sessions onto one device.
 */
function createSession(modelPath: string): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
}

async function ensureImageSession(imagePath: string): Promise<TowerSession> {
  if (!imageSession) {
    const instance = await createSession(imagePath);
    imageSession = { input: instance.inputNames[0], output: instance.outputNames[0], instance };
  }
  return imageSession;
}

async function ensureTextSession(textPath: string): Promise<TowerSession> {
  if (!textSession) {
    const instance = await createSession(textPath);
    textSession = { input: instance.inputNames[0], output: instance.outputNames[0], instance };
  }
  return textSession;
}

// The pack outputs arrive L2-normalised under 'embedding'; re-normalising is
// defensive (a future pack may not) and free: cosine is then the dot product.
function sliceRows(tensor: ort.Tensor, count: number): Float32Array[] {
  if (tensor.dims.length !== 2) {
    throw new Error(`Unexpected embedding tensor shape [${tensor.dims.join(', ')}]`);
  }
  const dim = tensor.dims[1];
  if (tensor.data.length !== count * dim) {
    throw new Error(`Embedding tensor has ${tensor.data.length} values, expected ${count * dim}`);
  }
  const source = tensor.data as Float32Array;
  // Copy before normalising: the shared vector helper mutates in place, and
  // these rows must not share storage with the tensor's output buffer.
  return Array.from({ length: count }, (_, index) =>
    l2NormaliseRow(Float32Array.from(source.subarray(index * dim, (index + 1) * dim))),
  );
}

async function onMessage(request: SiglipWorkerRequest): Promise<Float32Array[]> {
  if (request.type === 'images') {
    const session = await ensureImageSession(request.imagePath);
    const { cropSize } = request.preprocess;
    const planesPerImage = 3 * cropSize * cropSize;
    const rows: Float32Array[] = [];
    // Batches of IMAGE_BATCH in strict input order: batch composition is
    // part of the pack's quantisation behaviour and must not depend on
    // anything other than the canonical input order (pack.ts constants).
    for (let offset = 0; offset < request.absolutePaths.length; offset += IMAGE_BATCH) {
      const batch = request.absolutePaths.slice(offset, offset + IMAGE_BATCH);
      const planes = await Promise.all(batch.map((path) => preprocessImage(path, request.preprocess)));
      const stacked = new Float32Array(batch.length * planesPerImage);
      planes.forEach((plane, index) => {
        if (plane.length !== planesPerImage) {
          throw new Error(`Preprocessed image has ${plane.length} values, expected ${planesPerImage}`);
        }
        stacked.set(plane, index * planesPerImage);
      });
      const feed = {
        [session.input]: new ort.Tensor('float32', stacked, [batch.length, 3, cropSize, cropSize]),
      };
      const outputs = await session.instance.run(feed);
      rows.push(...sliceRows(outputs[session.output], batch.length));
    }
    return rows;
  }

  const session = await ensureTextSession(request.textPath);
  const contextLength = request.contextLength;
  const inputIds = new BigInt64Array(request.rows.length * contextLength);
  for (let row = 0; row < request.rows.length; row++) {
    const ids = request.rows[row];
    if (ids.length !== contextLength) {
      throw new Error(`Token row ${row} has ${ids.length} ids, expected ${contextLength}`);
    }
    for (let column = 0; column < contextLength; column++) {
      inputIds[row * contextLength + column] = BigInt(ids[column]);
    }
  }
  const feed = {
    [session.input]: new ort.Tensor('int64', inputIds, [request.rows.length, contextLength]),
  };
  const outputs = await session.instance.run(feed);
  return sliceRows(outputs[session.output], request.rows.length);
}

const port = parentPort;

// Wrapper to enforce typing of response.
function postResult(result: SiglipWorkerResponse): void {
  port.postMessage(result);
}

port.on('message', (message: SiglipWorkerRequest) => {
  onMessage(message)
    .then((embeddings) => {
      postResult({ id: message.id, embeddings } satisfies SiglipWorkerSuccess);
    })
    .catch((errUnknown: unknown) => {
      const err = asError(errUnknown);
      postResult({ id: message.id, err: err.message, stack: err.stack } satisfies SiglipWorkerError);
    });
});
