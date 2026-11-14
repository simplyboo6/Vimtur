import Path from 'node:path';

import Config from '../../../config';

import { ensurePackFilesDownloaded, hasExpectedSize, PACK_DOWNLOAD_TIMEOUT_MS, type PackFile } from '../../download';
import type { Preprocessing } from '../preprocess';

/**
 * An embedding pack: dual-tower SigLIP-style models shipped as separate
 * image/text ONNX graphs plus their tokenizer. `preprocess` uses the shared
 * Preprocessing shape; the Aves pack keeps raw [0, 1] pixels (mean 0 / std 1)
 * because the graph applies normalisation itself — feeding pre-normalised
 * input roughly halves its quality (POC NOTES.md).
 */
export interface EmbeddingPackDefinition {
  id: string;
  name: string;
  files: PackFile[];
  preprocess: Preprocessing;
  /** Fixed text token context, including the appended <eos> slot. */
  contextLength: number;
  /** Dimension of the 'embedding' output both towers emit. */
  dim: number;
}

const AVES_URL_PREFIX =
  'https://huggingface.co/sliderforthewin/aves-smart-search-siglip2-selective-int8/resolve/main/siglip2-b32-256-selective-int8-v1';

/**
 * Aves Smart Search: SigLIP-2 B/32 @ 256px, selective int8 quantisation
 * (accuracy-sensitive output projections kept fp32), separate image and text
 * towers emitting L2-normalised 768-d vectors under the output name
 * 'embedding'. Sizes and sha256s verified against the HF LFS pointers.
 */
export const AVES_SIGLIP2_B32: EmbeddingPackDefinition = {
  id: 'AVES-SIGLIP2-B32',
  name: 'Aves Smart Search SigLIP-2 B/32 (256px)',
  files: [
    {
      name: 'image.ort',
      url: `${AVES_URL_PREFIX}/image.ort`,
      sha256: 'd6a54abc8d25ea7f5d633de8d27fbae6b3cdace0e87703140641e7317133efb6',
      size: 195_003_280,
    },
    {
      name: 'text.ort',
      url: `${AVES_URL_PREFIX}/text.ort`,
      sha256: '27c420458dfac229ed98c17dc57f516441dd10c912aa1682195cf0a2e578d591',
      size: 368_788_736,
    },
    {
      name: 'tokenizer.json',
      url: `${AVES_URL_PREFIX}/tokenizer.json`,
      sha256: '220c63d496e0c14e63eb656c91e0215e926202e4c74b1f089e09f1920d779b04',
      size: 34_362_885,
    },
  ],
  preprocess: {
    resizeShorterSide: 256,
    cropSize: 256,
    // Raw [0, 1]: the graph normalises internally.
    mean: [0, 0, 0],
    std: [1, 1, 1],
  },
  contextLength: 64,
  dim: 768,
};

/**
 * Canonical batching, carried over from the POC measurement pass:
 * quantised models derive activation scales per run, so if batch composition
 * changed between runs the calibrations flapped on knife-edge thresholds.
 * These are fixed constants every encode path must honour, in fixed input
 * order.
 */
export const IMAGE_BATCH = 4;
export const TEXT_BATCH = 32;

export function packDir(pack: EmbeddingPackDefinition): string {
  // Resolved per call: the cache path can change through config overlays.
  return Path.resolve(Config.get().cachePath, 'autotag', pack.id);
}

export function packFilePath(pack: EmbeddingPackDefinition, file: PackFile): string {
  return Path.resolve(packDir(pack), file.name);
}

/**
 * True when every file exists with its expected size. Size-only: the sha256
 * is verified once at download time, never on every use. Used to pick the
 * real encoder versus the TEST_MODE fake without any network probing.
 */
export async function isPackCached(pack: EmbeddingPackDefinition): Promise<boolean> {
  for (const file of pack.files) {
    if (!(await hasExpectedSize(packFilePath(pack, file), file.size))) {
      return false;
    }
  }
  return true;
}

/**
 * Ensures every pack file is present and verified, downloading what is
 * missing through the shared flat-file helper.
 */
export async function ensurePackDownloaded(pack: EmbeddingPackDefinition): Promise<void> {
  if (await isPackCached(pack)) {
    return;
  }
  await ensurePackFilesDownloaded(packDir(pack), pack.files, PACK_DOWNLOAD_TIMEOUT_MS);
}
