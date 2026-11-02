import 'source-map-support/register';

import FS from 'node:fs';
import OS from 'node:os';
import Path from 'node:path';

import type { Autotag, Configuration, SubsetConstraints, UpdateMedia } from '@vimtur/common';
import { expect } from 'chai';
import { after, before, beforeEach, describe, it } from 'mocha';

import { getTask as getClearTaggedAutotagsTask } from '../tasks/autotag/clear-tagged-autotags';

import {
  computeFingerprint,
  embeddingsIndex,
  loadEmbeddingCache,
  removeCachedEmbeddings,
  saveEmbeddingCache,
} from '../tasks/autotag/siglip/embed-cache';
import { FakeEncoderPool } from '../tasks/autotag/siglip/encoder-fake';
import { auroc, bestF1Threshold } from '../tasks/autotag/siglip/metrics';
import { packDir } from '../tasks/autotag/siglip/pack';
import type { EmbeddingPackDefinition } from '../tasks/autotag/siglip/pack';
import { pickImportTask } from '../tasks/autotag/siglip/pick-import-task';
import { buildPromptTable } from '../tasks/autotag/siglip/prompts';
import { makeTagScorer } from '../tasks/autotag/siglip/scoring';
import { configuredTags, deriveTagState } from '../tasks/autotag/siglip/state';
import type { AutotagSettings } from '../tasks/autotag/siglip/state';
import { SIGLIP2_EOS_ID, SIGLIP2_PAD_ID, SIGLIP2_UNK_ID, SigLip2Tokenizer } from '../tasks/autotag/siglip/tokenizer';
import { l2NormaliseRow } from '../tasks/autotag/siglip/vector';

// Unit tests for the SigLIP2 Auto-Tagging primitives. Everything except the
// ONNX encoder itself is pure or file-local, so the pipeline's behaviour can
// be pinned without downloading a pack; the encoder boundary is covered by
// the deterministic fake.

// Minimal stand-in for the Aves pack: the shapes the modules under test read,
// without the real download metadata.
const TEST_PACK: EmbeddingPackDefinition = {
  id: 'TEST-PACK',
  name: 'Test embedding pack',
  files: [
    { name: 'image.ort', url: 'https://example.invalid/image.ort', sha256: 'a'.repeat(64), size: 1 },
    { name: 'text.ort', url: 'https://example.invalid/text.ort', sha256: 'b'.repeat(64), size: 1 },
  ],
  preprocess: {
    resizeShorterSide: 4,
    cropSize: 4,
    mean: [0, 0, 0],
    std: [1, 1, 1],
  },
  contextLength: 8,
  dim: 4,
};

describe('SigLIP2 tokenizer', () => {
  it('Normalises spaces to the metaspace piece before BPE', () => {
    // " a" becomes "▁a", which the merge table folds into a known piece; a
    // literal space would stay merged with nothing and fall through as <unk>.
    const tokenizer = new SigLip2Tokenizer({ '▁a': 7 }, [['▁', 'a']], 8);
    expect(tokenizer.encodeToIds(' a')).to.deep.equal([7, SIGLIP2_EOS_ID, 0, 0, 0, 0, 0, 0]);
  });

  it('Applies the lowest-rank merge first when several are possible', () => {
    const vocab = { a: 100, b: 101, c: 102, ab: 20, bc: 21 };
    // "abc" offers both "ab" and "bc"; whichever pair is listed first wins.
    const abFirst = new SigLip2Tokenizer(
      vocab,
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      8,
    );
    expect(abFirst.encodeToIds('abc')).to.deep.equal([20, 102, SIGLIP2_EOS_ID, 0, 0, 0, 0, 0]);
    const bcFirst = new SigLip2Tokenizer(
      vocab,
      [
        ['b', 'c'],
        ['a', 'b'],
      ],
      8,
    );
    expect(bcFirst.encodeToIds('abc')).to.deep.equal([100, 21, SIGLIP2_EOS_ID, 0, 0, 0, 0, 0]);
  });

  it('Maps pieces missing from the vocabulary to the unknown id', () => {
    const tokenizer = new SigLip2Tokenizer({}, [], 8);
    expect(tokenizer.encodeToIds('xyz')).to.deep.equal([
      SIGLIP2_UNK_ID,
      SIGLIP2_UNK_ID,
      SIGLIP2_UNK_ID,
      SIGLIP2_EOS_ID,
      0,
      0,
      0,
      0,
    ]);
  });

  it('Always returns exactly the context length, including for empty input', () => {
    const tokenizer = new SigLip2Tokenizer({ a: 10, b: 11 }, [], 8);
    for (const text of ['', 'a', 'ab', 'abababababab']) {
      expect(tokenizer.encodeToIds(text), `row length for '${text}'`).to.have.lengthOf(8);
    }
    // The context length is the instance's, not a fixed constant.
    const short = new SigLip2Tokenizer({ a: 10 }, [], 3);
    expect(short.encodeToIds('aaaa')).to.deep.equal([10, 10, SIGLIP2_EOS_ID]);
  });

  it('Appends EOS and then pads a short text to the context length', () => {
    // " cat" -> "▁cat", fully merged into a single vocabulary piece.
    const tokenizer = new SigLip2Tokenizer(
      { '▁cat': 10 },
      [
        ['c', 'a'],
        ['ca', 't'],
        ['▁', 'cat'],
      ],
      8,
    );
    expect(tokenizer.encodeToIds(' cat')).to.deep.equal([
      10,
      SIGLIP2_EOS_ID,
      SIGLIP2_PAD_ID,
      SIGLIP2_PAD_ID,
      SIGLIP2_PAD_ID,
      SIGLIP2_PAD_ID,
      SIGLIP2_PAD_ID,
      SIGLIP2_PAD_ID,
    ]);
  });

  it('Truncates to leave EOS in the last slot at or over the context length', () => {
    const vocab: Record<string, number> = {};
    for (const [index, letter] of [...'abcdefgh'].entries()) {
      vocab[letter] = 10 + index;
    }
    // Seven pieces fill the context exactly once EOS is appended; eight
    // pieces drop the eighth rather than the EOS slot.
    const exactRow = [10, 11, 12, 13, 14, 15, 16, SIGLIP2_EOS_ID];
    expect(new SigLip2Tokenizer(vocab, [], 8).encodeToIds('abcdefg')).to.deep.equal(exactRow);
    expect(new SigLip2Tokenizer(vocab, [], 8).encodeToIds('abcdefgh')).to.deep.equal(exactRow);
    // Over the context: pieces are cut to contextLength - 1, then EOS.
    expect(new SigLip2Tokenizer(vocab, [], 5).encodeToIds('abcdefgh')).to.deep.equal([10, 11, 12, 13, SIGLIP2_EOS_ID]);
  });
});

