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

describe('Actors API', () => {
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
    await server?.stop();
  });

  it('starts with no actors', async () => {
    const actors = assertOk(await client.get<string[]>('/api/actors'), 'GET /api/actors');
    expect(actors).to.deep.equal([]);
  });

  it('creates actors and returns the full list', async () => {
    const actors = assertOk(await client.post<string[]>('/api/actors', { actor: 'alice' }), 'POST /api/actors');
    expect(actors).to.deep.equal(['alice']);
  });

  it('lists actors', async () => {
    await client.post<string[]>('/api/actors', { actor: 'bob' });
    const actors = assertOk(await client.get<string[]>('/api/actors'), 'GET /api/actors');
    expect(actors.sort()).to.deep.equal(['alice', 'bob']);
  });

  it('attaches actors to media and reflects them in detail', async () => {
    const response = await client.post(`/api/images/${alpha}/actors`, { name: 'alice' });
    expect(response.status).to.equal(204);
    const media = await detail(client, alpha);
    expect(media.actors).to.deep.equal(['alice']);
  });

  it('supports multiple actors per media', async () => {
    await client.post(`/api/images/${alpha}/actors`, { name: 'bob' });
    await client.post(`/api/images/${beta}/actors`, { name: 'alice' });
    const media = await detail(client, alpha);
    expect(media.actors.sort()).to.deep.equal(['alice', 'bob']);
  });

  it('searches by actor with equalsAny', async () => {
    expect(await subset(client, { actors: { equalsAny: ['alice'] } }).then((r) => r.sort())).to.deep.equal(
      [alpha, beta].sort(),
    );
  });

  it('searches by actor with equalsNone', async () => {
    const results = await subset(client, { actors: { equalsNone: ['alice'] } });
    expect(results).to.deep.equal([gamma]);
  });

  it('searches for media without actors with exists: false', async () => {
    const results = await subset(client, { actors: { exists: false } });
    expect(results).to.deep.equal([gamma]);
  });

  it('detaches an actor from media', async () => {
    const response = await client.delete(`/api/images/${alpha}/actors/bob`);
    expect(response.status).to.equal(204);
    const media = await detail(client, alpha);
    expect(media.actors).to.deep.equal(['alice']);
  });

  it('deleting a global actor removes it from every media', async () => {
    const actors = assertOk(await client.delete<string[]>('/api/actors/alice'), 'DELETE /api/actors/alice');
    expect(actors).to.deep.equal(['bob']);

    const alphaMedia = await detail(client, alpha);
    expect(alphaMedia.actors).to.deep.equal([]);
    const betaMedia = await detail(client, beta);
    expect(betaMedia.actors).to.deep.equal([]);
  });

  it('deleting an unknown actor is a no-op', async () => {
    const actors = assertOk(
      await client.delete<string[]>('/api/actors/does-not-exist'),
      'DELETE /api/actors/<unknown>',
    );
    expect(actors).to.deep.equal(['bob']);
  });

  it('rejects actor creation without an actor', async () => {
    const response = await client.post('/api/actors', {});
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('rejects actor attachment without a name', async () => {
    const response = await client.post(`/api/images/${alpha}/actors`, {});
    expect(response.status).to.equal(400);
  });

  it('attaching an actor that does not exist is a 404', async () => {
    const response = await client.post(`/api/images/${gamma}/actors`, { name: 'does-not-exist' });
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
    expect(String((response.data as { message: string }).message)).to.include('No actor found');

    // Neither the global actor nor an attachment was created.
    const actors = assertOk(await client.get<string[]>('/api/actors'), 'GET /api/actors');
    expect(actors).to.not.include('does-not-exist');
    const media = await detail(client, gamma);
    expect(media.actors).to.not.include('does-not-exist');
  });

  it('attaching to unknown media is a 404', async () => {
    const response = await client.post('/api/images/unknown-hash/actors', { name: 'nope' });
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
  });
});
