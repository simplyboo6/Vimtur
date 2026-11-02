import OS from 'node:os';

import { ScalingConnectionPool } from 'proper-job';

import { autotagWorkerMemoryLimit } from '../../../utils/system-memory';

import { FakeEncoderPool } from './encoder-fake';
import { ensurePackDownloaded, isPackCached, packFilePath, TEXT_BATCH } from './pack';
import type { EmbeddingPackDefinition } from './pack';
import { autotagSettings } from './state';
import { SigLip2Tokenizer } from './tokenizer';
import { SiglipWorkerWrapper } from './workers/siglip-worker-wrapper';

/**
 * The boundary the Auto-Tagging tasks run against: encode prompt strings and
 * image files in input order, get back one L2-normalised row per input. The
 * real implementation fans batches out over worker instances; the TEST_MODE
 * fake answers deterministically from content hashes without any models.
 */
export interface EncoderPool {
  /** Implementation identity, part of the embedding cache's fingerprint. */
  readonly kind: 'ort' | 'fake';
  encodeTexts(pack: EmbeddingPackDefinition, prompts: string[]): Promise<Float32Array[]>;
  encodeImages(pack: EmbeddingPackDefinition, absolutePaths: string[]): Promise<Float32Array[]>;
  quit(): Promise<void>;
}

/**
 * Encoder pool concurrency: the configured worker count, clamped to the
 * schema's bounds (8), the machine's CPU count and the memory rule (encoder
 * workers may claim at most half of system memory, see
 * utils/system-memory.ts). An explicit user value is therefore honoured only
 * up to what the machine can actually hold: each instance pins roughly a GB of
 * pack memory, and the config's bounds alone cannot protect a 2-core or 2GB
 * box from a user who sets workers=8.
 */
export function encoderInstances(): number {
  // autotagSettings() throws rather than inventing a count when the section is
  // missing; the config DEFAULTS always provide it, so absence is corruption.
  // Math.floor because the schema has no integer constraint, and a fractional
  // worker count would otherwise reach the pool.
  const configured = Math.floor(autotagSettings().workers);
  return Math.min(8, Math.max(1, configured), autotagWorkerMemoryLimit(), OS.availableParallelism());
}

/**
 * Chooses the pool: a fully cached pack always runs the real encoder (also
 * under TEST_MODE — seeded end-to-end tests pin the real model), otherwise
 * TEST_MODE runs the deterministic fake, and a real run downloads the pack
 * on first use like every other model.
 */
export async function ensureEncoderPool(pack: EmbeddingPackDefinition): Promise<EncoderPool> {
  if (!(await isPackCached(pack))) {
    if (process.env['TEST_MODE']) {
      return new FakeEncoderPool(pack.dim);
    }
    await ensurePackDownloaded(pack);
  }
  return SiglipEncoderPool.create(pack, encoderInstances());
}

/**
 * Pool of SigLIP worker instances over the dual-tower pack. Tokenisation
 * happens here, in the main thread, once per pool: the workers receive
 * finished token rows and never parse the multi-megabyte tokenizer.json.
 */
export class SiglipEncoderPool implements EncoderPool {
  public readonly kind = 'ort' as const;

  private readonly pool: ScalingConnectionPool<SiglipWorkerWrapper>;
  private readonly tokenizer: SigLip2Tokenizer;
  private readonly filePaths: Record<string, string>;
  private readonly pack: EmbeddingPackDefinition;

  /**
   * Async factory: the tokenizer.json read has to stay off the event loop, so
   * the tokenizer is loaded here and handed to the private constructor.
   */
  public static async create(pack: EmbeddingPackDefinition, instanceCount: number): Promise<SiglipEncoderPool> {
    const tokenizer = await SigLip2Tokenizer.fromTokenizerJson(
      SiglipEncoderPool.tokenizerPath(pack),
      pack.contextLength,
    );
    return new SiglipEncoderPool(pack, instanceCount, tokenizer);
  }

  private constructor(pack: EmbeddingPackDefinition, instanceCount: number, tokenizer: SigLip2Tokenizer) {
    this.pack = pack;
    this.tokenizer = tokenizer;
    this.filePaths = Object.fromEntries(pack.files.map((file) => [file.name, packFilePath(pack, file)]));
    this.pool = new ScalingConnectionPool(
      () => {
        return new SiglipWorkerWrapper();
      },
      // One instance per configured worker: each instance pins both towers
      // (roughly a GB here), so the config's worker count is the instance
      // count, clamped once by encoderInstances(). Inherited pool limitation:
      // a crashed instance is not evicted mid-pool; its queued chunk fails via
      // continueOnError and the task ends with partial work.
      { maxInstances: instanceCount },
    );
  }

  public async encodeTexts(pack: EmbeddingPackDefinition, prompts: string[]): Promise<Float32Array[]> {
    if (pack.id !== this.pack.id) {
      throw new Error(`Encoder pool pinned to ${this.pack.id}, asked for ${pack.id}`);
    }
    const textPath = this.filePaths['text.ort'];
    if (!textPath) {
      throw new Error(`Pack ${this.pack.id} is missing text.ort`);
    }
    // Tokenise everything first: pure main-thread work, canonical order.
    const rows = prompts.map((prompt) => this.tokenizer.encodeToIds(prompt));
    const results = await this.chunked(rows, TEXT_BATCH, (instance, chunk) =>
      instance.encodeTexts({ textPath, contextLength: this.pack.contextLength, rows: chunk }),
    );
    return results.flat();
  }

  public async encodeImages(pack: EmbeddingPackDefinition, absolutePaths: string[]): Promise<Float32Array[]> {
    if (pack.id !== this.pack.id) {
      throw new Error(`Encoder pool pinned to ${this.pack.id}, asked for ${pack.id}`);
    }
    const imagePath = this.filePaths['image.ort'];
    if (!imagePath) {
      throw new Error(`Pack ${this.pack.id} is missing image.ort`);
    }
    const results = await this.chunked(absolutePaths, SMALL_IMAGE_CHUNK, (instance, chunk) =>
      instance.encodeImages({ imagePath, preprocess: this.pack.preprocess, absolutePaths: chunk }),
    );
    return results.flat();
  }

  /**
   * Runs `worker` over fixed contiguous chunks of `inputs`, one chunk per
   * pool instance request. Chunk boundaries are a strict function of the
   * input order, never of scheduling, so a rerun of the same list cannot
   * produce different batch compositions (see the pack's IMAGE_BATCH note).
   */
  private async chunked<T, U>(
    inputs: T[],
    chunkSize: number,
    worker: (instance: SiglipWorkerWrapper, chunk: T[]) => Promise<U[]>,
  ): Promise<U[]> {
    const chunks: T[][] = [];
    for (let offset = 0; offset < inputs.length; offset += chunkSize) {
      chunks.push(inputs.slice(offset, offset + chunkSize));
    }
    return (await Promise.all(chunks.map((chunk) => this.pool.run((instance) => worker(instance, chunk))))).flat();
  }

  public async quit(): Promise<void> {
    await this.pool.quit();
  }

  private static tokenizerPath(pack: EmbeddingPackDefinition): string {
    const file = pack.files.find((candidate) => candidate.name === 'tokenizer.json');
    if (!file) {
      throw new Error(`Pack ${pack.id} has no tokenizer file`);
    }
    return packFilePath(pack, file);
  }
}

// Stills per image-chunk request: eight canonical IMAGE_BATCHes. Same
// reasoning as the batching constants — chunked content is order-canonical.
const SMALL_IMAGE_CHUNK = 32;