describe('calibration metrics', () => {
  describe('auroc', () => {
    it('Returns 1 for perfect separation', () => {
      expect(auroc([0.9, 0.8], [0.1, 0.2])).to.equal(1);
    });

    it('Returns 0 for a fully reversed ordering', () => {
      expect(auroc([0.1, 0.2], [0.8, 0.9])).to.equal(0);
    });

    it('Returns 0.5 when every score is tied', () => {
      expect(auroc([0.5, 0.5], [0.5, 0.5])).to.equal(0.5);
    });

    it('Credits tied pairs at half, independent of the other pairs', () => {
      // One positive of 0.5 against negatives 0.9 (loss), 0.5 (tie) and 0.1
      // (win): (0 + 0.5 + 1) / 3.
      expect(auroc([0.5], [0.9, 0.5, 0.1])).to.equal(0.5);
    });
  });

  describe('bestF1Threshold', () => {
    it('Cuts at the lowest positive score when the classes separate cleanly', () => {
      // Candidates at or below 0.8 keep both positives and no negatives, so
      // the best cut is the gap's floor.
      expect(bestF1Threshold([0.8, 0.9], [0.1, 0.2])).to.equal(0.8);
    });

    it('Keeps the higher cut when candidate F1 scores tie', () => {
      // Cut 0.1 predicts both positives and both negatives (P=0.5, R=1);
      // cut 0.2 predicts one positive and no negatives (P=1, R=0.5). Both
      // score F1 2/3, so the >= comparison keeps the higher cut.
      expect(bestF1Threshold([0.1, 0.2], [0.1, 0.1])).to.equal(0.2);
    });

    it('Returns null when the best cut is negative', () => {
      // The only negative outscores both positives, so the F1-optimal cut is
      // negative (inside the anti-similar range): signal-less, recorded null.
      expect(bestF1Threshold([-0.5, -0.2], [-0.1])).to.equal(null);
    });

    it('Keeps a best cut of exactly zero as a real value', () => {
      // Cut 0 separates both positives from both negatives (P=1, R=1), while
      // cut -0.4 drags both negatives in (F1 0.8): zero is the honest optimum,
      // not a placeholder for "no signal".
      expect(bestF1Threshold([0, 0.5], [-0.5, -0.4])).to.equal(0);
    });

    it('Throws without examples of either class', () => {
      expect(() => bestF1Threshold([], [0.2])).to.throw(/at least one positive/);
      expect(() => bestF1Threshold([0.2], [])).to.throw(/at least one negative/);
    });

    it('Returns a usable cut for a single positive against several negatives', () => {
      const threshold = bestF1Threshold([0.3], [0.1, 0.2, 0.4]);
      expect(threshold).to.equal(0.3);
      expect(threshold).to.be.at.least(0);
      expect(threshold).to.be.at.most(0.4);
    });

    it('Treats duplicate scores as one candidate', () => {
      // Same distributions with duplicated entries must search the same
      // candidate set rather than double-weighting a score.
      expect(bestF1Threshold([0.8, 0.8], [0.2, 0.2])).to.equal(bestF1Threshold([0.8], [0.2]));
    });
  });
});

describe('prompt building', () => {
  it('Builds the tag name, the photo prompt, then each description in order', () => {
    const table = buildPromptTable(['cat'], () => ['ginger cat', 'cat on a mat']);
    expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat', 'ginger cat', 'cat on a mat']);
  });

  it('Uses only the two default prompts when a tag has no descriptions entry', () => {
    const table = buildPromptTable(['cat'], () => undefined);
    expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat']);
  });

  it('Uses only the two default prompts for an empty descriptions array', () => {
    const table = buildPromptTable(['cat'], () => []);
    expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat']);
  });

  it('Skips blank descriptions without changing the other prompt rows', () => {
    const table = buildPromptTable(['cat'], () => ['', '   ', 'ginger cat']);
    expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat', 'ginger cat']);
  });

  it('Does not warn about a whitespace-only description over the length threshold', () => {
    const whitespace = ' '.repeat(61);
    const warnings = captureWarnings(() => {
      const table = buildPromptTable(['cat'], () => [whitespace]);
      expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat']);
    });
    expect(warnings).to.have.lengthOf(0);
  });

  it('Keeps a description over the warning length instead of dropping it', () => {
    const long = 'x'.repeat(61);
    const warnings = captureWarnings(() => {
      const table = buildPromptTable(['cat'], () => [long]);
      expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat', long]);
    });
    expect(warnings).to.have.lengthOf(1);
    expect(warnings[0]).to.match(/longer than 60 characters/);
  });

  it('Preserves tag order and grouping', () => {
    const table = buildPromptTable(['cat', 'dog'], (tag) => (tag === 'cat' ? ['ginger cat'] : undefined));
    expect(table.map((entry) => entry.tag)).to.deep.equal(['cat', 'dog']);
    expect(table[0].prompts).to.deep.equal(['cat', 'a photo of cat', 'ginger cat']);
    expect(table[1].prompts).to.deep.equal(['dog', 'a photo of dog']);
  });
});

