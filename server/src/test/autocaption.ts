import FS from 'node:fs';
import OS from 'node:os';
import Path from 'node:path';

import { expect } from 'chai';
import { after, before, describe, it } from 'mocha';
import Sharp from 'sharp';

import { ensureCaptionerPool, FakeCaptionerPool } from '../tasks/autocaption/captioner';
import { decodeGreedy } from '../tasks/autocaption/decode';
import type { LogitsRunner, LogitsTensor } from '../tasks/autocaption/decode';
import { loadVocab, WordPieceDetokenizer } from '../tasks/autocaption/detokenizer';
import { AUTO_CAPTION_TASK_ID, BLIP_BASE, CAPTION_PACKS, isPackCached, packDir } from '../tasks/autocaption/pack';
import { preprocessCaptionImage } from '../tasks/autocaption/preprocess';
import type { CaptionPreprocess } from '../tasks/autocaption/preprocess';
import { pickCaptionTask } from '../tasks/autocaption/settings';

// Unit tests for the Auto-Captioning primitives. The detokeniser and greedy
// loop are pure, and the pool boundary is covered by the deterministic fake, so
// the pipeline's behaviour can be pinned without downloading a pack.

// Specials first so every other entry's id is obvious; '##ing' and "'s" pin the
// two WordPiece join shapes (continuation pieces and contractions).
const VOCAB = ['[PAD]', 'hello', 'world', ',', '##ing', '.', '[CLS]', '[SEP]', '[UNK]', '[MASK]', "'s", 'it'];
const DETOKENIZER = WordPieceDetokenizer.fromVocabText(`${VOCAB.join('\n')}\n`);

describe('WordPiece detokeniser', () => {
  it('Drops a trailing empty vocab line', () => {
    expect(loadVocab('a\nb\n')).to.deep.equal(['a', 'b']);
  });

  it('Joins continuation pieces without a space', () => {
    expect(DETOKENIZER.decode([1, 2, 4])).to.equal('hello worlding');
  });

  it('Cleans up punctuation and contraction spacing', () => {
    expect(DETOKENIZER.decode([1, 3, 2, 5])).to.equal('hello, world.');
    expect(DETOKENIZER.decode([11, 10])).to.equal("it's");
  });

  it('Skips the in-vocabulary special tokens', () => {
    expect(DETOKENIZER.decode([6, 1, 7])).to.equal('hello');
    expect(DETOKENIZER.decode([0, 6, 8, 9, 7])).to.equal('');
  });

  it('Skips an added special that has no vocabulary entry', () => {
    // BLIP's decoder starts on 30522 ([BOS], bert-base vocab + 2), which is
    // outside the exported vocab; the halt must not fail on it.
    expect(DETOKENIZER.decode([30522])).to.equal('');
  });

  it('Returns an empty string for no ids', () => {
    expect(DETOKENIZER.decode([])).to.equal('');
  });

  it('Rejects a negative or fractional id', () => {
    expect(() => DETOKENIZER.decode([-1])).to.throw(/non-negative integers/);
    expect(() => DETOKENIZER.decode([1.5])).to.throw(/non-negative integers/);
  });
});

