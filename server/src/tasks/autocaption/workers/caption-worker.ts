import { parentPort } from 'worker_threads';

import * as ort from 'onnxruntime-node';

import { asError } from '../../../utils';
import { decodeGreedy } from '../decode';
import { preprocessCaptionImage } from '../preprocess';
import type {
  CaptionWorkerError,
  CaptionWorkerRequest,
  CaptionWorkerResponse,
  CaptionWorkerSuccess,
} from './caption-worker-wrapper';

if (!parentPort) {
  throw new Error('Worker missing fields');
}

interface CaptionSessions {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  encoderInput: string;
  encoderOutput: string;
  decoderInputIds: string;
  decoderEncoderStates: string;
}

let sessions: CaptionSessions | undefined;

/**
 * Both graphs are pinned single-threaded: ONNX execution reorders
 * floating-point reductions across op threads, which can flip a top-1 logit
 * and therefore a generated token between runs (the same determinism reason as
 * the auto-tagging encoder). Parallelism comes from the pool running this
 * worker in multiple instances, never from inside a session. The CPU provider
 * is pinned so an optional-GPU host does not silently move parallel sessions
 * onto one device.
 */
function createSession(modelPath: string): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
}

async function ensureSessions(encoderPath: string, decoderPath: string): Promise<CaptionSessions> {
  // A pool has one pack for its lifetime, so the first request pins both
  // graphs and later paths cannot swap them mid-pool.
  if (!sessions) {
    const [encoder, decoder] = await Promise.all([createSession(encoderPath), createSession(decoderPath)]);
    sessions = {
      encoder,
      decoder,
      encoderInput: encoder.inputNames[0],
      encoderOutput: encoder.outputNames[0],
      decoderInputIds: decoder.inputNames[0],
      decoderEncoderStates: decoder.inputNames[1],
    };
  }
  return sessions;
}

async function caption(request: CaptionWorkerRequest): Promise<number[]> {
  const current = await ensureSessions(request.encoderPath, request.decoderPath);
  const { imageSize } = request.preprocess;
  const planes = await preprocessCaptionImage(request.absolutePath, request.preprocess);
  const encoderOutputs = await current.encoder.run({
    [current.encoderInput]: new ort.Tensor('float32', planes, [1, 3, imageSize, imageSize]),
  });
  // The encoder output is fed straight back in with no arithmetic between the
  // graphs: BLIP's vision hidden size is already 768, so encoder_hidden_states
  // is used unprojected (the ViT-BERT family's projection trick does not apply).
  const encoderHiddenStates = encoderOutputs[current.encoderOutput];

  return decodeGreedy(
    async (ids) => {
      const inputIds = BigInt64Array.from(ids.map((id) => BigInt(id)));
      const outputs = await current.decoder.run({
        [current.decoderInputIds]: new ort.Tensor('int64', inputIds, [1, ids.length]),
        [current.decoderEncoderStates]: encoderHiddenStates,
      });
      const logits = outputs[current.decoder.outputNames[0]];
      return { data: logits.data as Float32Array, dims: logits.dims };
    },
    {
      startTokenId: request.startTokenId,
      endTokenIds: request.endTokenIds,
      maxNewTokens: request.maxNewTokens,
    },
  );
}

const port = parentPort;

// Wrapper to enforce typing of response.
function postResult(result: CaptionWorkerResponse): void {
  port.postMessage(result);
}

port.on('message', (message: CaptionWorkerRequest) => {
  caption(message)
    .then((ids) => {
      postResult({ id: message.id, ids } satisfies CaptionWorkerSuccess);
    })
    .catch((errUnknown: unknown) => {
      const err = asError(errUnknown);
      postResult({ id: message.id, err: err.message, stack: err.stack } satisfies CaptionWorkerError);
    });
});