describe('tag scoring', () => {
  // Two prompts for 'a', one for 'b': the row positions and the multi-prompt
  // maximum are both observable from the hand-built rows.
  const TABLE = [
    { tag: 'a', prompts: ['a', 'a photo of a'] },
    { tag: 'b', prompts: ['b'] },
  ];
  const TEXT_ROWS = [Float32Array.from([1, 0]), Float32Array.from([0.6, 0.8]), Float32Array.from([0, 1])];

  it('Scores a tag as the maximum across its prompt rows', () => {
    const scoreTag = makeTagScorer(TABLE, TEXT_ROWS);
    expect(scoreTag(Float32Array.from([1, 0]), 'a')).to.be.closeTo(1, 1e-6);
    expect(scoreTag(Float32Array.from([0, 1]), 'b')).to.be.closeTo(1, 1e-6);
    // [0.6, 0.8] scores 0.6 against 'a' and 1 against 'a photo of a', so the
    // second prompt must win.
    expect(scoreTag(Float32Array.from([0.6, 0.8]), 'a')).to.be.closeTo(1, 1e-6);
  });

  it('Reads each tag from its own row offset', () => {
    const scoreTag = makeTagScorer(TABLE, TEXT_ROWS);
    // 'b' is the third row, so it must not read either of 'a''s rows.
    expect(scoreTag(Float32Array.from([1, 0]), 'b')).to.be.closeTo(0, 1e-6);
    expect(scoreTag(Float32Array.from([0, 1]), 'a')).to.be.closeTo(0.8, 1e-6);
  });

  it('Throws for a tag missing from the prompt table', () => {
    const scoreTag = makeTagScorer(TABLE, TEXT_ROWS);
    expect(() => scoreTag(Float32Array.from([1, 0]), 'missing')).to.throw(/not in the prompt table/);
  });

  it('Throws when image and prompt row widths differ', () => {
    const scoreTag = makeTagScorer(TABLE, TEXT_ROWS);
    expect(() => scoreTag(Float32Array.from([1, 0, 0]), 'a')).to.throw(/dims/);
  });
});

