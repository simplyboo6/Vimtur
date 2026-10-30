import OS from 'os';
import { parentPort } from 'worker_threads';

import * as ort from 'onnxruntime-node';

import { asError } from '../../../utils';
import { loadClasses, type ModelDefinition } from '../models';
import { preprocessImage, topLabels } from '../preprocess';
import { MAX_INSTANCES } from '../resources';
import type {
  ClassifierWorkerError,
  ClassifierWorkerRequest,
  ClassifierWorkerResponse,
  ClassifierWorkerSuccess,
} from './classifier-worker-wrapper';

if (!parentPort) {
  throw new Error('Worker missing fields');
}

interface LoadedModel {
  definition: ModelDefinition;
  input: string;
  output: string;
  classes: string[];
  session: ort.InferenceSession;
}

let loaded: LoadedModel | undefined;

async function loadModel(definition: ModelDefinition, modelPath: string): Promise<LoadedModel> {
  // A pool has one model for its lifetime; a swapped id means the worker was
  // reused across runs. Release the previous session so its pinned model
  // memory (hundreds of MB for the large models) isn't held at the same time.
  if (loaded) {
    await loaded.session.release();
    loaded = undefined;
  }
  const session = await createSession(modelPath);
  return {
    definition,
    input: session.inputNames[0],
    output: session.outputNames[0],
    classes: loadClasses(),
    session,
  };
}

async function createSession(modelPath: string): Promise<ort.InferenceSession> {
  // Each session pins the model's memory and threads; spreading the cores so
  // the instances don't quadratic-oversubscribe mirrors the pool sizing in
  // resources.ts. The CPU provider is pinned (rather than defaulting) so a
  // host that installed the optional GPU providers does not move many
  // parallel sessions onto one GPU. availableParallelism() respects cgroup
  // quotas and CPU affinity, matching MAX_INSTANCES on limited containers.
  const intraOpNumThreads = Math.max(1, Math.floor(OS.availableParallelism() / MAX_INSTANCES));
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads,
    interOpNumThreads: 1,
  });
}

async function onMessage(message: ClassifierWorkerRequest): Promise<string[]> {
  if (!loaded || loaded.definition.id !== message.definition.id) {
    loaded = await loadModel(message.definition, message.modelPath);
  }

  const preprocessing = message.definition.preprocess;
  const input = await preprocessImage(message.absolutePath, preprocessing);
  // Registry models are all NCHW with a single square RGB float input.
  const tensor = new ort.Tensor('float32', input, [1, 3, preprocessing.cropSize, preprocessing.cropSize]);
  const outputs = await loaded.session.run({ [loaded.input]: tensor });
  // Registry models expose a single numeric float output.
  const logits = outputs[loaded.output].data as ArrayLike<number>;
  return topLabels(logits, loaded.classes, 5);
}

const port = parentPort;

// Wrapper to enforce typing of response.
function postResult(result: ClassifierWorkerResponse): void {
  port.postMessage(result);
}

port.on('message', (message: ClassifierWorkerRequest) => {
  onMessage(message)
    .then((labels) => {
      postResult({ id: message.id, labels } satisfies ClassifierWorkerSuccess);
    })
    .catch((errUnknown: unknown) => {
      const err = asError(errUnknown);
      postResult({ id: message.id, err: err.message, stack: err.stack } satisfies ClassifierWorkerError);
    });
});
