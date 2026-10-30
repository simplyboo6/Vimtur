import Crypto from 'node:crypto';
import FS from 'node:fs';
import Path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
export const AUTO_TAG_MODELS: readonly ModelDefinition[] = [
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

const AUTO_TAG_DIR_SUBPATH = 'autotag';

function autoTagDir(): string {
  // Resolved per call: the cache path can change through config overlays.
  return Path.resolve(Config.get().cachePath, AUTO_TAG_DIR_SUBPATH);
}

export function modelPath(definition: ModelDefinition): string {
  return Path.resolve(autoTagDir(), `${definition.id}.onnx`);
}

/**
 * Downloads the model unless a previously downloaded file of the same reported
 * size exists. The download is verified against the definition's sha256 and
 * only then renamed onto its final path, so an interrupted download can never
 * be mistaken for a complete model.
 */
export async function ensureModelDownloaded(definition: ModelDefinition): Promise<string> {
  await ImportUtils.mkdir(autoTagDir());
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

/**
 * Streams the download into `partialPath` while hashing it, then verifies the
 * definition's sha256. On any failure the partial name is removed so nothing
 * incomplete is left for a later run to mistake for model data.
 */
async function downloadAndVerify(definition: ModelDefinition, partialPath: string): Promise<void> {
  try {
    const response = await fetch(definition.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      // Reading the error body is what lets the process log describe it.
      const text = await response.text();
      throw new Error(`Model download failed: ${response.status}: ${text}`);
    }
    if (!response.body) {
      throw new Error('Model download failed: response has no body');
    }
    const hasher = new HashingStream();
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('stream/web').ReadableStream),
      hasher,
      FS.createWriteStream(partialPath),
    );
    const hash = hasher.digest();
    if (hash !== definition.sha256) {
      throw new Error(`Model download hash mismatch: expected ${definition.sha256} got ${hash}`);
    }
  } catch (err: unknown) {
    FS.rmSync(partialPath, { force: true, recursive: true });
    throw err;
  }
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

// Blob-model downloads: the response is streamed into the partial file and
// hashed on the way through, so nothing holds two copies of a 178MB model in
// memory. Generous because the largest registry model is ~180MB on slow links.
const HEAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;

type NodeCallback = (err?: Error | null, data?: Buffer) => void;

async function remoteSize(url: string): Promise<number | undefined> {
  // HEAD only; the body is never used.
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Model size request failed: ${res.status}`);
  }
  const length = res.headers.get('content-length');
  return length ? Number(length) : undefined;
}

// Streams the body hashing every chunk in flight, without materialising the
// whole body.
class HashingStream extends Transform {
  private readonly hash = Crypto.createHash('sha256');

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: NodeCallback): void {
    this.hash.update(chunk);
    callback(null, chunk);
  }

  public digest(): string {
    return this.hash.digest('hex');
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