/** Runs `run` with console.warn captured, returning the warning messages. */
function captureWarnings(run: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...data: unknown[]): void => {
    warnings.push(data.map((value) => String(value)).join(' '));
  };
  try {
    run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

// The embedding cache resolves its directory through Config, which the mocha
// environment sets up from CACHE_PATH (run-tests.sh); without it a standalone
// single-file run cannot resolve a writable artifact path, so skip the block
// rather than fail on the environment.
function describeCache(title: string, fn: () => void): void {
  if (process.env['CACHE_PATH'] === undefined) {
    describe.skip(title, fn);
    return;
  }
  describe(title, fn);
}

describeCache('embedding cache', () => {
  const HASHES = ['hash-a', 'hash-b', 'hash-c'];
  const ROWS = [Float32Array.from([1, 0, 0, 0]), Float32Array.from([0, 1, 0, 0]), Float32Array.from([1, 1, 0, 0])];

  beforeEach(() => {
    FS.rmSync(packDir(TEST_PACK), { recursive: true, force: true });
  });

  after(() => {
    FS.rmSync(packDir(TEST_PACK), { recursive: true, force: true });
  });

  it('Computes a stable fingerprint across calls', () => {
    expect(computeFingerprint(TEST_PACK, 'ort')).to.equal(computeFingerprint(TEST_PACK, 'ort'));
  });

  it('Changes the fingerprint when a pack file hash changes', () => {
    const altered: EmbeddingPackDefinition = {
      ...TEST_PACK,
      files: [TEST_PACK.files[0], { ...TEST_PACK.files[1], sha256: 'c'.repeat(64) }],
    };
    expect(computeFingerprint(altered, 'ort')).to.not.equal(computeFingerprint(TEST_PACK, 'ort'));
  });

  it('Changes the fingerprint when preprocessing changes', () => {
    const altered: EmbeddingPackDefinition = {
      ...TEST_PACK,
      preprocess: { ...TEST_PACK.preprocess, cropSize: 8 },
    };
    expect(computeFingerprint(altered, 'ort')).to.not.equal(computeFingerprint(TEST_PACK, 'ort'));
  });

  it('Separates fake-encoder rows from real ones', () => {
    // The TEST_MODE fake produces pseudo-random placeholders, so a fake run's
    // cache can never satisfy a real run's fingerprint.
    expect(computeFingerprint(TEST_PACK, 'fake')).to.not.equal(computeFingerprint(TEST_PACK, 'ort'));
  });

  it('Round-trips hashes and rows through save and load', async () => {
    const fingerprint = computeFingerprint(TEST_PACK, 'ort');
    await saveEmbeddingCache(TEST_PACK, fingerprint, { hashes: HASHES, dims: TEST_PACK.dim, rows: ROWS });
    const loaded = await loadEmbeddingCache(TEST_PACK, fingerprint);
    expect(loaded).to.not.equal(undefined);
    if (!loaded) {
      throw new Error('Expected the saved embedding cache to load');
    }
    expect(loaded.hashes).to.deep.equal(HASHES);
    expect(loaded.dims).to.equal(TEST_PACK.dim);
    expect(Array.from(loaded.data)).to.deep.equal([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('Round-trips subarray views over one backing buffer', async () => {
    // Mirrors embedStills's real save: every row is a view into the single
    // joined matrix, not an independent array.
    const backing = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]);
    const rows = [backing.subarray(0, 4), backing.subarray(4, 8), backing.subarray(8, 12)];
    const fingerprint = computeFingerprint(TEST_PACK, 'ort');
    await saveEmbeddingCache(TEST_PACK, fingerprint, { hashes: HASHES, dims: TEST_PACK.dim, rows });
    const loaded = await loadEmbeddingCache(TEST_PACK, fingerprint);
    if (!loaded) {
      throw new Error('Expected the saved embedding cache to load');
    }
    expect(loaded.hashes).to.deep.equal(HASHES);
    for (const [index, row] of rows.entries()) {
      const stored = loaded.data.subarray(index * TEST_PACK.dim, (index + 1) * TEST_PACK.dim);
      expect(Buffer.from(stored.buffer, stored.byteOffset, stored.length * 4)).to.deep.equal(
        Buffer.from(row.buffer, row.byteOffset, row.length * 4),
      );
    }
  });

  it('Indexes each hash to its row', async () => {
    const fingerprint = computeFingerprint(TEST_PACK, 'ort');
    await saveEmbeddingCache(TEST_PACK, fingerprint, { hashes: HASHES, dims: TEST_PACK.dim, rows: ROWS });
    const loaded = await loadEmbeddingCache(TEST_PACK, fingerprint);
    if (!loaded) {
      throw new Error('Expected the saved embedding cache to load');
    }
    const index = embeddingsIndex(loaded);
    expect([...index.entries()]).to.deep.equal([
      ['hash-a', 0],
      ['hash-b', 1],
      ['hash-c', 2],
    ]);
  });

  it('Rejects an artifact written by a different configuration', async () => {
    const fingerprint = computeFingerprint(TEST_PACK, 'ort');
    await saveEmbeddingCache(TEST_PACK, fingerprint, { hashes: HASHES, dims: TEST_PACK.dim, rows: ROWS });
    const err = await errorOf(() => loadEmbeddingCache(TEST_PACK, 'fingerprint-b'));
    expect(err.message).to.match(/fingerprint/);
  });

  it('Rejects a bin file shorter than its metadata claims', async () => {
    const fingerprint = computeFingerprint(TEST_PACK, 'ort');
    await saveEmbeddingCache(TEST_PACK, fingerprint, { hashes: HASHES, dims: TEST_PACK.dim, rows: ROWS });
    // The artefact contract's file names, rewritten shorter while the sidecar
    // keeps its original row count.
    FS.writeFileSync(Path.resolve(packDir(TEST_PACK), 'embeddings.bin'), Buffer.alloc(4));
    const err = await errorOf(() => loadEmbeddingCache(TEST_PACK, fingerprint));
    expect(err.message).to.match(/truncated/);
  });

  it('Rejects a row of the wrong width before writing any file', async () => {
    const err = await errorOf(() =>
      saveEmbeddingCache(TEST_PACK, computeFingerprint(TEST_PACK, 'ort'), {
        hashes: ['hash-a'],
        dims: TEST_PACK.dim,
        rows: [Float32Array.from([1, 0, 0])],
      }),
    );
    expect(err.message).to.match(/dims/);
    const partials = FS.readdirSync(packDir(TEST_PACK)).filter((name) => name.endsWith('.part'));
    expect(partials).to.deep.equal([]);
  });
});

describeCache('embedding cache pruning', () => {
  const FINGERPRINT = computeFingerprint(TEST_PACK, 'fake');
  const HASHES = ['hash-a', 'hash-b'];
  let imageDir = '';

  before(() => {
    imageDir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'vimtur-siglip-prune-'));
    // Content-addressed fake rows: identical bytes re-embed identically, which
    // is the property the cache's "already embedded" reuse relies on.
    FS.writeFileSync(Path.join(imageDir, 'a.jpg'), Buffer.from('first image bytes'));
    FS.writeFileSync(Path.join(imageDir, 'b.jpg'), Buffer.from('second image bytes'));
    FS.writeFileSync(Path.join(imageDir, 'c.jpg'), Buffer.from('third image bytes'));
  });

  beforeEach(() => {
    FS.rmSync(packDir(TEST_PACK), { recursive: true, force: true });
  });

  after(() => {
    FS.rmSync(packDir(TEST_PACK), { recursive: true, force: true });
    FS.rmSync(imageDir, { recursive: true, force: true });
  });

  /** Seeds the pack cache through the fake encoder, exactly like a real run. */
  async function seedCache(hashes: string[], files: string[]): Promise<Float32Array[]> {
    const rows = await new FakeEncoderPool(TEST_PACK.dim).encodeImages(
      TEST_PACK,
      files.map((file) => Path.join(imageDir, file)),
    );
    await saveEmbeddingCache(TEST_PACK, FINGERPRINT, { hashes, dims: TEST_PACK.dim, rows });
    return rows;
  }

  it('Drops a deleted hash from the index and keeps the surviving row', async () => {
    const [, second] = await seedCache(HASHES, ['a.jpg', 'b.jpg']);
    const before = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
    if (!before) {
      throw new Error('Expected the seeded embedding cache to load');
    }

    await removeCachedEmbeddings([HASHES[0]]);

    // Index only: the hash is gone and the survivor keeps its physical row.
    const meta = readCacheMeta();
    expect(meta.hashes).to.deep.equal([HASHES[1]]);
    expect(meta.rows).to.deep.equal([1]);
    // The bin is untouched, garbage row included; the loader tolerates it.
    expect(FS.statSync(Path.resolve(packDir(TEST_PACK), 'embeddings.bin')).size).to.equal(TEST_PACK.dim * 4 * 2);
    const pruned = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
    if (!pruned) {
      throw new Error('Expected the pruned embedding cache to load');
    }
    expect(pruned.hashes).to.deep.equal([HASHES[1]]);
    expect(Array.from(pruned.data)).to.deep.equal(Array.from(second));
    // This is what makes embedStills re-embed the deleted hash: it is no
    // longer in the index it builds from the loaded cache.
    expect(embeddingsIndex(pruned).has(HASHES[0])).to.equal(false);
    expect(embeddingsIndex(pruned).get(HASHES[1])).to.equal(0);

    // A later run with the same hashes plus a new one reuses the survivor and
    // embeds the misses; the save rewrites the bin identically-numbered.
    const [third] = await new FakeEncoderPool(TEST_PACK.dim).encodeImages(TEST_PACK, [Path.join(imageDir, 'c.jpg')]);
    await saveEmbeddingCache(TEST_PACK, FINGERPRINT, {
      hashes: [...pruned.hashes, 'hash-c'],
      dims: TEST_PACK.dim,
      rows: [Float32Array.from(pruned.data), third],
    });
    const refreshed = readCacheMeta();
    expect(refreshed.hashes).to.deep.equal([HASHES[1], 'hash-c']);
    expect(refreshed.rows).to.deep.equal([0, 1]);
    const reloaded = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
    if (!reloaded) {
      throw new Error('Expected the refreshed embedding cache to load');
    }
    // The survivor's values survived the rewrite unchanged, and the deleted
    // hash was not resurrected from its garbage row.
    expect(Array.from(reloaded.data.subarray(0, TEST_PACK.dim))).to.deep.equal(Array.from(second));
    expect(Array.from(reloaded.data.subarray(TEST_PACK.dim))).to.deep.equal(Array.from(third));
    expect(reloaded.hashes).to.not.include(HASHES[0]);
  });

  it('Reads and prunes a legacy index written without a row list', async () => {
    // The pre-row-index format: positional rows, json with no `rows` field.
    const rows = await new FakeEncoderPool(TEST_PACK.dim).encodeImages(TEST_PACK, [
      Path.join(imageDir, 'a.jpg'),
      Path.join(imageDir, 'b.jpg'),
    ]);
    FS.mkdirSync(packDir(TEST_PACK), { recursive: true });
    FS.writeFileSync(
      Path.resolve(packDir(TEST_PACK), 'embeddings.bin'),
      Buffer.concat(rows.map((row) => Buffer.from(row.buffer, row.byteOffset, row.length * 4))),
    );
    writeCacheMeta({ hashes: [...HASHES], dims: TEST_PACK.dim, fingerprint: FINGERPRINT });

    const legacy = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
    if (!legacy) {
      throw new Error('Expected the legacy embedding cache to load');
    }
    expect(Array.from(legacy.data)).to.deep.equal([...rows[0], ...rows[1]]);

    await removeCachedEmbeddings([HASHES[0]]);

    // The legacy index is upgraded in place: identity rows synthesised, then
    // compacted to the surviving positions.
    const meta = readCacheMeta();
    expect(meta.hashes).to.deep.equal([HASHES[1]]);
    expect(meta.rows).to.deep.equal([1]);
    const pruned = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
    if (!pruned) {
      throw new Error('Expected the pruned legacy cache to load');
    }
    expect(Array.from(pruned.data)).to.deep.equal(Array.from(rows[1]));
  });

  it('Tolerates unreachable tail rows but rejects an unaddressable listed row', async () => {
    await seedCache(HASHES, ['a.jpg', 'b.jpg']);
    const binPath = Path.resolve(packDir(TEST_PACK), 'embeddings.bin');
    // Garbage appended past the last listed row is what a delete leaves behind.
    FS.appendFileSync(binPath, Buffer.alloc(4));
    const padded = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
    if (!padded) {
      throw new Error('Expected the padded embedding cache to load');
    }
    expect(padded.hashes).to.deep.equal(HASHES);

    // A listed row past the end of the bin is real truncation and must throw.
    writeCacheMeta({ hashes: [...HASHES], dims: TEST_PACK.dim, fingerprint: FINGERPRINT, rows: [0, 99] });
    const err = await errorOf(() => loadEmbeddingCache(TEST_PACK, FINGERPRINT));
    expect(err.message).to.match(/truncated/);
  });

  it('Applies concurrent removals without losing either hash', async () => {
    // Media deletion runs in parallel, so both prunes touch the same index.
    await seedCache(HASHES, ['a.jpg', 'b.jpg']);
    await Promise.all([removeCachedEmbeddings([HASHES[0]]), removeCachedEmbeddings([HASHES[1]])]);
    const meta = readCacheMeta();
    expect(meta.hashes).to.deep.equal([]);
    expect(meta.rows).to.deep.equal([]);
  });

  it('Keeps prune and save ordering safe in either enqueue order', async () => {
    const rowA = Float32Array.from([1, 0, 0, 0]);
    const rowB = Float32Array.from([0, 1, 0, 0]);
    const rowC = Float32Array.from([0, 0, 1, 0]);
    for (const pruneFirst of [false, true]) {
      FS.rmSync(packDir(TEST_PACK), { recursive: true, force: true });
      // Seed three rows, then drop the middle one: the surviving index is
      // non-identity (a -> row 0, c -> row 2), so a prune computed from the
      // pre-save row list would misaddress the survivors once a save
      // renumbered them.
      await saveEmbeddingCache(TEST_PACK, FINGERPRINT, {
        hashes: ['hash-a', 'hash-b', 'hash-c'],
        dims: TEST_PACK.dim,
        rows: [rowA, rowB, rowC],
      });
      await removeCachedEmbeddings(['hash-b']);
      const cached = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
      if (!cached) {
        throw new Error('Expected the seeded embedding cache to load');
      }
      expect(cached.hashes).to.deep.equal(['hash-a', 'hash-c']);

      // The save has embedStills' shape (cached rows followed by a new hash)
      // and races a removal of hash-c. Enqueue order is creation order (the
      // queue chains onto the tail synchronously), so the calls are made
      // inside the branch: the cache-mutation queue must serialise the
      // read-modify-writes so the save's rows land correctly whether the
      // prune or the save goes first.
      const prune = () => removeCachedEmbeddings(['hash-c']);
      const save = () =>
        saveEmbeddingCache(TEST_PACK, FINGERPRINT, {
          hashes: ['hash-a', 'hash-b'],
          dims: TEST_PACK.dim,
          rows: [Float32Array.from(cached.data.subarray(0, TEST_PACK.dim)), rowB],
        });
      await (pruneFirst ? Promise.all([prune(), save()]) : Promise.all([save(), prune()]));

      const order = pruneFirst ? 'prune-first' : 'save-first';
      const after = await loadEmbeddingCache(TEST_PACK, FINGERPRINT);
      if (!after) {
        throw new Error(`Expected the embedding cache to load (${order})`);
      }
      expect(after.hashes, `hashes (${order})`).to.deep.equal(['hash-a', 'hash-b']);
      expect(Array.from(after.data.subarray(0, TEST_PACK.dim)), `hash-a row (${order})`).to.deep.equal([...rowA]);
      expect(Array.from(after.data.subarray(TEST_PACK.dim)), `hash-b row (${order})`).to.deep.equal([...rowB]);
      expect(embeddingsIndex(after).has('hash-c'), `hash-c gone (${order})`).to.equal(false);
    }
  });

  it('Skips a malformed row list and leaves the index untouched', async () => {
    await seedCache(HASHES, ['a.jpg', 'b.jpg']);
    // Neither shape may be rewritten by a prune: the artifact stays the loud
    // load-time failure it already is, rather than becoming a plausible index
    // whose rows the next load cannot address.
    for (const rows of [[0], [0, 1.5]]) {
      writeCacheMeta({ hashes: [...HASHES], dims: TEST_PACK.dim, fingerprint: FINGERPRINT, rows });
      const corrupt = FS.readFileSync(metaPath(), 'utf8');
      await removeCachedEmbeddings([HASHES[0]]);
      expect(FS.readFileSync(metaPath(), 'utf8'), `rows ${JSON.stringify(rows)}`).to.equal(corrupt);
    }
  });

  it('Leaves the index untouched when none of the hashes are listed', async () => {
    await seedCache(HASHES, ['a.jpg', 'b.jpg']);
    const metaPath = Path.resolve(packDir(TEST_PACK), 'embeddings.json');
    const before = FS.readFileSync(metaPath, 'utf8');
    await removeCachedEmbeddings(['hash-never-embedded']);
    expect(FS.readFileSync(metaPath, 'utf8')).to.equal(before);
  });

  function metaPath(): string {
    return Path.resolve(packDir(TEST_PACK), 'embeddings.json');
  }

  function readCacheMeta(): { hashes: string[]; dims: number; fingerprint: string; rows?: number[] } {
    return JSON.parse(FS.readFileSync(metaPath(), 'utf8')) as {
      hashes: string[];
      dims: number;
      fingerprint: string;
      rows?: number[];
    };
  }

  function writeCacheMeta(meta: { hashes: string[]; dims: number; fingerprint: string; rows?: number[] }): void {
    FS.writeFileSync(metaPath(), JSON.stringify(meta));
  }
});

/** Awaits `run` and returns the error it threw. */
async function errorOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (err: unknown) {
    return err instanceof Error ? err : new Error(String(err));
  }
  throw new Error('Expected the call to throw');
}

