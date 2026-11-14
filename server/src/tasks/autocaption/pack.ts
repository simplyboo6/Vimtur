import Path from 'node:path';

import Config from '../../config';

import { ensurePackFilesDownloaded, hasExpectedSize, PACK_DOWNLOAD_TIMEOUT_MS, type PackFile } from '../download';

/**
 * A caption pack: an image encoder graph, a text decoder graph and the
 * decoder's WordPiece vocabulary. Preprocessing lives here rather than in the
 * shared autotag Preprocessing shape because caption families disagree about
 * the resize step (see `resize`).
 */
export interface CaptionPackDefinition {
  id: string;
  name: string;
  files: PackFile[];
  /** Square encoder input side, in pixels. */
  imageSize: number;
  /** 'square' resizes straight to imageSize; 'shortest-edge-crop' scales the
   * shorter side then centre-crops (CLIP preprocessor, used by GIT-family packs). */
  resize: 'square' | 'shortest-edge-crop';
  mean: [number, number, number];
  std: [number, number, number];
  /** Decoder start id ([BOS]/[CLS]). */
  startTokenId: number;
  /** Stop ids; generation ends when one is emitted. */
  endTokenIds: number[];
}

// The #159 Phase 0b BLIP export, hosted by hand at this repository because the
// artifacts are produced by a throwaway spike rather than CI. A missing upload
// therefore makes the first real run fail the download; it cannot corrupt a
// pack, because every file is sha256-verified before it is renamed into place.
const BLIP_URL_PREFIX = 'https://huggingface.co/simplyboo6/vimtur-autocaption-blip-base/resolve/main';

/**
 * BLIP image captioning base: a ViT encoder and a BERT-style cross-attention
 * decoder at 384px, exported as two fp32 graphs (the #159 bake-off rejected
 * int8: dynamic quantisation changed most captions). Sizes and sha256s are the
 * verified Phase 0b export manifest.
 */
export const BLIP_BASE: CaptionPackDefinition = {
  id: 'BLIP-BASE',
  name: 'BLIP image captioning base (384px)',
  files: [
    {
      name: 'encoder.onnx',
      url: `${BLIP_URL_PREFIX}/encoder.onnx`,
      sha256: 'ced5de48bc9aa21faeb73954fc05a4a127eb7c573b8f72fd0158e17c329acf5a',
      size: 344_544_963,
    },
    {
      name: 'decoder.onnx',
      url: `${BLIP_URL_PREFIX}/decoder.onnx`,
      sha256: 'f888d4387f4a5e7f95d24eb4d2fdca94ec227af7c7fcaa07e2c081cb1306b319',
      size: 645_735_366,
    },
    {
      name: 'vocab.txt',
      url: `${BLIP_URL_PREFIX}/vocab.txt`,
      sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
      size: 231_508,
    },
  ],
  imageSize: 384,
  resize: 'square',
  mean: [0.48145466, 0.4578275, 0.40821073],
  std: [0.26862954, 0.26130258, 0.27577711],
  // BLIP's own generate() starts on [BOS] (bert-base vocab + 2) and stops on
  // [SEP]. The config does carry eos_token_id 2, but id 2 is unused in this
  // vocab and the greedy loop never argmaxes it here; [PAD] is the second stop
  // id for safety.
  startTokenId: 30522,
  endTokenIds: [102, 0],
};

export const CAPTION_PACKS: readonly CaptionPackDefinition[] = [BLIP_BASE];
/**
 * The BLIP pack's task id. The registered ids are derived per pack in getTask()
 * and the config's default model spells the same string by hand (importing this
 * module from config.ts would create a cycle), so this helper exists for the
 * unit tests that name the default task explicitly.
 */
export const AUTO_CAPTION_TASK_ID = `AUTO-CAPTION-${BLIP_BASE.id}`;

export function packDir(pack: CaptionPackDefinition): string {
  // Resolved per call: the cache path can change through config overlays.
  return Path.resolve(Config.get().cachePath, 'autocaption', pack.id);
}

export function packFilePath(pack: CaptionPackDefinition, file: PackFile): string {
  return Path.resolve(packDir(pack), file.name);
}

/**
 * True when every file exists with its expected size. Size-only: the sha256
 * is verified once at download time, never on every use. Used to pick the
 * real captioner versus the TEST_MODE fake without any network probing.
 */
export async function isPackCached(pack: CaptionPackDefinition): Promise<boolean> {
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
export async function ensurePackDownloaded(pack: CaptionPackDefinition): Promise<void> {
  if (await isPackCached(pack)) {
    return;
  }
  await ensurePackFilesDownloaded(packDir(pack), pack.files, PACK_DOWNLOAD_TIMEOUT_MS);
}
