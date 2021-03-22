import {
  ClassifierWorkerRequest,
  ClassifierWorkerResponse,
  ClassifierWorkerSuccess,
} from './classifier-worker-wrapper';
import { TensorFlowHubModel, loadClasses, loadModel } from '../imagenet';
import { loadImageFileCommon } from '../common';
import { parentPort } from 'worker_threads';
import TensorFlow from '../tensorflow';

if (!parentPort) {
  throw new Error('Worker missing fields');
}

interface ModelInfo {
  model: Promise<TensorFlow.GraphModel>;
  classes: Promise<string[]>;
  definition: TensorFlowHubModel;
}

let modelInfo: ModelInfo | undefined = undefined;

async function onMessage(message: ClassifierWorkerRequest): Promise<ClassifierWorkerSuccess> {
  if (modelInfo && modelInfo.definition.id !== message.definition.id) {
    modelInfo = undefined;
  }
  if (!modelInfo) {
    modelInfo = {
      definition: message.definition,
      model: loadModel(message.definition),
      classes: loadClasses(),
    };
  }

  const model = await modelInfo.model;
  const classes = await modelInfo.classes;

  const tensor = await loadImageFileCommon(
    message.absolutePath,
    message.definition.width,
    message.definition.height,
  );

  try {
    const classified = model.predict(tensor) as TensorFlow.Tensor<TensorFlow.Rank>;
    try {
      const classificationNestedArray = (await classified.array()) as number[][];
      const classificationArray = classificationNestedArray[0];

      const probabilities = classificationArray
        .map((probability, index) => {
          return {
            probability,
            label: classes[index],
          };
        })
        .sort((a, b) => b.probability - a.probability);
      const topFive = probabilities.slice(0, 5);
      return { probabilities: topFive.map(output => output.label) };
    } finally {
      classified.dispose();
    }
  } finally {
    tensor.dispose();
  }
}

// Wrapper to enforce typing of response.
function postResult(result: ClassifierWorkerResponse): void {
  parentPort!.postMessage(result);
}

parentPort.on('message', (message: ClassifierWorkerRequest) => {
  try {
    onMessage(message)
      .then(result => {
        postResult(result);
      })
      .catch(err => {
        postResult({ err: err.message });
      });
  } catch (err) {
    postResult({ err: err.message });
  }
});