describe('deterministic fake encoder', () => {
  let imageDir = '';

  before(() => {
    imageDir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'vimtur-siglip-'));
    FS.writeFileSync(Path.join(imageDir, 'same.jpg'), Buffer.from('first image bytes'));
    FS.writeFileSync(Path.join(imageDir, 'other.jpg'), Buffer.from('different image bytes'));
  });

  after(() => {
    FS.rmSync(imageDir, { recursive: true, force: true });
  });

  it('Encodes the same prompt to identical vectors', async () => {
    const pool = new FakeEncoderPool(TEST_PACK.dim);
    const [first, second] = await pool.encodeTexts(TEST_PACK, ['a cat', 'a cat']);
    expect(Array.from(first)).to.deep.equal(Array.from(second));
  });

  it('Encodes different prompts to different vectors', async () => {
    const pool = new FakeEncoderPool(TEST_PACK.dim);
    const [first, second] = await pool.encodeTexts(TEST_PACK, ['a cat', 'a dog']);
    expect(Array.from(first).some((value, index) => value !== second[index])).to.equal(true);
  });

  it('Emits unit-norm text vectors', async () => {
    const pool = new FakeEncoderPool(TEST_PACK.dim);
    const rows = await pool.encodeTexts(TEST_PACK, ['a cat', 'a dog']);
    for (const row of rows) {
      expect(norm(row)).to.be.closeTo(1, 1e-6);
    }
  });

  it('Encodes identical image bytes identically and different bytes differently', async () => {
    const pool = new FakeEncoderPool(TEST_PACK.dim);
    const samePath = Path.join(imageDir, 'same.jpg');
    const otherPath = Path.join(imageDir, 'other.jpg');
    const [first, second] = await pool.encodeImages(TEST_PACK, [samePath, samePath]);
    expect(Array.from(first)).to.deep.equal(Array.from(second));
    const [different] = await pool.encodeImages(TEST_PACK, [otherPath]);
    expect(Array.from(first).some((value, index) => value !== different[index])).to.equal(true);
    expect(norm(first)).to.be.closeTo(1, 1e-6);
    expect(norm(different)).to.be.closeTo(1, 1e-6);
  });
});

