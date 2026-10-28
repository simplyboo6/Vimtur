import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  createStill,
  detail,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

describe('Tags API', () => {
  let server: ApiServer;
  let client: ApiClient;
  let alpha: string;
  let beta: string;
  let gamma: string;

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'alpha.png', 'red');
    await createStill(server.libraryPath, 'beta.png', 'green');
    await createStill(server.libraryPath, 'gamma.png', 'blue');
    await runTaskAndWait(client, 'AUTO-IMPORT');

    alpha = (await detail(client, (await subset(client, { path: { likeAny: ['alpha'] } }))[0])).hash;
    beta = (await detail(client, (await subset(client, { path: { likeAny: ['beta'] } }))[0])).hash;
    gamma = (await detail(client, (await subset(client, { path: { likeAny: ['gamma'] } }))[0])).hash;
  });

  after(async () => {
    await server.stop();
  });

  it('starts with no tags', async () => {
    const tags = assertOk(await client.get<string[]>('/api/tags'), 'GET /api/tags');
    expect(tags).to.deep.equal([]);
  });

  it('creates tags and returns the full list', async () => {
    const tags = assertOk(await client.post<string[]>('/api/tags', { tag: 'landscape' }), 'POST /api/tags');
    expect(tags).to.deep.equal(['landscape']);
  });

  it('lists tags', async () => {
    await client.post<string[]>('/api/tags', { tag: 'portrait' });
    const tags = assertOk(await client.get<string[]>('/api/tags'), 'GET /api/tags');
    expect(tags.sort()).to.deep.equal(['landscape', 'portrait']);
  });

  it('attaches tags to media and reflects them in detail', async () => {
    const response = await client.post(`/api/images/${alpha}/tags`, { name: 'landscape' });
    expect(response.status).to.equal(204);

    const media = await detail(client, alpha);
    expect(media.tags).to.deep.equal(['landscape']);
  });

  it('supports multiple tags per media', async () => {
    await client.post(`/api/images/${alpha}/tags`, { name: 'portrait' });
    const media = await detail(client, alpha);
    expect(media.tags.sort()).to.deep.equal(['landscape', 'portrait']);
  });

  it('searches by tag with equalsAny', async () => {
    await client.post(`/api/images/${beta}/tags`, { name: 'landscape' });
    expect(await subset(client, { tags: { equalsAny: ['landscape'] } }).then((r) => r.sort())).to.deep.equal(
      [alpha, beta].sort(),
    );
  });

  it('searches by tag with equalsAll', async () => {
    expect(await subset(client, { tags: { equalsAll: ['landscape', 'portrait'] } })).to.deep.equal([alpha]);
  });

  it('searches by tag with equalsNone', async () => {
    const results = await subset(client, { tags: { equalsNone: ['landscape'] } });
    expect(results).to.include(gamma);
    expect(results).to.not.include(alpha);
    expect(results).to.not.include(beta);
  });

  it('searches for untagged media with exists: false', async () => {
    const results = await subset(client, { tags: { exists: false } });
    expect(results).to.deep.equal([gamma]);
  });

  it('detaches a tag from media', async () => {
    const response = await client.delete(`/api/images/${alpha}/tags/portrait`);
    expect(response.status).to.equal(204);
    const media = await detail(client, alpha);
    expect(media.tags).to.deep.equal(['landscape']);
  });

  it('deleting a global tag removes it from every media', async () => {
    const tags = assertOk(await client.delete<string[]>('/api/tags/landscape'), 'DELETE /api/tags/landscape');
    expect(tags).to.deep.equal(['portrait']);

    const alphaMedia = await detail(client, alpha);
    expect(alphaMedia.tags).to.deep.equal([]);
    const betaMedia = await detail(client, beta);
    expect(betaMedia.tags).to.deep.equal([]);
  });

  it('deleting an unknown tag is a no-op', async () => {
    const tags = assertOk(await client.delete<string[]>('/api/tags/does-not-exist'), 'DELETE /api/tags/<unknown>');
    expect(tags).to.deep.equal(['portrait']);
  });

  it('rejects tag creation without a tag', async () => {
    const response = await client.post('/api/tags', {});
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('rejects tag attachment without a name', async () => {
    const response = await client.post(`/api/images/${alpha}/tags`, {});
    expect(response.status).to.equal(400);
  });

  it('attaching a tag that does not exist is a 404', async () => {
    const response = await client.post(`/api/images/${gamma}/tags`, { name: 'does-not-exist' });
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
    expect(String((response.data as { message: string }).message)).to.include('No tag found');

    // Neither the global tag nor an attachment was created.
    const tags = assertOk(await client.get<string[]>('/api/tags'), 'GET /api/tags');
    expect(tags).to.not.include('does-not-exist');
    const media = await detail(client, gamma);
    expect(media.tags).to.not.include('does-not-exist');
  });

  it('attaching to unknown media is a 404', async () => {
    const response = await client.post('/api/images/unknown-hash/tags', { name: 'nope' });
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
  });
});
