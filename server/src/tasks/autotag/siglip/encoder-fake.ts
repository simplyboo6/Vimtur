import Crypto from 'node:crypto';
import FS from 'node:fs';

import type { EncoderPool } from './encoder';
import type { EmbeddingPackDefinition } from './pack';
import { l2NormaliseRow } from './vector';

/**
 * Deterministic TEST_MODE stand-in for the dual-tower encoders. Embeddings
 * are seeded from the content hash of each prompt (texts) or each image file
 * (images), so the same inputs always produce the same vectors and cache
 * resumability behaves like the real encoder — while needing neither ONNX
 * sessions nor a downloaded pack. Vector content is intentionally meaningless
 * (pseudo-random unit vectors): the fake exists to exercise the pipeline's
 * plumbing and state machine, not model semantics.
 */
export class FakeEncoderPool implements EncoderPool {
  public readonly kind = 'fake';

  private readonly dim: number;

  public constructor(dim: number) {
    this.dim = dim;
  }

  public async encodeTexts(pack: EmbeddingPackDefinition, prompts: string[]): Promise<Float32Array[]> {
    if (pack.dim !== this.dim) {
      throw new Error(`Fake encoder built for ${this.dim} dims, pack says ${pack.dim}`);
    }
    return Promise.resolve(prompts.map((prompt) => this.embed(`text:${prompt}`)));
  }

  public async encodeImages(pack: EmbeddingPackDefinition, absolutePaths: string[]): Promise<Float32Array[]> {
    if (pack.dim !== this.dim) {
      throw new Error(`Fake encoder built for ${this.dim} dims, pack says ${pack.dim}`);
    }
    // Seeded from the file bytes: identical content re-encodes identically,
    // which is the property the embedding cache relies on.
    const rows = absolutePaths.map((path) =>
      this.embed(`image:${Crypto.createHash('sha256').update(FS.readFileSync(path)).digest('hex')}`),
    );
    return Promise.resolve(rows);
  }

  public async quit(): Promise<void> {
    // Nothing to release: no sessions were ever created.
    return Promise.resolve();
  }

  private embed(seed: string | Buffer): Float32Array {
    return l2NormaliseRow(seededVector(seed, this.dim));
  }
}

/**
 * Uniform [-1, 1) values hashed out of the seed, in a fixed pattern the
 * vector module re-normalises. 32 hash bytes per round keep generation cheap.
 */
function seededVector(seed: string | Buffer, dim: number): Float32Array {
  const output = new Float32Array(dim);
  for (let offset = 0; offset < dim; offset += 32) {
    const digest = Crypto.createHash('sha256')
      .update(seed)
      .update(`#${Math.floor(offset / 32)}`)
      .digest();
    for (let index = 0; index < 32 && offset + index < dim; index++) {
      output[offset + index] = digest[index] / 127.5 - 1;
    }
  }
  return output;
}