/** Euclidean length, for the fake encoder's normalisation guarantee. */
function norm(row: Float32Array): number {
  let total = 0;
  for (const value of row) {
    total += value * value;
  }
  return Math.sqrt(total);
}

describe('vector normalisation', () => {
  it('Returns a zero vector unchanged and finite', () => {
    const row = Float32Array.from([0, 0, 0]);
    expect(Array.from(l2NormaliseRow(row))).to.deep.equal([0, 0, 0]);
    expect(Array.from(row).every((value) => Number.isFinite(value))).to.equal(true);
  });

  it('Leaves an already unit-length vector unchanged', () => {
    const row = Float32Array.from([1, 0, 0]);
    expect(Array.from(l2NormaliseRow(row))).to.deep.equal([1, 0, 0]);
  });

  it('Scales an arbitrary row to unit length in place', () => {
    const row = Float32Array.from([3, 4, 0]);
    const normalised = l2NormaliseRow(row);
    expect(normalised).to.equal(row);
    // 3/5 and 4/5 are stored as float32, so compare with a float epsilon.
    expect(normalised[0]).to.be.closeTo(0.6, 1e-6);
    expect(normalised[1]).to.be.closeTo(0.8, 1e-6);
    expect(normalised[2]).to.equal(0);
    expect(norm(normalised)).to.be.closeTo(1, 1e-6);
  });
});

