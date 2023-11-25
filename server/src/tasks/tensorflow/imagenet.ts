import FS from 'fs';
import Path from 'path';

import { NodeFileSystem } from '@tensorflow/tfjs-node/dist/io/file_system';
import Fetch from 'node-fetch';

import { ImportUtils } from '../../cache/import-utils';
import Config from '../../config';

import TensorFlow from './tensorflow';

// Explicitly import from the sub-directory so the TFJS node backend isn't
// loaded on non-AVX CPUs.

export interface TensorFlowHubModel {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

const MODELS_DIR = Path.resolve(Config.get().cachePath, 'tensorflow');

function loadClassesLocal(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    FS.readFile(Path.resolve(MODELS_DIR, 'ImageNetLabels.txt'), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.toString());
      }
    });
  });
}

async function loadClassesRemote(): Promise<string> {
  const res = await Fetch('https://storage.googleapis.com/download.tensorflow.org/data/ImageNetLabels.txt');
  if (!res.ok) {
    throw new Error('Failed to fetch imagenet classes');
  }
  return res.text();
}

function saveClasses(classes: string): Promise<void> {
  return new Promise((resolve, reject) => {
    FS.writeFile(Path.resolve(MODELS_DIR, 'ImageNetLabels.txt'), classes, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function loadClassesRaw(): Promise<string> {
  try {
    const classes = await loadClassesLocal();
    return classes;
  } catch {
    console.log('Downloading ImageNet classes');
    const classes = await loadClassesRemote();
    await saveClasses(classes);
    console.log('ImageNet classes saved');
    return classes;
  }
}

export async function loadClasses(): Promise<string[]> {
  await ImportUtils.mkdir(MODELS_DIR);
  const raw = await loadClassesRaw();
  return raw.split('\n').map((line) => line.trim());
}

export async function loadModel(modelDefinition: TensorFlowHubModel): Promise<TensorFlow.GraphModel> {
  await ImportUtils.mkdir(MODELS_DIR);
  try {
    const io = new NodeFileSystem(Path.resolve(MODELS_DIR, modelDefinition.id, 'model.json'));
    const model = await TensorFlow.loadGraphModel(io);
    return model;
  } catch (err) {
    console.error(err);
    console.log(`Downloading model: ${modelDefinition.id}`);
    const model = await TensorFlow.loadGraphModel(modelDefinition.url, { fromTFHub: true });
    const io = new NodeFileSystem(Path.resolve(MODELS_DIR, modelDefinition.id));
    await model.save(io);
    console.log(`Model saved: ${modelDefinition.id}`);
    return model;
  }
}

// All use the common image input.
export const IMAGENET_MODELS: TensorFlowHubModel[] = [
  // The first one is used when triggered from auto-import.
  {
    id: 'MOBILE-NET-V2-140',
    name: 'MobileNet V2 140 [Default]',
    url: 'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_140_224/classification/3/default/1',
    width: 224,
    height: 224,
  },
  {
    id: 'INCEPTION-RESNET-V2',
    name: 'Inception ResNet V2',
    url: 'https://tfhub.dev/google/tfjs-model/imagenet/inception_resnet_v2/classification/3/default/1',
    width: 299,
    height: 299,
  },
  {
    id: 'RESNET-V2-50',
    name: 'ResNet V2 50',
    url: 'https://tfhub.dev/google/tfjs-model/imagenet/resnet_v2_50/classification/3/default/1',
    width: 224,
    height: 224,
  },
  {
    id: 'RESNET-V2-101',
    name: 'ResNet V2 101',
    url: 'https://tfhub.dev/google/tfjs-model/imagenet/resnet_v2_101/classification/3/default/1',
    width: 224,
    height: 224,
  },
];
