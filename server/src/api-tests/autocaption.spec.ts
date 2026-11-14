import Crypto from 'node:crypto';
import FS from 'node:fs';
import OS from 'node:os';
import Path from 'node:path';

import type { ListedTask, TaskArgDefinition } from '@vimtur/common';
import { expect } from 'chai';
import { describe } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  createStill,
  createVideo,
  detail,
  expectTaskFailure,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

// TEST_MODE without a cached pack runs the deterministic fake captioner, so
// these tests exercise the real task plumbing over HTTP without any model
// download or network access. Files whose sha256 matches the digest passed as
// AUTOCAPTION_FAKE_EMPTY_SHA get '' instead of the pattern below: the fake's
// "model produced nothing" fixture, used by the empty-caption marker tests at
// the end of this file. Without that env var the fake falls back to a '00'
// digest prefix.
const CAPTION_PATTERN = /^a still image \(fake caption [0-9a-f]{8}\)$/;

function selectIds(arg: TaskArgDefinition | undefined): string[] {
  return arg?.type === 'select' ? arg.values.map((value) => value.id) : [];
}

describe('Auto-caption task', () => {
  let server: ApiServer;
  let client: ApiClient;
  let untagged: string[];
  let taggedHash: string;
  let videoHash: string;

  before(async function (this: Mocha.Context) {
    this.timeout(240_000);
    // An unmatchable digest disables the fake captioner's '00'-prefix fallback:
    // only the marker suite below (which passes a real digest) may produce the ''
    // marker, so no fixture here can accidentally hash into it on another
    // ImageMagick build and break the caption assertions.
    server = await startServer({ env: { AUTOCAPTION_FAKE_EMPTY_SHA: 'api-test-no-empty-marker' } });
    client = new ApiClient(server.baseUrl);
    for (const [filename, color] of [
      ['caption-a.jpg', 'indigo'],
      ['caption-b.jpg', 'orange'],
      ['caption-c.jpg', 'purple'],
      ['caption-tagged.jpg', 'teal'],
    ] as const) {
      await createStill(server.libraryPath, filename, color);
    }
    await createVideo(server.libraryPath, 'caption-video.mp4');
    await runTaskAndWait(client, 'SCAN');
    await runTaskAndWait(client, 'INDEX');
    const byName = async (needle: string): Promise<string> => {
      const hashes = await subset(client, { path: { likeAny: [needle] } });
      expect(hashes, needle).to.have.lengthOf(1);
      return hashes[0];
    };
    untagged = [await byName('caption-a.jpg'), await byName('caption-b.jpg'), await byName('caption-c.jpg')];
    taggedHash = await byName('caption-tagged.jpg');
    videoHash = await byName('caption-video.mp4');

    // Tagged before the task runs: the default skip-tagged mode must leave this
    // still uncaptioned on the first run.
    assertOk(await client.post<string[]>('/api/tags', { tag: 'people' }), 'POST /api/tags people');
    expect((await client.post(`/api/images/${taggedHash}/tags`, { name: 'people' })).status).to.equal(204);
  });

  after(async () => {
    await server?.stop();
  });

  it('lists the auto-caption tasks and their argument values', async function (this: Mocha.Context) {
    this.timeout(30_000);
    const tasks = assertOk(await client.get<ListedTask[]>('/api/tasks'), 'GET /api/tasks');
    const apply = tasks.find((task) => task.id === 'AUTO-CAPTION-BLIP-BASE');
    expect(apply, 'apply task listed').to.not.equal(undefined);
    expect(
      tasks.some((task) => task.id === 'CLEAR-AUTOCAPTIONS'),
      'clear task listed',
    ).to.equal(true);
    expect(apply?.args, 'apply args').to.have.lengthOf(2);
    expect(apply?.args?.map((arg) => arg.type), 'apply arg types').to.deep.equal(['select', 'select']);
    expect(selectIds(apply?.args?.[0]), 'existing captions values').to.deep.equal(['skip-existing', 'replace']);
    expect(selectIds(apply?.args?.[1]), 'manually tagged values').to.deep.equal(['skip-tagged', 'include-tagged']);
  });

  it('captions untagged stills and leaves tagged stills and videos alone', async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'AUTO-CAPTION-BLIP-BASE');

    for (const hash of untagged) {
      expect((await detail(client, hash)).autoCaption, `caption for ${hash}`).to.match(CAPTION_PATTERN);
    }
    expect((await detail(client, taggedHash)).autoCaption, 'manually tagged still').to.equal(undefined);
    expect((await detail(client, videoHash)).autoCaption, 'video').to.equal(undefined);
    // Captions feed keyword search as well as the autoCaption filter.
    expect(await subset(client, { keywordSearch: 'fake' })).to.have.members(untagged);
  });

  it("skip-existing leaves an existing caption and the '' marker alone", async function (this: Mocha.Context) {
    this.timeout(60_000);
    const fixedCaption = 'a penguin on the ice';
    const [fixedHash, markerHash] = untagged;
    expect((await client.patch(`/api/images/${fixedHash}`, { autoCaption: fixedCaption })).status).to.equal(200);
    expect((await client.patch(`/api/images/${markerHash}`, { autoCaption: '' })).status).to.equal(200);

    await runTaskAndWait(client, 'AUTO-CAPTION-BLIP-BASE', ['skip-existing', 'skip-tagged']);

    expect((await detail(client, fixedHash)).autoCaption, 'existing caption').to.equal(fixedCaption);
    // '' is the processed-with-nothing marker, so skip-existing must treat it
    // as captioned and leave it alone.
    expect((await detail(client, markerHash)).autoCaption, "'' marker").to.equal('');
  });

  it('replace and include-tagged recaption everything', async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'AUTO-CAPTION-BLIP-BASE', ['replace', 'include-tagged']);

    for (const hash of [...untagged, taggedHash]) {
      expect((await detail(client, hash)).autoCaption, `caption for ${hash}`).to.match(CAPTION_PATTERN);
    }
    expect((await detail(client, taggedHash)).tags, 'manual tag survives recaptioning').to.deep.equal(['people']);
  });

  it('rejects an invalid mode', async function (this: Mocha.Context) {
    this.timeout(60_000);
    const message = await expectTaskFailure(client, 'AUTO-CAPTION-BLIP-BASE', ['nonsense']);
    expect(message).to.include('Unexpected AUTO-CAPTION mode');
  });

  it('CLEAR-AUTOCAPTIONS clears every caption and keeps manual tags', async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'CLEAR-AUTOCAPTIONS');

    for (const hash of [...untagged, taggedHash]) {
      expect((await detail(client, hash)).autoCaption, `autoCaption for ${hash}`).to.equal(undefined);
    }
    expect(await subset(client, { keywordSearch: 'fake' })).to.deep.equal([]);
    expect((await detail(client, taggedHash)).tags, 'manual tag survives the clear').to.deep.equal(['people']);
  });
});