describe('tag state derivation', () => {
  const RUN: Autotag.CalibrationRun = {
    date: 0,
    modelId: 'TEST-PACK',
    minSupport: 8,
    sampleSize: 100,
    perTag: {
      alpha: { threshold: 0.5, support: 10, quality: 0.9, emitted: true },
      beta: { threshold: 0.3, support: 2, quality: 0.6, emitted: false },
    },
  };

  it('Reports Not calibrated with no config and no run', () => {
    const state = deriveTagState('alpha', undefined, undefined, 8);
    expect(state.status).to.equal('Not calibrated');
    expect(state.threshold).to.equal(undefined);
  });

  it('Applies a calibrated threshold above the support floor', () => {
    expect(deriveTagState('alpha', undefined, RUN, 8)).to.deep.equal({ status: 'Calibrated', threshold: 0.5 });
  });

  it('Records a below-floor calibration for review without a threshold', () => {
    const state = deriveTagState('beta', undefined, RUN, 8);
    expect(state.status).to.equal('Review (low support)');
    // A threshold exists but must never be emitted from the review state.
    expect(state.threshold).to.equal(undefined);
  });

  it('Lets a manual override beat the calibration', () => {
    const configTag: Configuration.AutoTagMetadata = { manualThreshold: 0.2 };
    expect(deriveTagState('alpha', configTag, RUN, 8)).to.deep.equal({
      status: 'Manually overridden',
      threshold: 0.2,
    });
  });

  it('Treats a manual threshold of zero as a real override', () => {
    // Zero is a meaningful cosine cut, so the typeof guard must not mistake
    // it for "no override" the way a truthiness check would.
    const configTag: Configuration.AutoTagMetadata = { manualThreshold: 0 };
    expect(deriveTagState('alpha', configTag, RUN, 8)).to.deep.equal({
      status: 'Manually overridden',
      threshold: 0,
    });
  });

  it('Falls through to calibration when the override is explicitly cleared', () => {
    const configTag: Configuration.AutoTagMetadata = { manualThreshold: null };
    expect(deriveTagState('alpha', configTag, RUN, 8)).to.deep.equal({ status: 'Calibrated', threshold: 0.5 });
  });

  it('Uses the caller-supplied support floor', () => {
    expect(deriveTagState('beta', undefined, RUN, 2)).to.deep.equal({ status: 'Calibrated', threshold: 0.3 });
  });
});

