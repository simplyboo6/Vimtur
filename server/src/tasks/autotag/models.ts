import Crypto from 'node:crypto';
import FS from 'node:fs';
import Path from 'node:path';

import { ImportUtils } from '../../cache/import-utils';
import Config from '../../config';

/**
 * Describes how an image is prepared for a model. Every registry model uses
 * the same shape of preprocessing, described generically so new models only
 * need card values: resize so the shorter side is `resizeShorterSide` pixels
 * preserving aspect ratio, centre-crop `cropSize` x `cropSize` pixels, then
 * per channel normalise with `(pixel / 255 - mean[c]) / std[c]` and lay out
 * as NCHW.
 */
export interface Preprocessing {
  /** Length of the resized shorter side, in pixels, before the crop. */
  resizeShorterSide: number;
  /** Length of each side of the centre crop, in pixels. */
  cropSize: number;
  /** Mean per RGB channel, subtracted after scaling pixels to [0, 1]. */
  mean: [number, number, number];
  /** Standard deviation per RGB channel, divided by after scaling to [0, 1]. */
  std: [number, number, number];
}

export interface ModelDefinition {
  id: string;
  name: string;
  url: string;
  sha256: string;
  preprocess: Preprocessing;
}

/**
 * Documented preprocessing of the ONNX Model Zoo exports: shorter side scaled
 * to 256, centre-cropped to the 224 square input, normalised with the
 * torchvision ImageNet constants. Verified against the zoo model cards at
 * migration time in https://github.com/simplyboo6/Vimtur/issues/131.
 */
const ZOO_IMAGENET_PREPROCESS: Preprocessing = {
  resizeShorterSide: 256,
  cropSize: 224,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
};

// Models live in the Hugging Face mirror of the ONNX Model Zoo
// (https://huggingface.co/onnxmodelzoo); the original github.com/onnx/models
// repository is archive-only for downloads. Every model is ImageNet-1k
// classification over the standard 1000 classes, in NCHW float32 layout.
export const AUTO_TAG_MODELS: ModelDefinition[] = [
  // The first one is used when triggered from auto-import.
  {
    id: 'MOBILE-NET-V2',
    name: 'MobileNet V2 [Default]',
    url: 'https://huggingface.co/onnxmodelzoo/mobilenetv2-12/resolve/main/mobilenetv2-12.onnx',
    sha256: 'c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5',
    preprocess: ZOO_IMAGENET_PREPROCESS,
  },
  {
    id: 'RESNET-50-V2',
    name: 'ResNet 50 v2',
    url: 'https://huggingface.co/onnxmodelzoo/resnet50-v2-7/resolve/main/resnet50-v2-7.onnx',
    sha256: '79102261eb6e5fd7af5d27f41316293e388c5cb691e5d25bfb035c4f64fefe31',
    preprocess: ZOO_IMAGENET_PREPROCESS,
  },
  {
    id: 'RESNET-101-V2',
    name: 'ResNet 101 v2',
    url: 'https://huggingface.co/onnxmodelzoo/resnet101-v2-7/resolve/main/resnet101-v2-7.onnx',
    sha256: '3a0a819ea0953fb4700b0d98e43540aeee253e5b4c503c552b0c7979fc67767d',
    preprocess: ZOO_IMAGENET_PREPROCESS,
  },
  {
    id: 'EFFICIENT-NET-B0',
    name: 'EfficientNet B0',
    url: 'https://huggingface.co/onnxmodelzoo/efficientnet_b0_Opset17/resolve/main/efficientnet_b0_Opset17.onnx',
    sha256: 'e76596a2b9e27c7c734c38550859105b43fec926f13447a84dad175eb994068a',
    preprocess: ZOO_IMAGENET_PREPROCESS,
  },
];

export function DEFAULT_AUTO_TAG_MODEL(): ModelDefinition {
  return AUTO_TAG_MODELS[0];
}

const AUTO_TAG_DIR = Path.resolve(Config.get().cachePath, 'autotag');

export function modelPath(definition: ModelDefinition): string {
  return Path.resolve(AUTO_TAG_DIR, `${definition.id}.onnx`);
}

/**
 * Downloads the model unless a previously downloaded file of the same reported
 * size exists. The download is verified against the definition's sha256 and
 * only then renamed onto its final path, so an interrupted download can never
 * be mistaken for a complete model.
 */
export async function ensureModelDownloaded(definition: ModelDefinition): Promise<string> {
  await ImportUtils.mkdir(AUTO_TAG_DIR);
  const destination = modelPath(definition);
  if (await isCached(destination, definition)) {
    return destination;
  }

  const partial = `${destination}.part`;
  await downloadAndVerify(definition, partial);
  FS.renameSync(partial, destination);
  console.log(`Model downloaded: ${definition.id}`);
  return destination;
}

async function isCached(destination: string, definition: ModelDefinition): Promise<boolean> {
  if (!FS.existsSync(destination)) {
    return false;
  }
  const size = FS.statSync(destination).size;
  if (size === 0) {
    return false;
  }
  try {
    return (await remoteSize(definition.url)) === size;
  } catch {
    // An unreachable source with a present model is fine: the feature is
    // offline-after-first-run, so a same-sized cached file is assumed correct.
    return true;
  }
}

async function remoteSize(url: string): Promise<number | undefined> {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) {
    throw new Error(`Model size request failed: ${res.status}`);
  }
  const length = res.headers.get('content-length');
  return length ? Number(length) : undefined;
}

async function downloadAndVerify(definition: ModelDefinition, destination: string): Promise<void> {
  const res = await fetch(definition.url);
  if (!res.ok) {
    const text = await res.text(); // Only here: reading consumes the body.
    throw new Error(`Model download failed: ${res.status}: ${text}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  const hash = Crypto.createHash('sha256').update(data).digest('hex');
  if (hash !== definition.sha256) {
    throw new Error(`Model download hash mismatch: expected ${definition.sha256} got ${hash}`);
  }
  try {
    FS.writeFileSync(destination, data);
  } catch (err: unknown) {
    // A mid-write failure (disk full, permissions) must not leave the
    // temporary name behind for a later run to mistake for model data.
    FS.rmSync(`${destination}.part`, { force: true });
    throw err;
  }
}

// Bundled label list in ImageNet-1k class order, from
// https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt
// (the standard synset ordering the registry models classify against). Each
// entry is on its own line. Bundled rather than downloaded because the old
// Google-hosted label file's 1001 lines (background class first) don't align
// with 1000-class model outputs.
const LABELS_PATH = Path.resolve(__dirname, 'assets', 'imagenet-1k-labels.txt');

export function loadClasses(): string[] {
  const classes = FS.readFileSync(LABELS_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (classes.length !== 1000) {
    throw new Error(`Label file describes ${classes.length} classes, expected 1000: is the bundled asset truncated?`);
  }
  return classes;
}
