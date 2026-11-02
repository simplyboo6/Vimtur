import FS from 'node:fs';
import Path from 'node:path';
import type { ListedTask, QueuedTask } from '@vimtur/common';
import { expect } from 'chai';
import { describe } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  createStill,
  detail,
  queueTask,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

const DRAIN_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

// Queues a task known to fail and returns the errored queue entry. Distinct
// from runTaskAndWait because that fails fast on any errored task. Waits for
// the errored entry to auto-clear, or the next drain would observe it and
// fail on its behalf.
async function runTaskToError(client: ApiClient, id: string, args?: unknown): Promise<QueuedTask> {
  const queuedId = await queueTask(client, id, args);
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  let errored: QueuedTask | undefined;
  for (;;) {
    const queue = await client.get<QueuedTask[]>('/api/tasks/queue').then((r) => r.data as QueuedTask[]);
    const entry = queue.find((task) => task.id === queuedId);
    if (!entry) {
      if (errored) {
        return errored;
      }
      throw new Error(`Queued task ${queuedId} vanished from the queue`);
    }
    if (entry.error) {
      errored = entry;
      // Errored entries never auto-clear (only successful runs do), so this
      // test must remove its own entry or the next drain observes it.
      await client.delete(`/api/tasks/queue/${queuedId}`);
    } else if (entry.complete) {
      throw new Error(`Expected ${id} to fail, it completed instead`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${id} did not complete within ${DRAIN_TIMEOUT_MS}ms: ${JSON.stringify(entry)}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_MS);
    });
  }
}

// Auto-tags flow through a dedicated column with its own FTS trigger (SQLite)
// and text-index entry (Mongo). Only the model-independent plumbing is pinned
// here over HTTP: writing autoTags through PATCH, keyword-searching them, and
// the RESET-AUTOTAGS task. Actual classification needs a model download, so
// the classify task is never queued with auto-tagging disabled.
describe('Auto-tags round-trip', () => {
  let server: ApiServer;
  let client: ApiClient;
  let stillHash: string;

  before(async function (this: Mocha.Context) {
    this.timeout(240_000);
    server = await startServer();
    client = new ApiClient(server.baseUrl);
    await createStill(server.libraryPath, 'autotag-still.jpg', 'indigo');
    await runTaskAndWait(client, 'SCAN');
    await runTaskAndWait(client, 'INDEX');
    const hashes = await subset(client, { type: { equalsAll: ['still'] } });
    expect(hashes).to.have.lengthOf(1);
    stillHash = hashes[0];
  });

  after(async () => {
    await server?.stop();
  });

  it('writes autoTags through PATCH and serves them back', async function (this: Mocha.Context) {
    this.timeout(30_000);
    const response = await client.patch(`/api/images/${stillHash}`, { autoTags: ['kitten', 'tabby'] });
    expect(response.status, 'PATCH /api/images/:hash').to.be.at.least(200).and.at.most(299);
    expect((await detail(client, stillHash)).autoTags).to.deep.equal(['kitten', 'tabby']);
  });

  it('matches autoTags in keyword search', async function (this: Mocha.Context) {
    this.timeout(30_000);
    expect(await subset(client, { keywordSearch: 'tabby' })).to.deep.equal([stillHash]);
    expect(await subset(client, { keywordSearch: 'zzzznope' })).to.deep.equal([]);
  });

  it('queues with no args (the auto-import path) and finds an empty work set', async function (this: Mocha.Context) {
    this.timeout(60_000);
    // No thumbnails have been generated in this fixture, so the work set is
    // empty; the task must still complete cleanly thanks to runner-side arg
    // defaults.
    await runTaskAndWait(client, 'AUTO-TAG-MOBILE-NET-V2');
    // Enforceable guard that the empty work set really skipped the classifier:
    // a run that classified anything would have downloaded a model here,
    // silently turning this API test network-dependent.
    const autotagDir = Path.resolve(server.cachePath, 'autotag');
    const downloaded = FS.existsSync(autotagDir)
      ? FS.readdirSync(autotagDir, { withFileTypes: true }).filter((entry) => entry.isFile())
      : [];
    expect(downloaded.map((entry) => entry.name)).to.deep.equal([]);
  });

  it('rejects an invalid Existing tags mode with a task error', async function (this: Mocha.Context) {
    this.timeout(60_000);
    const entry = await runTaskToError(client, 'AUTO-TAG-MOBILE-NET-V2', ['nonsense']);
    expect(entry.error).to.include('Unexpected AUTO-TAG mode');
  });

  it('lists the manual-tag argument on both apply task families', async function (this: Mocha.Context) {
    this.timeout(30_000);
    const tasks = assertOk(await client.get<ListedTask[]>('/api/tasks'), 'GET /api/tasks');
    const siglip = tasks.find((task) => task.id === 'AUTO-TAG-AVES-SIGLIP2-B32');
    const classifier = tasks.find((task) => task.id === 'AUTO-TAG-MOBILE-NET-V2');
    for (const [label, task] of [
      ['siglip', siglip],
      ['classifier', classifier],
    ] as const) {
      expect(task, `${label} task listed`).to.not.equal(undefined);
      expect(task?.args, `${label} args`).to.have.lengthOf(2);
      const taggedArg = task?.args?.[1];
      expect(taggedArg?.type, `${label} second arg type`).to.equal('select');
      expect(taggedArg?.name, `${label} second arg name`).to.equal('Tag media with manual tags');
      expect(
        taggedArg?.type === 'select' ? taggedArg.values.map((value) => value.id) : [],
        `${label} second arg values`,
      ).to.deep.equal(['skip-tagged', 'include-tagged']);
    }
  });

  it('RESET-AUTOTAGS removes them and their keyword matches', async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'RESET-AUTOTAGS');
    expect((await detail(client, stillHash)).autoTags).to.equal(undefined);
    expect(await subset(client, { keywordSearch: 'tabby' })).to.deep.equal([]);
  });
});