describe('scored tag roster', () => {
  function settingsWithTags(tags: Record<string, Configuration.AutoTagMetadata>): AutotagSettings {
    return { model: 'AUTO-TAG-AVES-SIGLIP2-B32', workers: 1, minSupport: 8, calibrationSampleSize: 500, tags };
  }

  it('Returns only DB tags that carry a config entry', () => {
    // The config entry is the user's opt-in, so an unconfigured library tag is
    // never scored.
    const settings = settingsWithTags({ alpha: {}, gamma: { manualThreshold: 0 } });
    expect(configuredTags(['alpha', 'beta', 'gamma'], settings)).to.deep.equal(['alpha', 'gamma']);
  });

  it('Keeps a configured tag with no descriptions, using the synthetic prompts', () => {
    // Presence, not content, is the gate: an empty entry still builds the two
    // default prompts, which is why "no prompts found" is now only reachable
    // for tags that were never configured.
    const settings = settingsWithTags({ alpha: {} });
    const roster = configuredTags(['alpha'], settings);
    expect(roster).to.deep.equal(['alpha']);
    const table = buildPromptTable(roster, (tag) => settings.tags[tag]?.descriptions);
    expect(table[0].prompts).to.deep.equal(['alpha', 'a photo of alpha']);
  });

  it('Ignores config entries whose DB tag no longer exists', () => {
    // The calibration purge removes these, but a stale entry must not be
    // scored in the window before the next calibration runs.
    const settings = settingsWithTags({ alpha: {}, deleted: { manualThreshold: 0 } });
    expect(configuredTags(['alpha'], settings)).to.deep.equal(['alpha']);
  });

  it('Returns the roster sorted for stable prompt-table positions', () => {
    // sqlite's getTags is unordered; the prompt table's row offsets must not
    // move between runs.
    const settings = settingsWithTags({ zulu: {}, alpha: {}, mike: {} });
    expect(configuredTags(['zulu', 'alpha', 'mike'], settings)).to.deep.equal(['alpha', 'mike', 'zulu']);
  });
});

describe('import task selection', () => {
  const SIGLIP_TASK_ID = 'AUTO-TAG-AVES-SIGLIP2-B32';

  it('Starts the zero-shot task when a tag is applicable', () => {
    expect(pickImportTask(SIGLIP_TASK_ID, true)).to.deep.equal({ action: 'start', taskId: SIGLIP_TASK_ID });
  });

  it('Skips the zero-shot task when no tag is applicable rather than failing the import', () => {
    // The zero-shot task fail-fasts without an applicable threshold, which
    // would make an uncalibrated server error on every import.
    expect(pickImportTask(SIGLIP_TASK_ID, false)).to.deep.equal({ action: 'skip-siglip' });
  });

  it('Starts a known classifier task regardless of threshold applicability', () => {
    // The classifier registry in ../tasks/autotag/mobilenet/models.ts owns the
    // AUTO-TAG-<registry id> task ids, so a listed id starts as itself.
    expect(pickImportTask('AUTO-TAG-MOBILE-NET-V2', true)).to.deep.equal({
      action: 'start',
      taskId: 'AUTO-TAG-MOBILE-NET-V2',
    });
    expect(pickImportTask('AUTO-TAG-MOBILE-NET-V2', false)).to.deep.equal({
      action: 'start',
      taskId: 'AUTO-TAG-MOBILE-NET-V2',
    });
  });

  it('Reports an unknown model instead of starting a task', () => {
    // The config schema only enforces that the value is a string, so stale or
    // hand-edited values reach this decision and must fail closed.
    expect(pickImportTask('not-a-task', true)).to.deep.equal({ action: 'unknown-model' });
  });

  it('Treats a hyphenated but unregistered id as unknown rather than by its prefix', () => {
    // Registry ids are hyphenated (MOBILE-NET-V2), so a prefix strip alone
    // would accept any AUTO-TAG-<anything>; this pins the AUTO_TAG_MODELS
    // membership check.
    expect(pickImportTask('AUTO-TAG-NOT-A-MODEL', true)).to.deep.equal({ action: 'unknown-model' });
  });
});

describe('clear-tagged-autotags task', () => {
  it('clears auto tags of every media item that holds an auto-tags list and completes without items', async () => {
    const calls: Array<{ constraints: SubsetConstraints; update: UpdateMedia }> = [];
    // Only the bulk method is exercised: the task is a thin pass-through, and
    // the NULL-vs-[] distinction is pinned at the database layer.
    const database = {
      saveBulkMedia: (constraints: SubsetConstraints, update: UpdateMedia): Promise<number> => {
        calls.push({ constraints, update });
        return Promise.resolve(2);
      },
    } as unknown as Parameters<typeof getClearTaggedAutotagsTask>[0];

    const task = getClearTaggedAutotagsTask(database);
    expect(task.id).to.equal('CLEAR-TAGGED-AUTOTAGS');
    expect(task.description).to.equal('Auto-Tag - Remove auto-generated tags from media');

    const result = await task.runner(() => undefined);
    expect(result.errors).to.deep.equal([]);
    expect(result.results).to.deep.equal([]);
    // The work set is "media with an auto-tags list" (no manual-tags gate), and
    // the update clears them to null, never [] (the pipeline's processed marker).
    expect(calls).to.deep.equal([{ constraints: { autoTags: { exists: true } }, update: { autoTags: null } }]);
  });
});
