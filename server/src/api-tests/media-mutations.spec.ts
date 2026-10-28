import type { Media } from '@vimtur/common';
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

describe('Media mutations API', () => {
  let server: ApiServer;
  let client: ApiClient;
  let one: string;
  let two: string;
  let three: string;

  const findHash = async (needle: string): Promise<string> => {
    const hashes = await subset(client, { path: { likeAny: [needle] } });
    expect(hashes).to.have.lengthOf(1);
    return hashes[0];
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'one.png', 'red');
    await createStill(server.libraryPath, 'two.png', 'green');
    await createStill(server.libraryPath, 'three.png', 'blue');
    await runTaskAndWait(client, 'AUTO-IMPORT');

    one = await findHash('one');
    two = await findHash('two');
    three = await findHash('three');
  });

  after(async () => {
    await server?.stop();
  });

  it('PATCH updates a rating and returns the updated media', async () => {
    const updated = assertOk(await client.patch<Media>(`/api/images/${one}`, { rating: 3 }), 'PATCH /api/images/:hash');
    expect(updated.rating).to.equal(3);
    expect(updated.hash).to.equal(one);

    const media = await detail(client, one);
    expect(media.rating).to.equal(3);
  });

  it('PATCH updates metadata fields', async () => {
    assertOk(
      await client.patch<Media>(`/api/images/${one}`, { metadata: { title: 'A Title', artist: 'An Artist' } }),
      'PATCH /api/images/:hash',
    );
    const media = await detail(client, one);
    expect(media.metadata?.title).to.equal('A Title');
    expect(media.metadata?.artist).to.equal('An Artist');
    // Existing metadata fields survive the update.
    expect(media.metadata?.width).to.equal(64);
  });

  it('PATCH rejects invalid update bodies', async () => {
    const response = await client.patch(`/api/images/${one}`, { rating: 'not-a-number' });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('PATCH with an empty update object is a 400', async () => {
    const response = await client.patch(`/api/images/${one}`, {});
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('PATCH with an empty metadata object is a 400', async () => {
    // An empty metadata sub-object passes the all-optional schema but maps to
    // no writable column; it is rejected rather than failing in the connector.
    const response = await client.patch(`/api/images/${one}`, { metadata: {} });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('PATCH accepts meaningful falsy values', async () => {
    // Zero, false and empty arrays are real updates (they clear/set fields),
    // unlike empty objects.
    const updated = assertOk(
      await client.patch<Media>(`/api/images/${one}`, { rating: 0 }),
      'PATCH /api/images/:hash',
    );
    expect(updated.rating).to.equal(0);

    const cleared = assertOk(
      await client.patch<Media>(`/api/images/${one}`, { rating: 3 }),
      'PATCH /api/images/:hash',
    );
    expect(cleared.rating).to.equal(3);
  });

  it('PATCH on an unknown hash is a 404', async () => {
    const response = await client.patch('/api/images/unknown-hash-mutations', { rating: 1 });
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
    // The failed mutation must not have created a partial record.
    expect(await client.get('/api/images/unknown-hash-mutations')).to.have.property('status', 404);
  });

  it('bulk-update applies an update to all matching media and reports the count', async () => {
    const count = assertOk(
      await client.patch<number>('/api/images/bulk-update', {
        constraints: { hash: { equalsAny: [one, two] } },
        update: { rating: 4 },
      }),
      'PATCH /api/images/bulk-update',
    );
    expect(count).to.equal(2);

    expect((await detail(client, one)).rating).to.equal(4);
    expect((await detail(client, two)).rating).to.equal(4);
    expect((await detail(client, three)).rating).to.equal(undefined);
  });

  it('bulk-update with no matching media reports 0', async () => {
    const count = assertOk(
      await client.patch<number>('/api/images/bulk-update', {
        constraints: { hash: { equalsAny: ['no-such-hash'] } },
        update: { rating: 0 },
      }),
      'PATCH /api/images/bulk-update',
    );
    expect(count).to.equal(0);
  });

  it('bulk-update honours tag constraints', async () => {
    assertOk(await client.post<string[]>('/api/tags', { tag: 'bulk-tag' }), 'POST /api/tags');
    assertOk(await client.post(`/api/images/${one}/tags`, { name: 'bulk-tag' }), 'POST /api/images/:hash/tags');

    const count = assertOk(
      await client.patch<number>('/api/images/bulk-update', {
        constraints: { tags: { equalsAny: ['bulk-tag'] } },
        update: { rating: 2 },
      }),
      'PATCH /api/images/bulk-update',
    );
    expect(count).to.equal(1);

    expect((await detail(client, one)).rating).to.equal(2);
    expect((await detail(client, two)).rating).to.equal(4);
  });

  it('bulk-update with empty constraints matches everything', async () => {
    const count = assertOk(
      await client.patch<number>('/api/images/bulk-update', {
        constraints: {},
        update: { rating: 1 },
      }),
      'PATCH /api/images/bulk-update',
    );
    expect(count).to.equal(3);
  });

  it('bulk-update with an empty update object is a 400', async () => {
    // The UpdateMedia schema is all-optional, so an empty update object is
    // rejected explicitly instead of failing deep in the query builders.
    const response = await client.patch('/api/images/bulk-update', { constraints: {}, update: {} });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('bulk-update with an update of only empty objects is a 400', async () => {
    const response = await client.patch('/api/images/bulk-update', {
      constraints: { hash: { equalsAny: [one] } },
      update: { metadata: {} },
    });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('bulk-update rejects a missing update key', async () => {
    const response = await client.patch('/api/images/bulk-update', { constraints: {} });
    expect(response.status).to.equal(400);
  });

  // These tests form a scripted sequence: the clone-resolution block below
  // depends on state set by the tests above it. Mocha runs this file in
  // declaration order; do not use .only here.
  describe('Clone resolution', () => {
    it('rejects resolution without clones', async () => {
      const response = await client.post(`/api/images/${three}/resolve`, { aliases: [], unrelated: [] });
      expect(response.status).to.equal(400);
    });

    it('marks aliases as duplicates of the master', async () => {
      // Pretend pHash matched one and two.
      assertOk(await client.patch<Media>(`/api/images/${one}`, { clones: [two] }), 'PATCH /api/images/:hash');

      const response = await client.post(`/api/images/${one}/resolve`, { aliases: [two], unrelated: [three] });
      expect(response.status).to.equal(204);

      const alias = await detail(client, two);
      expect(alias.duplicateOf).to.equal(one);
      expect(alias.clones).to.equal(undefined);

      const master = await detail(client, one);
      expect(master.clones).to.deep.equal([]);
      expect(master.unrelated).to.deep.equal([three]);
    });

    it('rejects resolutions that do not account for all clones', async () => {
      assertOk(await client.patch<Media>(`/api/images/${three}`, { clones: [one, two] }), 'PATCH /api/images/:hash');
      const response = await client.post(`/api/images/${three}/resolve`, { aliases: [one], unrelated: [] });
      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('message');
    });

    it('duplicates are excluded from default searches', async () => {
      const results = await subset(client, {});
      expect(results).to.include(one);
      expect(results).to.include(three);
      expect(results).to.not.include(two);
    });

    it('resolving on unknown media is a 404', async () => {
      const response = await client.post('/api/images/unknown-hash-resolve/resolve', {
        aliases: [],
        unrelated: [],
      });
      expect(response.status).to.equal(404);
    });
  });
});

// The rest of this file (and suite) runs every server against ':memory:' —
// a single SQLite worker with no WAL. Production ships a file-backed
// multi-worker database, so this block re-runs the mutation-heavy flows
// against that configuration, which is the one that can expose worker-queue
// races.
describe('Media mutations API (file-backed database)', () => {
  let fileServer: ApiServer;
  let fileClient: ApiClient;
  let alpha: string;
  let beta: string;

  before(async () => {
    fileServer = await startServer({ dbMode: 'file' });
    fileClient = new ApiClient(fileServer.baseUrl);

    await createStill(fileServer.libraryPath, 'file-alpha.png', 'red');
    await createStill(fileServer.libraryPath, 'file-beta.png', 'green');
    await runTaskAndWait(fileClient, 'AUTO-IMPORT');

    const hashes = await subset(fileClient, {});
    expect(hashes).to.have.lengthOf(2);
    const alphaHashes = await subset(fileClient, { path: { likeAny: ['alpha'] } });
    expect(alphaHashes).to.have.lengthOf(1);
    alpha = (await detail(fileClient, alphaHashes[0])).hash;
    const betaHashes = await subset(fileClient, { path: { likeAny: ['beta'] } });
    expect(betaHashes).to.have.lengthOf(1);
    beta = (await detail(fileClient, betaHashes[0])).hash;
  });

  after(async () => {
    await fileServer?.stop();
  });

  it('PATCH updates a rating and survives a re-read', async () => {
    assertOk(await fileClient.patch<Media>(`/api/images/${alpha}`, { rating: 4 }), 'PATCH /api/images/:hash');
    expect((await detail(fileClient, alpha)).rating).to.equal(4);
  });

  it('PATCH with an empty update object is a 400', async () => {
    const response = await fileClient.patch(`/api/images/${alpha}`, {});
    expect(response.status).to.equal(400);
  });

  it('PATCH on an unknown hash is a 404', async () => {
    const response = await fileClient.patch('/api/images/unknown-hash-file-mode', { rating: 1 });
    expect(response.status).to.equal(404);
  });

  it('bulk-update applies to matching media', async () => {
    const count = assertOk(
      await fileClient.patch<number>('/api/images/bulk-update', {
        constraints: { hash: { equalsAny: [alpha, beta] } },
        update: { rating: 1 },
      }),
      'PATCH /api/images/bulk-update',
    );
    expect(count).to.equal(2);
  });

  it('attaching a pre-created tag works and attaching an unknown tag is a 404', async () => {
    assertOk(await fileClient.post<string[]>('/api/tags', { tag: 'file-mode-tag' }), 'POST /api/tags');
    expect(await fileClient.post(`/api/images/${alpha}/tags`, { name: 'file-mode-tag' })).to.have.property(
      'status',
      204,
    );

    const response = await fileClient.post(`/api/images/${alpha}/tags`, { name: 'never-created' });
    expect(response.status).to.equal(404);
  });
});
