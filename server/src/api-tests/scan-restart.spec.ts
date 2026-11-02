import FS from 'fs';
import OS from 'os';
import Path from 'path';

import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  assertStatus,
  createStill,
  detail,
  expectTaskFailure,
  runTaskAndWait,
  scanResults,
  startServer,
  subset,
} from './harness';

// The SCAN → INDEX / DELETE-MISSING hand-off is persisted state, not in-memory
// state: a server restart between the scan and its consumer must keep the
// pending work. These tests boot the same SQLite-backed root twice per restart
// and consume the stored lists without re-scanning.
describe('SCAN hand-off across restarts', () => {
  let root: string;
  let server: ApiServer;
  let client: ApiClient;

  const scanNewPaths = async (): Promise<string[]> => {
    return assertOk(await client.get<string[]>('/api/tasks/SCAN/results/new'), 'GET /api/tasks/SCAN/results/new');
  };

  const scanMissingPaths = async (): Promise<string[]> => {
    return assertOk(
      await client.get<string[]>('/api/tasks/SCAN/results/missing'),
      'GET /api/tasks/SCAN/results/missing',
    );
  };

  // Stops the server and boots a new process against the same temp root: same
  // database file, library and cache. The root comes back out of the handle
  // (ApiServer.root) and goes straight back in, so a reader can see that field
  // is the round-trip handle for re-boots.
  const restartServer = async (): Promise<void> => {
    await server.stop();
    server = await startServer({ root: server.root, dbMode: 'file' });
    client = new ApiClient(server.baseUrl);
  };

  before(async () => {
    // The spec must own the root before the first boot: stop() only leaves a
    // caller-supplied root in place (a harness-created one is deleted), and
    // these tests restart against it.
    root = FS.mkdtempSync(Path.join(OS.tmpdir(), 'vimtur-api-restart-'));
    server = await startServer({ root, dbMode: 'file' });
    client = new ApiClient(server.baseUrl);
  });

  after(async () => {
    // The supplied root is owned by this spec, so stop() leaves it in place.
    await server?.stop();
    FS.rmSync(root, { recursive: true, force: true });
  });

  it('404s the scan results until a scan has been stored', async () => {
    for (const path of ['/api/tasks/SCAN/results', '/api/tasks/SCAN/results/new', '/api/tasks/SCAN/results/missing']) {
      const data = assertStatus(await client.get<{ message: string }>(path), 404, `GET ${path}`);
      expect(data, `GET ${path}`).to.have.property('message');
    }
  });

  it('reports pending work with the time it was generated', async () => {
    await createStill(server.libraryPath, 'a-still.jpg', 'red');
    await runTaskAndWait(client, 'SCAN');

    const summary = await scanResults(client);
    expect(summary.newPaths).to.equal(1);
    expect(summary.missingPaths).to.equal(0);
    expect(summary.generatedAt).to.be.a('number').and.to.be.above(0);
    expect(await scanNewPaths()).to.deep.equal(['a-still.jpg']);
    expect(await scanMissingPaths()).to.deep.equal([]);
  });

  it('keeps the pending work across a restart', async () => {
    // The captured timestamp identifies the scan whose lists survived.
    const beforeRestart = await scanResults(client);

    // Restart AFTER the scan and BEFORE the index: the state being restarted
    // into is the pending work itself.
    await restartServer();

    const afterRestart = await scanResults(client);
    expect(afterRestart).to.deep.equal(beforeRestart);
    expect(await scanNewPaths()).to.deep.equal(['a-still.jpg']);
  });

  it('INDEX consumes the pending work across a restart', async () => {
    const beforeIndex = await scanResults(client);
    await runTaskAndWait(client, 'INDEX');

    // Consuming rewrites the lists but keeps the scan timestamp for the UI's
    // "last scan" display.
    const consumed = await scanResults(client);
    expect(consumed).to.deep.equal({ ...beforeIndex, newPaths: 0, missingPaths: 0 });
    expect(await scanNewPaths()).to.deep.equal([]);

    const hashes = await subset(client, {});
    expect(hashes).to.have.lengthOf(1);
    expect((await detail(client, hashes[0])).path).to.equal('a-still.jpg');
  });

  it('DELETE-MISSING consumes the pending work across a restart', async () => {
    // Enough media that a single missing file is inside the 10% strict-mode
    // safety limit, so the strict path can run without the allow-all opt-out.
    for (let i = 0; i < 11; i++) {
      await createStill(server.libraryPath, `still-${i}.png`, `rgb(${i * 20},${i * 10},0)`);
    }
    await runTaskAndWait(client, 'SCAN');
    await runTaskAndWait(client, 'INDEX');
    expect(await subset(client, {})).to.have.lengthOf(12);

    FS.rmSync(Path.join(server.libraryPath, 'a-still.jpg'));
    await runTaskAndWait(client, 'SCAN');
    const beforeDelete = await scanResults(client);
    expect(beforeDelete.missingPaths).to.equal(1);
    expect(await scanMissingPaths()).to.deep.equal(['a-still.jpg']);

    // Restart between SCAN and DELETE-MISSING, then consume without scanning.
    await restartServer();
    await runTaskAndWait(client, 'DELETE-MISSING');

    expect(await subset(client, {})).to.have.lengthOf(11);
    const consumed = await scanResults(client);
    expect(consumed).to.deep.equal({ ...beforeDelete, newPaths: 0, missingPaths: 0 });
    expect(await scanMissingPaths()).to.deep.equal([]);
  });

  it('a failed SCAN does not overwrite the stored results', async () => {
    await createStill(server.libraryPath, 'b-still.jpg', 'blue');
    await runTaskAndWait(client, 'SCAN');
    const beforeFailure = await scanResults(client);
    expect(beforeFailure.newPaths).to.equal(1);

    // An unreadable subdirectory fails the whole walk (files under it would
    // otherwise be reported as missing), so the scan must not publish
    // anything: the previous scan's pending work and timestamp stay.
    const blockedDir = Path.join(server.libraryPath, 'blocked');
    await createStill(server.libraryPath, 'blocked/hidden.png', 'green');
    try {
      FS.chmodSync(blockedDir, 0o000);
      const message = await expectTaskFailure(client, 'SCAN');
      expect(message).to.include('could not read');
    } finally {
      // The teardown removes the fixture tree and needs the permission back.
      FS.chmodSync(blockedDir, 0o755);
    }

    expect(await scanResults(client)).to.deep.equal(beforeFailure);
    expect(await scanNewPaths()).to.deep.equal(['b-still.jpg']);
  });
});
