import FS from 'node:fs';
import Path from 'node:path';
import type { QueuedTask } from '@vimtur/common';
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

  it('RESET-AUTOTAGS removes them and their keyword matches', async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'RESET-AUTOTAGS');
    expect((await detail(client, stillHash)).autoTags).to.equal(undefined);
    expect(await subset(client, { keywordSearch: 'tabby' })).to.deep.equal([]);
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