// The bulk counterpart of the viewer's clear icon: every media item that holds
// an auto-tags list (a populated list or the [] "processed, nothing scored"
// marker) loses it regardless of manual tags, and the clear stores NULL rather
// than an empty list, so the skip-existing work set treats the item as
// unprocessed again. The task drives the standard bulk media update.
describe('CLEAR-TAGGED-AUTOTAGS', () => {
  let server: ApiServer;
  let client: ApiClient;
  let taggedHash: string;
  let autoOnlyHash: string;
  let markedHash: string;
  let untouchedHash: string;

  before(async function (this: Mocha.Context) {
    this.timeout(240_000);
    server = await startServer();
    client = new ApiClient(server.baseUrl);
    for (const [filename, color] of [
      ['tagged.jpg', 'orange'],
      ['auto-only.jpg', 'purple'],
      ['marked.jpg', 'teal'],
      ['untouched.jpg', 'silver'],
    ] as const) {
      await createStill(server.libraryPath, filename, color);
    }
    await runTaskAndWait(client, 'SCAN');
    await runTaskAndWait(client, 'INDEX');
    const byName = async (needle: string): Promise<string> => {
      const hashes = await subset(client, { path: { likeAny: [needle] } });
      expect(hashes, needle).to.have.lengthOf(1);
      return hashes[0];
    };
    taggedHash = await byName('tagged.jpg');
    autoOnlyHash = await byName('auto-only.jpg');
    markedHash = await byName('marked.jpg');
    untouchedHash = await byName('untouched.jpg');

    assertOk(await client.post<string[]>('/api/tags', { tag: 'people' }), 'POST /api/tags people');
    expect((await client.post(`/api/images/${taggedHash}/tags`, { name: 'people' })).status).to.equal(204);
    expect((await client.patch(`/api/images/${taggedHash}`, { autoTags: ['kitten'] })).status).to.equal(200);
    expect((await client.patch(`/api/images/${autoOnlyHash}`, { autoTags: ['puppy'] })).status).to.equal(200);
    // The stored [] "processed, nothing scored" marker: it counts as auto tags
    // present, so the clear must drop it too. The fourth still is never touched:
    // it has neither a manual tag nor an auto-tags list.
    expect((await client.patch(`/api/images/${markedHash}`, { autoTags: [] })).status).to.equal(200);
  });

  after(async () => {
    await server?.stop();
  });

  it('clears every auto-tags list regardless of manual tags', async function (this: Mocha.Context) {
    this.timeout(60_000);
    const untouchedBefore = await detail(client, untouchedHash);
    await runTaskAndWait(client, 'CLEAR-TAGGED-AUTOTAGS');

    const tagged = await detail(client, taggedHash);
    expect(tagged.autoTags, 'tagged media autoTags').to.equal(undefined);
    expect(tagged.tags, 'tagged media manual tags').to.deep.equal(['people']);

    expect((await detail(client, autoOnlyHash)).autoTags, 'auto-only media autoTags').to.equal(undefined);
    expect((await detail(client, markedHash)).autoTags, '[] marker autoTags').to.equal(undefined);

    // Media with neither a manual tag nor an auto-tags list is outside the work
    // set: the task must not have touched it.
    expect(await detail(client, untouchedHash), 'untouched media').to.deep.equal(untouchedBefore);

    // saveBulkMedia's return value is the count the task logs; the four stills
    // above show which rows it covers (the three with an auto-tags list), so
    // read the server's own line to pin the returned count exactly.
    const log = FS.readFileSync(Path.resolve(server.libraryPath, '..', 'server.log'), 'utf8');
    const clearedCounts = [...log.matchAll(/CLEAR-TAGGED-AUTOTAGS: cleared (\d+) media/g)];
    expect(Number(clearedCounts.at(-1)?.[1]), 'cleared rows').to.equal(3);

    // NULL (absent), not []: the cleared and never-touched items are all
    // unprocessed now, so the skip-existing work set includes them again.
    expect(await subset(client, { autoTags: { exists: false } })).to.have.members([
      taggedHash,
      autoOnlyHash,
      markedHash,
      untouchedHash,
    ]);
  });
});

