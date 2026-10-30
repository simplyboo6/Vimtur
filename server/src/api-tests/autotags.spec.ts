import { expect } from 'chai';
import { describe } from 'mocha';

import { ApiClient, type ApiServer, createStill, detail, runTaskAndWait, startServer, subset } from './harness';

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

  it('RESET-AUTOTAGS removes them and their keyword matches', async function (this: Mocha.Context) {
    this.timeout(60_000);
    await runTaskAndWait(client, 'RESET-AUTOTAGS');
    expect((await detail(client, stillHash)).autoTags).to.equal(undefined);
    expect(await subset(client, { keywordSearch: 'tabby' })).to.deep.equal([]);
  });
});