describe('AUTO-IMPORT auto-captioning gate', () => {
  describe('with a known model', () => {
    let server: ApiServer;
    let client: ApiClient;

    before(async function (this: Mocha.Context) {
      this.timeout(240_000);
      server = await startServer({
        config: { enableAutoCaption: true },
        env: { AUTOCAPTION_FAKE_EMPTY_SHA: 'api-test-no-empty-marker' },
      });
      client = new ApiClient(server.baseUrl);
      await createStill(server.libraryPath, 'import-caption-a.jpg', 'navy');
      await createStill(server.libraryPath, 'import-caption-b.jpg', 'maroon');
    });

    after(async () => {
      await server?.stop();
    });

    it('captions imported stills', async function (this: Mocha.Context) {
      this.timeout(120_000);
      await runTaskAndWait(client, 'AUTO-IMPORT');

      const hashes = await subset(client, { type: { equalsAll: ['still'] } });
      expect(hashes).to.have.lengthOf(2);
      for (const hash of hashes) {
        expect((await detail(client, hash)).autoCaption, `caption for ${hash}`).to.match(CAPTION_PATTERN);
      }
    });
  });

  describe('with an unknown model', () => {
    let server: ApiServer;
    let client: ApiClient;

    before(async function (this: Mocha.Context) {
      this.timeout(240_000);
      server = await startServer({
        config: { enableAutoCaption: true, autocaption: { model: 'AUTO-CAPTION-NOPE' } },
        env: { AUTOCAPTION_FAKE_EMPTY_SHA: 'api-test-no-empty-marker' },
      });
      client = new ApiClient(server.baseUrl);
      await createStill(server.libraryPath, 'import-unknown-model.jpg', 'olive');
    });

    after(async () => {
      await server?.stop();
    });

    it('completes the import without captioning or downloading anything', async function (this: Mocha.Context) {
      this.timeout(120_000);
      await runTaskAndWait(client, 'AUTO-IMPORT');

      const hashes = await subset(client, { type: { equalsAll: ['still'] } });
      expect(hashes).to.have.lengthOf(1);
      expect((await detail(client, hashes[0])).autoCaption, 'unknown model caption').to.equal(undefined);

      // An unknown task id must fail closed before the pack download: no pack
      // files may appear in the cache.
      const autocaptionDir = Path.resolve(server.cachePath, 'autocaption');
      const cached = FS.existsSync(autocaptionDir) ? FS.readdirSync(autocaptionDir, { recursive: true }) : [];
      expect(cached, 'autocaption cache after an unknown model import').to.deep.equal([]);
    });
  });
});

