import { parentPort } from 'worker_threads';

import * as ort from 'onnxruntime-node';

import { asError } from '../../../utils';
import { ensureModelDownloaded, loadClasses, type ModelDefinition } from '../models';
import { preprocessImage, topLabels } from '../preprocess';
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

async function loadModel(definition: ModelDefinition): Promise<LoadedModel> {
  // The session lives inside the worker so the main process never holds the
  // runtime, whether or not auto-tagging runs.
  const modelFile = await ensureModelDownloaded(definition);
  const session = await ort.InferenceSession.create(modelFile);
  return {
    definition,
    input: session.inputNames[0],
    output: session.outputNames[0],
    classes: loadClasses(),
    session,
  };
}

async function onMessage(message: ClassifierWorkerRequest): Promise<string[]> {
  if (!loaded || loaded.definition.id !== message.definition.id) {
    loaded = await loadModel(message.definition);
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

// Wrapper to enforce typing of response.
function postResult(result: ClassifierWorkerResponse): void {
  parentPort!.postMessage(result);
}

parentPort.on('message', (message: ClassifierWorkerRequest) => {
  onMessage(message)
    .then((labels) => {
      postResult({ id: message.id, labels } satisfies ClassifierWorkerSuccess);
    })
    .catch((errUnknown: unknown) => {
      const err = asError(errUnknown);
      postResult({ id: message.id, err: err.message } satisfies ClassifierWorkerError);
    });
});
