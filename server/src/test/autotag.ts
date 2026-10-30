import Crypto from 'node:crypto';
import FS from 'node:fs';
import HTTP from 'node:http';

import { expect } from 'chai';
import { after, before, describe, it } from 'mocha';
import Sharp from 'sharp';

import type { ModelDefinition } from '../tasks/autotag/models';
import { ensureModelDownloaded, loadClasses, modelPath } from '../tasks/autotag/models';
import { preprocessImage, topLabels } from '../tasks/autotag/preprocess';

describe('Auto-Tag label bundle', () => {
  it('Bundles exactly the 1000 ImageNet classes in synset order', () => {
    const classes = loadClasses();
    expect(classes).to.have.lengthOf(1000);
    // Anchor classes from either end of the list catch any line-shuffling.
    expect(classes[0]).to.equal('tench');
    expect(classes[999]).to.equal('toilet tissue');
  });
});

describe('Auto-Tag label ranking', () => {
  const classes = ['a', 'b', 'c', 'd'];

  it('Selects the strongest labels in descending order', () => {
    const logits = [0.1, 2.0, 0.5, 1.9];
    expect(topLabels(logits, classes, 2)).to.deep.equal(['b', 'd']);
  });

  it('Breaks ties by class index for stable output', () => {
    const logits = [1, 1, 1, 1];
    expect(topLabels(logits, classes, 4)).to.deep.equal(['a', 'b', 'c', 'd']);
  });

  it('Rejects outputs that disagree with the label list', () => {
    expect(() => topLabels([1, 2], classes, 5)).to.throw(/2 classes, label list has 4/);
  });
});

// Preprocessing normalises as (pixel / 255 - mean[c]) / std[c] laid out NCHW,
// so expected values come from the torchvision ImageNet constants.
// Pixel values are 0 or 255 so the normalisation maths is exact.
const PREPROCESS: ModelDefinition['preprocess'] = {
  resizeShorterSide: 8,
  cropSize: 6,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
};

function expected(pixel: number, channel: number): number {
  return (pixel / 255 - PREPROCESS.mean[channel]) / PREPROCESS.std[channel];
}

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

describe('Auto-Tag preprocessing', () => {
  it('Centre-crops and lays out channels plane-first (NCHW)', async () => {
    // 16x8: the shorter side already equals resizeShorterSide, so resize is a
    // pass-through and the crop window is exact: 1 pixel in from top and
    // bottom, 5 in from the left and right. Source columns 0-7 are red,
    // 8-15 green; blue is uniform so every plane position is predictable.
    const cropSize = PREPROCESS.cropSize;
    const plane = cropSize * cropSize;
    const png = await buildImage(16, 8, (x) => (x < 8 ? [255, 0, 0] : [0, 255, 0]));
    const output = await preprocessImage(png, PREPROCESS);

    expect(output).to.have.lengthOf(3 * plane);
    // Channel c occupies [c * plane, (c + 1) * plane). Crop source x 5-10:
    // crop columns 0-2 are red source, 3-5 green. The output is Float32, so
    // comparisons carry a relative epsilon for the double -> float rounding.
    const close = (index: number, expectedValue: number, label: string): void => {
      expect(output[index], label).to.be.closeTo(expectedValue, Math.abs(expectedValue) * 1e-5);
    };
    close(0, expected(255, 0), 'red plane, crop column 0');
    close(2, expected(255, 0), 'red plane, crop column 2');
    close(3, expected(0, 0), 'red plane, crop column 3 (green source)');
    close(5, expected(0, 0), 'red plane, crop column 5');
    close(plane, expected(0, 1), 'green plane, crop column 0');
    close(plane + 3, expected(255, 1), 'green plane, crop column 3 (green source)');
    close(2 * plane, expected(0, 2), 'blue plane, crop column 0');
    close(3 * plane - 1, expected(0, 2), 'blue plane, last pixel');
  });

  it('Normalises channel planes away from the raw [0, 1] range', async () => {
    const png = await buildImage(6, 6, () => [255, 255, 255]);
    const output = await preprocessImage(png, PREPROCESS);
    // High-channel pulls the normalised value up, not down.
    expect(output[0]).to.be.greaterThan(1);
    expect(output[PREPROCESS.cropSize * PREPROCESS.cropSize]).to.be.greaterThan(1);
    expect(output[2 * PREPROCESS.cropSize * PREPROCESS.cropSize]).to.be.greaterThan(1);
  });
});

const TEST_BYTES = Buffer.from('0123456789'.repeat(4));

const SHA256 = Crypto.createHash('sha256').update(TEST_BYTES).digest('hex');

function definition(urlPath: string, id: string, sha256: string = SHA256): ModelDefinition {
  return {
    id,
    name: id,
    url: `TEST-SERVER${urlPath}`,
    sha256,
    preprocess: PREPROCESS,
  };
}

describe('Auto-Tag model download', () => {
  let serverUrl = '';
  let server: HTTP.Server;
  let requestCount = 0;

  before(function setup(done: (err?: unknown) => void) {
    this.timeout(10_000);
    server = HTTP.createServer((req, res) => {
      requestCount += 1;
      if (req.url?.startsWith('/good')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(TEST_BYTES.length) });
        res.end(TEST_BYTES);
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        done(new Error('Server did not bind'));
        return;
      }
      serverUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  after(function teardown(done: (err?: unknown) => void) {
    server.close(() => done());
  });

  // The url is only known once the ephemeral test server is bound, so the
  // definitions are built inside the tests rather than at module scope.
  function remote(urlPath: string, id: string, sha256?: string): ModelDefinition {
    return { ...definition(urlPath, id, sha256), url: `${serverUrl}${urlPath}` };
  }

  function errorOf(run: () => Promise<unknown>): Promise<Error | undefined> {
    return run().then(
      () => undefined,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
  }

  it('Downloads a verified model to the destination path', async function time() {
    this.timeout(10_000);
    const model = remote('/good/model.onnx', 'TEST-MODEL-HAPPY');
    const path = await ensureModelDownloaded(model);
    expect(path).to.equal(modelPath(model));
    expect(FS.readFileSync(path).equals(TEST_BYTES)).to.equal(true);
  });

  it('Reuses the cached file on later calls without re-downloading', async function time() {
    this.timeout(10_000);
    const model = remote('/good/model.onnx', 'TEST-MODEL-HAPPY');
    const before = requestCount;
    const path = await ensureModelDownloaded(model);
    expect(FS.readFileSync(path).equals(TEST_BYTES)).to.equal(true);
    // A HEAD staleness probe is fine, but no second body fetch may occur.
    expect(requestCount - before).to.be.at.most(1);
  });

  it('Refuses to cache a download whose hash disagrees', async function time() {
    this.timeout(10_000);
    const model = remote('/good/model.onnx', 'TEST-MODEL-BAD', '0'.repeat(64));
    const err = await errorOf(() => ensureModelDownloaded(model));
    expect(err?.message).to.match(/hash mismatch/);
    // The partial must not linger, or a later run could race with it.
    expect(FS.existsSync(`${modelPath(model)}.part`)).to.equal(false);
    expect(FS.existsSync(modelPath(model))).to.equal(false);
  });

  it('Surfaces a clean failure when the source is unreachable', async function time() {
    this.timeout(10_000);
    const err = await errorOf(() => ensureModelDownloaded(remote('/missing/model.onnx', 'TEST-MODEL-MISSING')));
    expect(err?.message).to.match(/404/);
  });
});