describe('Empty caption marker', () => {
  let server: ApiServer;
  let client: ApiClient;
  let candidateDir = '';
  let markerHash = '';

  before(async function (this: Mocha.Context) {
    this.timeout(240_000);

    // The TEST_MODE fake answers '' for the exact digest passed in
    // AUTOCAPTION_FAKE_EMPTY_SHA, the deterministic "model produced nothing"
    // fixture. It has to be chosen before the server starts (the fake reads the
    // env at boot), so find a candidate by writing stills into a temp directory
    // outside the library and hashing them. Passing this one digest rather than
    // matching a '00' prefix also means no other fixture can accidentally
    // become the empty marker on a different ImageMagick build. A two-hex-digit
    // prefix needs ~256 candidates; the cap keeps a broken fixture loop from
    // hanging the suite.
    candidateDir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'vimtur-autocaption-marker-'));
    let markerSource: string | undefined;
    let markerDigest = '';
    for (let index = 0; index < 5000 && !markerSource; index++) {
      const candidate = Path.join(candidateDir, `candidate-${index}.png`);
      await createStill(candidateDir, Path.basename(candidate), `#${index.toString(16).padStart(6, '0')}`);
      const digest = Crypto.createHash('sha256').update(FS.readFileSync(candidate)).digest('hex');
      if (digest.startsWith('00')) {
        markerSource = candidate;
        markerDigest = digest;
      }
    }
    if (!markerSource) {
      throw new Error('No candidate still hashed to a 00-prefixed sha256 within 5000 attempts');
    }

    server = await startServer({ env: { AUTOCAPTION_FAKE_EMPTY_SHA: markerDigest } });
    client = new ApiClient(server.baseUrl);

    FS.copyFileSync(markerSource, Path.join(server.libraryPath, 'caption-marker.png'));
    await runTaskAndWait(client, 'SCAN');
    await runTaskAndWait(client, 'INDEX');
    const hashes = await subset(client, { path: { likeAny: ['caption-marker.png'] } });
    expect(hashes, 'marker still').to.have.lengthOf(1);
    markerHash = hashes[0];
  });

  after(async () => {
    await server?.stop();
    if (candidateDir) {
      FS.rmSync(candidateDir, { recursive: true, force: true });
    }
  });

  it("stores '' rather than leaving the caption absent", async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'AUTO-CAPTION-BLIP-BASE');

    expect((await detail(client, markerHash)).autoCaption, "'' marker").to.equal('');
  });

  it("skip-existing leaves the '' marker alone", async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'AUTO-CAPTION-BLIP-BASE', ['skip-existing', 'skip-tagged']);

    // '' is the processed-with-nothing marker, so it must survive a run that
    // only captions media without a stored caption.
    expect((await detail(client, markerHash)).autoCaption, "'' marker after skip-existing").to.equal('');
  });

  it('replace overwrites a real caption with the empty marker', async function (this: Mocha.Context) {
    this.timeout(60_000);
    const fixedCaption = 'a penguin on the ice';
    expect((await client.patch(`/api/images/${markerHash}`, { autoCaption: fixedCaption })).status).to.equal(200);
    expect((await detail(client, markerHash)).autoCaption, 'patched caption').to.equal(fixedCaption);

    await runTaskAndWait(client, 'AUTO-CAPTION-BLIP-BASE', ['replace', 'skip-tagged']);

    expect((await detail(client, markerHash)).autoCaption, "'' marker after replace").to.equal('');
  });
});
