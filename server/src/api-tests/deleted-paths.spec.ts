import FS from 'fs';
import Path from 'path';

import type { DeletedMedia, Media } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  assertStatus,
  createStill,
  detail,
  expectScanPending,
  runTaskAndWait,
  scanState,
  startServer,
  subset,
} from './harness';

// The deleted-paths surface (#65): deleting media keeps the source file unless
// `deleteFile=true` is asked for, records the path in the import ignore list, and
// that list is readable and removable over HTTP. SCAN ignores recorded paths and
// INDEX ignores recorded hashes (adding the new path it saw), so the pair is what
// keeps a soft-deleted file out of the library without touching the file.
describe('Deleted paths API', () => {
  let server: ApiServer;
  let client: ApiClient;
  let redHash: string;

  const deletedPaths = async (): Promise<DeletedMedia[]> =>
    assertOk(await client.get<DeletedMedia[]>('/api/deleted'), 'GET /api/deleted');

  const hashFor = async (needle: string): Promise<string> => {
    const hashes = await subset(client, { path: { likeAny: [needle] } });
    expect(hashes, `media matching ${needle}`).to.have.lengthOf(1);
    return hashes[0];
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'red.png', 'red');
    await createStill(server.libraryPath, 'blue.png', 'blue');
    await createStill(server.libraryPath, 'green.png', 'green');
    await createStill(server.libraryPath, 'master.png', 'orange');
    await createStill(server.libraryPath, 'alt.png', 'purple');
    await runTaskAndWait(client, 'AUTO-IMPORT');
  });

  after(async () => {
    await server?.stop();
  });

  it('starts with no ignored paths', async () => {
    expect(await deletedPaths()).to.deep.equal([]);
  });

  it('keeps the source file by default and records its path', async () => {
    redHash = await hashFor('red.png');

    assertStatus(await client.delete(`/api/images/${redHash}`), 204, 'DELETE /api/images/:hash');

    expect(FS.existsSync(Path.join(server.libraryPath, 'red.png')), 'source file kept on disk').to.equal(true);
    expect((await client.get(`/api/images/${redHash}`)).status).to.equal(404);
    expect(await deletedPaths()).to.deep.equal([{ hash: redHash, path: 'red.png' }]);
  });

  it('ignores the kept file on the next scan', async () => {
    await runTaskAndWait(client, 'SCAN');
    await expectScanPending(client, 0, 0);
  });

  it('records a new path when the ignored content appears somewhere else', async () => {
    FS.copyFileSync(Path.join(server.libraryPath, 'red.png'), Path.join(server.libraryPath, 'copy-red.png'));

    await runTaskAndWait(client, 'SCAN');
    expect((await scanState(client))?.newPaths).to.deep.equal(['copy-red.png']);

    // INDEX hashes the copy, recognises the ignored hash and records the path
    // instead of importing the file.
    await runTaskAndWait(client, 'INDEX');
    expect(await subset(client, { path: { likeAny: ['copy-red'] } })).to.deep.equal([]);
    expect(await deletedPaths()).to.deep.equal([
      { hash: redHash, path: 'copy-red.png' },
      { hash: redHash, path: 'red.png' },
    ]);
  });

  it('ignores every recorded path for that hash on later scans', async () => {
    await runTaskAndWait(client, 'SCAN');
    await expectScanPending(client, 0, 0);
  });

  it('re-imports the content from any recorded path once the hash is un-ignored', async () => {
    assertStatus(await client.delete(`/api/deleted/${redHash}`), 204, 'DELETE /api/deleted/:hash');
    expect(await deletedPaths()).to.deep.equal([]);

    await runTaskAndWait(client, 'SCAN');
    const newPaths = (await scanState(client))?.newPaths ?? [];
    expect([...newPaths].sort()).to.deep.equal(['copy-red.png', 'red.png']);

    await runTaskAndWait(client, 'INDEX');
    // Both paths hash to the same media row, so whichever INDEX writes last wins:
    // the content is back once, under one of its paths.
    const restored = await detail(client, redHash);
    expect(['copy-red.png', 'red.png']).to.include(restored.path);
    expect(await subset(client, {})).to.have.lengthOf(5);
  });

  it('deletes the source file when deleteFile=true is requested', async () => {
    const hash = await hashFor('blue.png');

    assertStatus(await client.delete(`/api/images/${hash}?deleteFile=true`), 204, 'DELETE with deleteFile=true');

    expect(FS.existsSync(Path.join(server.libraryPath, 'blue.png')), 'source file removed').to.equal(false);
    expect(await deletedPaths()).to.deep.equal([{ hash, path: 'blue.png' }]);
  });

  it('accepts an explicit deleteFile=false', async () => {
    const hash = await hashFor('green.png');

    assertStatus(await client.delete(`/api/images/${hash}?deleteFile=false`), 204, 'DELETE with deleteFile=false');

    expect(FS.existsSync(Path.join(server.libraryPath, 'green.png')), 'source file kept on disk').to.equal(true);
  });

  it('rejects an invalid deleteFile value', async () => {
    const hash = await hashFor('master.png');
    const response = await client.delete<{ message: string }>(`/api/images/${hash}?deleteFile=yes`);

    assertStatus(response, 400, 'DELETE with an invalid deleteFile');
    expect((response.data as { message: string }).message).to.equal('deleteFile must be true or false');
  });

  it('rejects a repeated deleteFile parameter', async () => {
    const hash = await hashFor('master.png');
    const response = await client.delete(`/api/images/${hash}?deleteFile=true&deleteFile=false`);

    assertStatus(response, 400, 'DELETE with a repeated deleteFile');
    // The rejected request left the media and its file alone.
    expect((await client.get(`/api/images/${hash}`)).status).to.equal(200);
    expect(FS.existsSync(Path.join(server.libraryPath, 'master.png'))).to.equal(true);
  });

  it('removes an unknown ignored hash as a no-op', async () => {
    assertStatus(await client.delete('/api/deleted/unknown-hash'), 204, 'DELETE /api/deleted/unknown-hash');
    // The config page renders groups in received order, so this is the display
    // contract: hash-major sorting is what makes the list stable, while a
    // path-major sort only happens to agree while every entry shares a hash.
    const rows = await deletedPaths();
    expect(rows).to.have.lengthOf(2);
    const hashes = rows.map((row) => row.hash);
    expect(hashes).to.deep.equal([...hashes].sort((a, b) => a.localeCompare(b)));
  });

  // Clone resolution shares deleteMedia's cache teardown and the media rows this
  // feature touches, so pin that a soft delete leaves the resolver's contract
  // intact: the parent still resolves the deleted clone by hash.
  it('still resolves clones after the clone is soft-deleted', async () => {
    const masterHash = await hashFor('master.png');
    const altHash = await hashFor('alt.png');
    assertOk(await client.patch<Media>(`/api/images/${masterHash}`, { clones: [altHash] }), 'PATCH clones');

    assertStatus(await client.delete(`/api/images/${altHash}`), 204, 'DELETE the clone');
    expect(FS.existsSync(Path.join(server.libraryPath, 'alt.png')), 'clone source file kept').to.equal(true);
    expect((await client.get(`/api/images/${altHash}`)).status).to.equal(404);

    assertStatus(
      await client.post(`/api/images/${masterHash}/resolve`, { aliases: [], unrelated: [altHash] }),
      204,
      'POST /api/images/:hash/resolve',
    );

    const resolved = await detail(client, masterHash);
    expect(resolved.clones).to.deep.equal([]);
    expect(resolved.unrelated).to.deep.equal([altHash]);
  });
});
