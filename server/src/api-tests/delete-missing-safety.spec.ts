import FS from 'fs';

import type { ListedTask, QueuedTask, Scanner } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ApiClient, type ApiServer, assertOk, createStill, runTaskAndWait, startServer, subset } from './harness';

// Fails only when the expected task error surfaces; returns its message.
// Failed task instances stay queued (auto-clear only removes successful
// ones), so they are removed here to not poison later runTaskAndWait calls.
const expectTaskFailure = async (client: ApiClient, id: string, args?: unknown): Promise<string> => {
  let failed = false;
  let message = `Task ${id} was expected to fail but completed`;
  try {
    await runTaskAndWait(client, id, args);
  } catch (err: unknown) {
    failed = true;
    message = err instanceof Error ? err.message : String(err);
  }

  const queue = assertOk(await client.get<QueuedTask[]>('/api/tasks/queue'), 'GET /api/tasks/queue');
  for (const task of queue.filter((el) => el.id.startsWith(id) && el.error)) {
    assertOk(await client.delete(`/api/tasks/queue/${task.id}`), `DELETE /api/tasks/queue/${task.id}`);
  }

  if (!failed) {
    throw new Error(message);
  }
  return message;
};

// DELETE-MISSING deletes database rows for files that vanished from the
// library. A walk that silently resolves to nothing (unmounted volume,
// misconfigured DATA_PATH) would otherwise mark every database path missing
// and one run could wipe the whole tracked library and its playlists.
// These tests pin the guards: a 10% threshold with an explicit opt-out, and
// SCAN refusing to publish results when the walk cannot see any files.
describe('DELETE-MISSING safety', () => {
  let server: ApiServer;
  let client: ApiClient;

  const scanResults = async (): Promise<Scanner.Summary> => {
    return assertOk(await client.get<Scanner.Summary>('/api/tasks/SCAN/results'), 'GET /api/tasks/SCAN/results');
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    // 20 media so that two deletions land exactly on the 10% threshold and
    // five (≈28% of the remainder) exceed it. Each file gets a distinct
    // colour because media hashes are content-based and would otherwise
    // collapse into a single deduplicated hash.
    for (let i = 0; i < 20; i++) {
      await createStill(server.libraryPath, `red-${i}.png`, `rgb(${i},0,0)`);
    }
  });

  after(async () => {
    await server?.stop();
  });

  it('advertises the safety mode argument', async () => {
    const tasks = assertOk(await client.get<ListedTask[]>('/api/tasks'), 'GET /api/tasks');
    const deleteMissing = tasks.find((task) => task.id === 'DELETE-MISSING');
    expect(deleteMissing, 'DELETE-MISSING listed').to.be.an('object');
    const arg = deleteMissing!.args?.[0];
    expect(arg?.type).to.equal('select');
    const values = arg && arg.type === 'select' ? arg.values : [];
    expect(values.map((value) => value.id)).to.deep.equal(['strict', 'allow-all']);
    // The client asks for a modal confirmation for values that declare one.
    expect(values[0].confirm).to.equal(undefined);
    expect(values[1].confirm).to.include('cannot be undone');
  });

  it('imports all created media', async () => {
    await runTaskAndWait(client, 'AUTO-IMPORT');
    expect(await subset(client, {})).to.have.lengthOf(20);
  });

  it('deletes files exactly at the threshold without confirmation', async () => {
    // 2 of 20 is exactly 10%: the strict mode only refuses above it.
    FS.unlinkSync(`${server.libraryPath}/red-0.png`);
    FS.unlinkSync(`${server.libraryPath}/red-1.png`);

    await runTaskAndWait(client, 'SCAN');
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 2 });

    // No arguments: defaults to 'strict'.
    await runTaskAndWait(client, 'DELETE-MISSING', []);

    expect(await subset(client, {})).to.have.lengthOf(18);
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 0 });
  });

  it('refuses to run in strict mode when missing files exceed the threshold', async () => {
    for (let i = 2; i <= 6; i++) {
      FS.unlinkSync(`${server.libraryPath}/red-${i}.png`);
    }

    await runTaskAndWait(client, 'SCAN');
    // 5 of the 18 remaining media: well over 10%.
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 5 });

    const message = await expectTaskFailure(client, 'DELETE-MISSING', []);
    expect(message).to.include('Refusing to delete');

    // The refusal is protective: nothing left the database.
    expect(await subset(client, {})).to.have.lengthOf(18);
  });

  it('keeps the pending missing list after a refusal', async () => {
    // A refused run must not consume the scan results, otherwise the only
    // way to retry would be a whole new SCAN.
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 5 });
  });

  it('rejects an unknown safety mode', async () => {
    const message = await expectTaskFailure(client, 'DELETE-MISSING', ['bogus']);
    expect(message).to.include('Unexpected DELETE-MISSING safety mode');
  });

  it('deletes everything when the allow-all mode is passed', async () => {
    await runTaskAndWait(client, 'DELETE-MISSING', ['allow-all']);

    expect(await subset(client, {})).to.have.lengthOf(13);
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 0 });
  });

  it('accepts the empty-object POST body in place of missing arguments', async () => {
    // Scripted callers used to POST {}, which every other task accepts.
    // With nothing missing this run deletes nothing, and must not die on
    // task-argument validation after the 200 ("args is not an array").
    await runTaskAndWait(client, 'DELETE-MISSING', {});

    expect(await subset(client, {})).to.have.lengthOf(13);
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 0 });
  });

  it('SCAN fails loudly when the library path is gone', async () => {
    // Simulates the volume unmounting: the walk root is unreadable.
    FS.rmSync(server.libraryPath, { recursive: true, force: true });

    const message = await expectTaskFailure(client, 'SCAN');
    expect(message).to.include('Unable to read library path');

    // Media survive the failed scan.
    expect(await subset(client, {})).to.have.lengthOf(13);
  });

  it('SCAN fails when the walk finds no files while media exist', async () => {
    // Simulates a move/mount pointing DATA_PATH at an empty directory.
    FS.mkdirSync(server.libraryPath, { recursive: true });

    const message = await expectTaskFailure(client, 'SCAN');
    expect(message).to.include('found no files');

    expect(await subset(client, {})).to.have.lengthOf(13);
  });
});

// Files under a directory the walk cannot read must fail the scan outright:
// treating them as absent is how a wipe gets armed (see issue #129).
describe('SCAN with an unreadable subdirectory', () => {
  let server: ApiServer;
  let client: ApiClient;

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);
  });

  after(async () => {
    await server?.stop();
  });

  it('fails the scan instead of reporting the subtree as missing', async () => {
    const blockedDir = `${server.libraryPath}/nested`;
    try {
      await createStill(server.libraryPath, 'red.png', 'red');
      await createStill(server.libraryPath, 'nested/hidden.png', 'blue');
      await runTaskAndWait(client, 'AUTO-IMPORT');

      FS.chmodSync(blockedDir, 0o000);
      const message = await expectTaskFailure(client, 'SCAN');
      expect(message).to.include('could not read');
      expect(message).to.include('nested');

      // Media survive the failed scan.
      expect(await subset(client, {})).to.have.lengthOf(2);
    } finally {
      // The stop teardown deletes the fixture tree and needs the permission
      // back regardless of the outcome.
      FS.chmodSync(blockedDir, 0o755);
    }
  });
});
