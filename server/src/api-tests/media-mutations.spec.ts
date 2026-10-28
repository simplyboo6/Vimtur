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
    await server.stop();
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

  it('bulk-update rejects a missing update key', async () => {
    const response = await client.patch('/api/images/bulk-update', { constraints: {} });
    expect(response.status).to.equal(400);
  });

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
