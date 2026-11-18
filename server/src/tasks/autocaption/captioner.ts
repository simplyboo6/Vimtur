import OS from 'node:os';

import { ScalingConnectionPool } from 'proper-job';

import { autotagWorkerMemoryLimit } from '../../utils/system-memory';

import { WordPieceDetokenizer } from './detokenizer';
import { ensurePackDownloaded, isPackCached, packFilePath } from './pack';
import type { CaptionPackDefinition } from './pack';
import { autocaptionSettings } from './settings';
import { CaptionWorkerWrapper } from './workers/caption-worker-wrapper';

/**
 * The boundary the Auto-Captioning tasks run against: caption one image file
 * and get back its text. The real implementation fans requests out over worker
 * instances; the TEST_MODE fake answers deterministically from file hashes
 * without any models.
 */
export interface CaptionerPool {
  caption(pack: CaptionPackDefinition, absolutePath: string): Promise<string>;
  quit(): Promise<void>;
}

/**
 * Captioner pool concurrency: the configured worker count, clamped to the
 * schema's bounds (8), the machine's CPU count and the memory rule (caption
 * workers may claim at most half of system memory, see
 * utils/system-memory.ts). An explicit user value is therefore honoured only up
 * to what the machine can actually hold: each instance pins both graphs
 * (roughly a GB for the BLIP export), and the config's bounds alone cannot
 * protect a 2-core or 2GB box from a user who sets workers=8.
 */
export function captionInstances(): number {
  // autocaptionSettings() throws rather than inventing a count when the section
  // is missing; the config DEFAULTS always provide it, so absence is
  // corruption. Math.floor because the schema has no integer constraint, and a
  // fractional worker count would otherwise reach the pool.
  const configured = Math.floor(autocaptionSettings().workers);
  return Math.min(8, Math.max(1, configured), autotagWorkerMemoryLimit(), OS.availableParallelism());
}

/**
 * Chooses the pool: a fully cached pack always runs the real captioner (also
 * under TEST_MODE — a seeded end-to-end test pins the real model), otherwise
 * TEST_MODE runs the deterministic fake, and a real run downloads the pack on
 * first use like every other model.
 */
export async function ensureCaptionerPool(pack: CaptionPackDefinition): Promise<CaptionerPool> {
  if (!(await isPackCached(pack))) {
    if (process.env['TEST_MODE']) {
      // The deterministic stand-in lives with the tests, not in the shipped
      // captioner; the dynamic import keeps it out of a normal run entirely.
      const { FakeCaptionerPool } = await import('../../test/support/fake-captioner');
      return new FakeCaptionerPool();
    }
    await ensurePackDownloaded(pack);
  }
  return OrtCaptionerPool.create(pack, captionInstances());
}

/**
 * Pool of captioning worker instances over one pack. The detokeniser is loaded
 * here, in the main thread, once per pool: the workers receive and return ids
 * and never parse the 30k-entry vocabulary per message.
 */
export class OrtCaptionerPool implements CaptionerPool {
  private readonly pool: ScalingConnectionPool<CaptionWorkerWrapper>;
  private readonly detokenizer: WordPieceDetokenizer;
  private readonly pack: CaptionPackDefinition;
  private readonly filePaths: Record<string, string>;
  private readonly maxNewTokens: number;

  /**
   * Async factory: the vocab.txt read has to stay off the worker messages (and
   * is cheap enough in the main thread), so the detokeniser is loaded here and
   * handed to the private constructor.
   */
  public static async create(pack: CaptionPackDefinition, instanceCount: number): Promise<OrtCaptionerPool> {
    const detokenizer = await WordPieceDetokenizer.fromFile(OrtCaptionerPool.filePath(pack, 'vocab.txt'));
    return new OrtCaptionerPool(pack, instanceCount, detokenizer);
  }

  private constructor(pack: CaptionPackDefinition, instanceCount: number, detokenizer: WordPieceDetokenizer) {
    this.pack = pack;
    this.detokenizer = detokenizer;
    this.filePaths = Object.fromEntries(pack.files.map((file) => [file.name, packFilePath(pack, file)]));
    // Read once per pool: the page setting is the ceiling for every caption in
    // this run, so a mid-run config change cannot make the pool inconsistent.
    this.maxNewTokens = autocaptionSettings().maxTokens;
    this.pool = new ScalingConnectionPool(
      () => {
        return new CaptionWorkerWrapper();
      },
      // ScalingConnectionPool keeps at least one instance alive and scales the
      // rest on demand, so maxInstances is a ceiling, not a fixed pool: each
      // instance pins both graphs (roughly a GB here), and the ceiling is
      // clamped once by captionInstances(). Inherited pool limitation: a
      // crashed instance is not evicted mid-pool; its queued item fails via
      // continueOnError and the task ends with partial work.
      { maxInstances: instanceCount },
    );
  }

  public async caption(pack: CaptionPackDefinition, absolutePath: string): Promise<string> {
    if (pack.id !== this.pack.id) {
      throw new Error(`Caption pool pinned to ${this.pack.id}, asked for ${pack.id}`);
    }
    const ids = await this.pool.run((instance) =>
      instance.caption({
        encoderPath: this.requireFile('encoder.onnx'),
        decoderPath: this.requireFile('decoder.onnx'),
        preprocess: {
          imageSize: this.pack.imageSize,
          resize: this.pack.resize,
          mean: this.pack.mean,
          std: this.pack.std,
        },
        startTokenId: this.pack.startTokenId,
        endTokenIds: this.pack.endTokenIds,
        maxNewTokens: this.maxNewTokens,
        absolutePath,
      }),
    );
    return this.detokenizer.decode(ids);
  }

  public async quit(): Promise<void> {
    await this.pool.quit();
  }

  private requireFile(name: string): string {
    const path = this.filePaths[name];
    if (!path) {
      throw new Error(`Pack ${this.pack.id} is missing ${name}`);
    }
    return path;
  }

  private static filePath(pack: CaptionPackDefinition, name: string): string {
    const file = pack.files.find((candidate) => candidate.name === name);
    if (!file) {
      throw new Error(`Pack ${pack.id} has no ${name} file`);
    }
    return packFilePath(pack, file);
  }
}