describe('greedy decoding', () => {
  /** A one-row logits tensor whose only positive value is `token`. */
  function picks(vocabSize: number, token: number): LogitsTensor {
    const data = new Array<number>(vocabSize).fill(-1);
    data[token] = 1;
    return { data, dims: [1, 1, vocabSize] };
  }

  /**
   * Answers successive decoder calls from `tensors` in order and records the
   * prefixes it was asked for. Running out of replies fails the test: a loop
   * that should have stopped must not silently reuse the last tensor.
   */
  function queuedRunner(tensors: LogitsTensor[]): { run: LogitsRunner; calls: number[][] } {
    const calls: number[][] = [];
    return {
      calls,
      run: (ids) => {
        calls.push([...ids]);
        const tensor = tensors[calls.length - 1];
        if (!tensor) {
          throw new Error(`Unexpected decoder call ${calls.length}`);
        }
        return Promise.resolve(tensor);
      },
    };
  }

  it('Stops on the first end id', async () => {
    const runner = queuedRunner([picks(5, 2), picks(5, 4)]);
    const ids = await decodeGreedy(runner.run, { startTokenId: 1, endTokenIds: [2], maxNewTokens: 5 });
    expect(ids).to.deep.equal([1, 2]);
    // The second reply must never be consumed.
    expect(runner.calls).to.deep.equal([[1]]);
  });

  it('Stops after maxNewTokens when no end id is emitted', async () => {
    const runner = queuedRunner([picks(5, 4), picks(5, 4), picks(5, 4), picks(5, 4)]);
    const ids = await decodeGreedy(runner.run, { startTokenId: 1, endTokenIds: [2], maxNewTokens: 3 });
    expect(ids).to.deep.equal([1, 4, 4, 4]);
    expect(runner.calls).to.have.lengthOf(3);
  });

  it('Reads the next token from the last logits row, not the prefix-length row', async () => {
    // GIT-family decoders prepend one row per image token, so a [1, 4, 3]
    // tensor over a one-token prefix has 3 extra rows. Earlier rows favour 0;
    // only the last row favours the end token 2, so a row-offset bug either
    // picks 0 or overruns the queued replies.
    const rows = 4;
    const vocabSize = 3;
    const data = new Array<number>(rows * vocabSize).fill(-1);
    for (let row = 0; row < rows - 1; row++) {
      data[row * vocabSize] = 1;
    }
    data[(rows - 1) * vocabSize + 2] = 1;
    const ids = await decodeGreedy(queuedRunner([{ data, dims: [1, rows, vocabSize] }]).run, {
      startTokenId: 1,
      endTokenIds: [2],
      maxNewTokens: 5,
    });
    expect(ids).to.deep.equal([1, 2]);
  });

  it('Rejects a tensor that is not rank 3', async () => {
    const runner = queuedRunner([{ data: [0, 1], dims: [1, 2] }]);
    const err = await errorOf(() => decodeGreedy(runner.run, { startTokenId: 1, endTokenIds: [2], maxNewTokens: 1 }));
    expect(err.message).to.match(/2 dims .*expected 3/);
  });

  it('Rejects a tensor whose data disagrees with its dims', async () => {
    const runner = queuedRunner([{ data: [0, 1, 2, 3, 4], dims: [1, 2, 3] }]);
    const err = await errorOf(() => decodeGreedy(runner.run, { startTokenId: 1, endTokenIds: [2], maxNewTokens: 1 }));
    expect(err.message).to.match(/5 values, expected 6/);
  });
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

describe('caption pack registry', () => {
  it('Describes every pack file completely', () => {
    for (const pack of CAPTION_PACKS) {
      expect(pack.files.length, `${pack.id} file count`).to.be.greaterThan(0);
      for (const file of pack.files) {
        expect(file.url, `${pack.id}/${file.name} url`).to.match(/^https:\/\//);
        expect(file.sha256, `${pack.id}/${file.name} sha256`).to.match(/^[0-9a-f]{64}$/);
        expect(file.size, `${pack.id}/${file.name} size`).to.be.greaterThan(0);
      }
      expect(pack.endTokenIds.length, `${pack.id} end token ids`).to.be.greaterThan(0);
    }
  });

  it('Uses unique pack ids', () => {
    expect(new Set(CAPTION_PACKS.map((pack) => pack.id)).size).to.equal(CAPTION_PACKS.length);
  });

  it('Pins the BLIP pack files to the verified upstream artifacts', () => {
    // The upstream repo names its files differently from our cache, so the
    // registry maps them by `name` (which decides every cache path) and pins
    // the verified sizes; an edit to either fails here before a download.
    const pack = CAPTION_PACKS.find((candidate) => candidate.id === 'BLIP-BASE');
    expect(pack, 'BLIP-BASE pack').to.not.equal(undefined);
    if (!pack) {
      throw new Error('Expected the BLIP-BASE pack to be registered');
    }
    expect(pack.files.map((file) => file.name)).to.deep.equal(['encoder.onnx', 'decoder.onnx', 'vocab.txt']);
    expect(pack.files.map((file) => file.size)).to.deep.equal([344_590_705, 645_815_945, 231_508]);
  });

  it('Derives the task id from the BLIP pack id', () => {
    expect(AUTO_CAPTION_TASK_ID).to.equal('AUTO-CAPTION-BLIP-BASE');
  });
});

describe('caption task selection', () => {
  it('Starts the registered pack task', () => {
    expect(pickCaptionTask(AUTO_CAPTION_TASK_ID)).to.deep.equal({ action: 'start', taskId: AUTO_CAPTION_TASK_ID });
  });

  it('Reports an unknown model rather than starting a task', () => {
    // The config schema only enforces a string, so stale or hand-edited values
    // reach this decision and must fail closed.
    expect(pickCaptionTask('AUTO-CAPTION-NOT-A-PACK')).to.deep.equal({ action: 'unknown-model' });
    expect(pickCaptionTask('not-a-task')).to.deep.equal({ action: 'unknown-model' });
  });
});

// Preprocessing lays planes out NCHW, as the shared autotag preprocessImage
// does. These packs use a no-op normalisation (mean 0, std 1), so the expected
// values read as raw colours; pixel values are 0 or 255 so the output is exact.
const UNNORMALISED: CaptionPreprocess = {
  imageSize: 8,
  resize: 'square',
  mean: [0, 0, 0],
  std: [1, 1, 1],
};

// RAW pixel input skips JPEG colour-space conversion entirely, so the
// assertions stay about the pipeline rather than about codec quirks.
function buildImage(
  width: number,
  height: number,
  color: (x: number, y: number) => [number, number, number],
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(x, y);
      const offset = (y * width + x) * 3;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }
  return Sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('Auto-caption preprocessing', () => {
  it('Stretches the source across the square input, plane-first (NCHW)', async () => {
    // 16x8 with the left half red and the right half green. 'square' uses
    // fit: 'fill', so the source is halved horizontally and left untouched
    // vertically: output columns 0-3 are red, 4-7 green.
    const png = await buildImage(16, 8, (x) => (x < 8 ? [255, 0, 0] : [0, 255, 0]));
    const output = await preprocessCaptionImage(png, UNNORMALISED);
    const size = UNNORMALISED.imageSize;
    const plane = size * size;

    expect(output).to.have.lengthOf(3 * plane);
    expect(output[0], 'red plane, top-left').to.be.closeTo(1, 1e-5);
    expect(output[plane], 'green plane, top-left').to.be.closeTo(0, 1e-5);
    expect(output[size - 1], 'red plane, top-right').to.be.closeTo(0, 1e-5);
    expect(output[plane + size - 1], 'green plane, top-right').to.be.closeTo(1, 1e-5);
    // 'fill' halves the 16px-wide source with a cubic kernel, so the red/green
    // boundary at source x=8 is blended across the two output columns either
    // side (0.933 and 0.067 red) instead of a hard edge. The bounds are strict
    // because that blend is the fill signature: 'cover' crops at an integer
    // pixel boundary and lands on 1 and 0 here, which these exclude.
    expect(output[3], 'red plane, blended boundary').to.be.above(0.5).and.below(1);
    expect(output[4], 'red plane, blended boundary').to.be.below(0.5).and.above(0);
    // The bottom row keeps the red left edge as well.
    expect(output[(size - 1) * size], 'red plane, bottom-left').to.be.closeTo(1, 1e-5);
  });

  it('Covers and centre-crops for shortest-edge packs', async () => {
    // The shorter side (8) already equals imageSize, so 'cover' only crops
    // horizontally: source x 4-11 survives, i.e. columns 0-3 red, 4-7 green.
    const png = await buildImage(16, 8, (x) => (x < 8 ? [255, 0, 0] : [0, 255, 0]));
    const output = await preprocessCaptionImage(png, { ...UNNORMALISED, resize: 'shortest-edge-crop' });
    const size = UNNORMALISED.imageSize;
    const plane = size * size;

    for (let x = 0; x < size; x++) {
      const red = x < size / 2 ? 255 : 0;
      const green = x < size / 2 ? 0 : 255;
      expect(output[x], `red plane, column ${x}`).to.be.closeTo(red / 255, 1e-5);
      expect(output[plane + x], `green plane, column ${x}`).to.be.closeTo(green / 255, 1e-5);
    }
  });

  it('Normalises channel planes around the declared mean and std', async () => {
    // (255 / 255 - 0.5) / 0.5 = 1.0 per plane; Float32 output, so the
    // comparisons carry the sibling test's relative epsilon.
    const png = await buildImage(4, 4, () => [255, 255, 255]);
    const output = await preprocessCaptionImage(png, {
      imageSize: 4,
      resize: 'square',
      mean: [0.5, 0.5, 0.5],
      std: [0.5, 0.5, 0.5],
    });
    const plane = 4 * 4;

    expect(output).to.have.lengthOf(3 * plane);
    for (let c = 0; c < 3; c++) {
      for (let index = 0; index < plane; index++) {
        expect(output[c * plane + index], `plane ${c} pixel ${index}`).to.be.closeTo(1, 1e-5);
      }
    }
  });

  it('Handles stored images whose EXIF orientation transposes width and height', async () => {
    // Bundled fixture: a 100x50 stored JPEG carrying orientation 6, so its
    // display is 50x100. Repro source (MIT): test_6.jpg from
    // https://github.com/rasteiner/exif-orientation-test-images. imageSize is
    // the display's shorter side, and 'square' stretches the display to a
    // square, so the reference is the display put through the same stretch.
    // Sampling the whole field (not just the centre) discriminates between the
    // rotated and stored geometries; those pixels differ almost everywhere.
    const imageSize = 50;
    const fixture = FS.readFileSync(Path.resolve(__dirname, 'fixtures', 'exif-orientation-6.jpg'));
    const output = await preprocessCaptionImage(fixture, {
      imageSize,
      resize: 'square',
      mean: [0, 0, 0],
      std: [1, 1, 1],
    });

    const display = await Sharp(fixture).rotate().raw().toBuffer({ resolveWithObject: true });
    expect(display.info.width, 'reference display width').to.equal(50);
    expect(display.info.height, 'reference display height').to.equal(100);
    const stretched = await Sharp(display.data, {
      raw: { width: display.info.width, height: display.info.height, channels: 3 },
    })
      .resize(imageSize, imageSize, { kernel: 'cubic', fit: 'fill' })
      .raw()
      .toBuffer();

    const plane = imageSize * imageSize;
    let checked = 0;
    for (let y = 0; y < imageSize; y += 4) {
      for (let x = 0; x < imageSize; x += 4) {
        for (let c = 0; c < 3; c++) {
          const expected = stretched[(y * imageSize + x) * 3 + c] / 255;
          const actual = output[c * plane + y * imageSize + x];
          // JPEG can shift a sampled primary by one pixel value (1/255),
          // which is ~0.004 after the raw [0, 1] normalisation above.
          expect(actual, `plane ${c} pixel (${x}, ${y})`).to.be.closeTo(expected, 0.02);
          checked += 1;
        }
      }
    }
    expect(checked, 'sampled pixels').to.be.at.least(300);
  });
});

describe('fake captioner pool', () => {
  let imageDir = '';

  before(() => {
    imageDir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'vimtur-autocaption-'));
    FS.writeFileSync(Path.join(imageDir, 'same.jpg'), Buffer.from('first image bytes'));
    FS.writeFileSync(Path.join(imageDir, 'other.jpg'), Buffer.from('different image bytes'));
  });

  after(() => {
    FS.rmSync(imageDir, { recursive: true, force: true });
  });

  it('Captions deterministically from file bytes without downloading the pack', async () => {
    // A cached pack would switch ensureCaptionerPool to the real ORT pool and
    // load roughly a GB of graphs per worker, so the fake case needs an empty
    // cache (the test script points CACHE_PATH at a scratch directory).
    expect(await isPackCached(BLIP_BASE), 'BLIP pack cached in the test cache').to.equal(false);
    const pool = await ensureCaptionerPool(BLIP_BASE);
    try {
      expect(pool.kind).to.equal('fake');
      const samePath = Path.join(imageDir, 'same.jpg');
      const first = await pool.caption(BLIP_BASE, samePath);
      const second = await pool.caption(BLIP_BASE, samePath);
      expect(second).to.equal(first);
      expect(first).to.match(/^a still image \(fake caption [0-9a-f]{8}\)$/);
      expect(await pool.caption(BLIP_BASE, Path.join(imageDir, 'other.jpg'))).to.not.equal(first);
      // Selecting the fake must not have downloaded (or created) the pack.
      expect(FS.existsSync(packDir(BLIP_BASE))).to.equal(false);
    } finally {
      await pool.quit();
    }
  });

  it('Throws for a missing file', async () => {
    const err = await errorOf(() => new FakeCaptionerPool().caption(BLIP_BASE, Path.join(imageDir, 'missing.jpg')));
    expect(err.message).to.match(/ENOENT/);
  });
});