// The viewer's × icon: clearing goes through the standard media update with an
// explicit autoTags: null, which stores NULL (not the [] "processed" marker),
// so the item is reconsidered by a default skip-existing apply while a manual
// tag still protects it under the skip-tagged default.
describe('Clear media auto-tags through the media update API', () => {
  let server: ApiServer;
  let client: ApiClient;
  let hash: string;

  before(async function (this: Mocha.Context) {
    this.timeout(240_000);
    server = await startServer();
    client = new ApiClient(server.baseUrl);
    await createStill(server.libraryPath, 'clear-endpoint.jpg', 'crimson');
    await runTaskAndWait(client, 'SCAN');
    await runTaskAndWait(client, 'INDEX');
    const hashes = await subset(client, { path: { likeAny: ['clear-endpoint.jpg'] } });
    expect(hashes, 'clear-endpoint.jpg').to.have.lengthOf(1);
    hash = hashes[0];

    assertOk(await client.post<string[]>('/api/tags', { tag: 'people' }), 'POST /api/tags people');
    expect((await client.post(`/api/images/${hash}/tags`, { name: 'people' })).status).to.equal(204);
    expect((await client.patch(`/api/images/${hash}`, { autoTags: ['kitten'] })).status).to.equal(200);
  });

  after(async () => {
    await server?.stop();
  });

  it('PATCH autoTags: null removes them, keeps manual tags and un-marks the item', async function (this: Mocha.Context) {
    this.timeout(30_000);
    const response = assertOk(
      await client.patch<{ autoTags?: string[] }>(`/api/images/${hash}`, { autoTags: null }),
      'PATCH /api/images/:hash autoTags: null',
    );
    expect(response.autoTags, 'cleared media autoTags in the response').to.equal(undefined);

    const media = await detail(client, hash);
    expect(media.autoTags, 'cleared media autoTags').to.equal(undefined);
    expect(media.tags, 'manual tags survive the clear').to.deep.equal(['people']);
    // NULL (absent), not []: the skip-existing work set includes it again.
    expect(await subset(client, { autoTags: { exists: false } })).to.include(hash);

    // Idempotent: a repeat PATCH clears the already-cleared row again.
    expect((await client.patch(`/api/images/${hash}`, { autoTags: null })).status, 'repeat PATCH').to.equal(200);
    expect((await detail(client, hash)).autoTags).to.equal(undefined);
  });
});

// The #131 rename (enableTensorFlow -> enableAutoTags) must not brick
// pre-rename installs: legacy keys arrive both in config.json (the layer
// the harness generates) and via POST /api/config, and neither may reach
// schema validation unmapped.
describe('Config enableTensorFlow rename mapping', () => {
  let server: ApiServer;
  let client: ApiClient;

  before(async function (this: Mocha.Context) {
    this.timeout(120_000);
    // The harness plants enableAutoTags: false unless it is explicitly
    // overridden; undefined values are dropped by JSON.stringify, so this
    // config.json carries only the pre-rename key, which is exactly what a
    // pre-#131 install looks like.
    server = await startServer({ config: { enableAutoTags: undefined, enableTensorFlow: true } });
    client = new ApiClient(server.baseUrl);
  });

  after(async () => {
    await server?.stop();
  });

  it('boots with the legacy key and serves the renamed value', async function (this: Mocha.Context) {
    this.timeout(30_000);
    const config = assertOk(
      await client.get<{ enableAutoTags?: boolean; enableTensorFlow?: boolean }>('/api/config'),
      'GET /api/config',
    );
    expect(config.enableAutoTags).to.equal(true);
    expect(config.enableTensorFlow).to.equal(undefined);
  });

  it('maps a legacy key posted to the API', async function (this: Mocha.Context) {
    this.timeout(30_000);
    const config = assertOk(
      await client.post<{ enableAutoTags?: boolean; enableTensorFlow?: boolean }>('/api/config', {
        enableTensorFlow: false,
      }),
      'POST /api/config',
    );
    expect(config.enableAutoTags).to.equal(false);
    expect(config.enableTensorFlow).to.equal(undefined);
  });
});
