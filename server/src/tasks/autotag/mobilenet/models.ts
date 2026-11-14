import FS from 'node:fs';
import OS from 'node:os';
import Path from 'node:path';

import { ImportUtils } from '../../../cache/import-utils';
import Config from '../../../config';
import { downloadAndVerifyFile, type FileDefinition, isFileCached } from '../../download';
import type { Preprocessing } from '../preprocess';

export interface ModelDefinition extends FileDefinition {
  id: string;
  name: string;
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
// The registry feeds the AUTO-TAG-<id> task ids (classify.ts registers one per
// entry) and the membership check pick-import-task.ts applies to the configured
// `autotags.model` task id; registry order is not an import-routing default —
// the config/route defaults select the task.
export const AUTO_TAG_MODELS: readonly ModelDefinition[] = [
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

const AUTO_TAG_DIR_SUBPATH = 'autotag';

function autoTagDir(): string {
  // Resolved per call: the cache path can change through config overlays.
  return Path.resolve(Config.get().cachePath, AUTO_TAG_DIR_SUBPATH);
}

export function modelPath(definition: ModelDefinition): string {
  return Path.resolve(autoTagDir(), `${definition.id}.onnx`);
}

/**
 * Auto-tagging runs one worker per pool instance, and each worker pins its own
 * inference session: model memory (a ResNet-101 session is on the order of
 * 500MB) plus a thread pool. An instance per CPU core fits neither RAM nor the
 * scheduler, so both the pool size (here, the runner) and each session's
 * intra-op threads (classifier-worker.ts) derive from this one cap:
 * intra-op threads converge to the remainder of the core count.
 *
 * availableParallelism() (Node 20+) rather than cpus().length so cgroup
 * quotas and CPU affinity constraints are respected in containerised
 * deployments.
 */
export const MAX_INSTANCES = Math.min(4, OS.availableParallelism());

/**
 * Downloads the model unless a previously downloaded file of the same reported
 * size exists. The download is verified against the definition's sha256 and
 * only then renamed onto its final path, so an interrupted download can never
 * be mistaken for a complete model.
 */
export async function ensureModelDownloaded(definition: ModelDefinition): Promise<string> {
  await ImportUtils.mkdir(autoTagDir());
  const destination = modelPath(definition);
  if (await isFileCached(destination, definition.url)) {
    return destination;
  }

  const partial = `${destination}.part`;
  await downloadAndVerifyFile(definition, partial);
  FS.renameSync(partial, destination);
  console.log(`Model downloaded: ${definition.id}`);
  return destination;
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
