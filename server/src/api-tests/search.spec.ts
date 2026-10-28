import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  createStill,
  createVideo,
  detail,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

// Locks the /api/images/subset search contract: filter semantics, forced
// defaults (corrupted/indexed/duplicateOf), sorting, limit and sample.
describe('Search API', () => {
  let server: ApiServer;
  let client: ApiClient;
  // path name → hash
  const byName: Record<string, string> = {};
  const all = (): string[] => Object.values(byName);

  const findHash = async (needle: string): Promise<string> => {
    const results = await subset(client, { path: { likeAny: [needle] } });
    expect(results).to.have.lengthOf(1);
    return results[0];
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'alpha.png', 'red');
    await createStill(server.libraryPath, 'beta.png', 'green');
    await createStill(server.libraryPath, 'gamma.png', 'blue');
    await createStill(server.libraryPath, 'delta.png', 'yellow');
    await createStill(server.libraryPath, 'nested/epsilon.png', 'purple');
    await createVideo(server.libraryPath, 'clip.mp4', { duration: 2 });
    await runTaskAndWait(client, 'AUTO-IMPORT');

    for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'clip']) {
      byName[name] = await findHash(name);
    }

    // Tags, actors and ratings to filter and sort against.
    for (const tag of ['mountains', 'beach']) {
      assertOk(await client.post<string[]>('/api/tags', { tag }), 'POST /api/tags');
    }
    await client.post(`/api/images/${byName['alpha']}/tags`, { name: 'mountains' });
    await client.post(`/api/images/${byName['beta']}/tags`, { name: 'mountains' });
    await client.post(`/api/images/${byName['beta']}/tags`, { name: 'beach' });
    await client.post(`/api/images/${byName['gamma']}/tags`, { name: 'beach' });
    await client.post(`/api/images/${byName['epsilon']}/tags`, { name: 'mountains' });

    assertOk(await client.post<string[]>('/api/actors', { actor: 'alice' }), 'POST /api/actors');
    await client.post(`/api/images/${byName['epsilon']}/actors`, { name: 'alice' });

    const ratings: Record<string, number> = { alpha: 5, beta: 3, gamma: 1, delta: 2, epsilon: 4, clip: 0 };
    for (const [name, rating] of Object.entries(ratings)) {
      assertOk(await client.patch(`/api/images/${byName[name]}`, { rating }), `PATCH /api/images/${byName[name]}`);
    }
  });

  after(async () => {
    await server.stop();
  });

  it('returns the full library for empty constraints', async () => {
    expect(await subset(client, {})).to.have.members(all());
  });

  describe('Array filters', () => {
    it('tags equalsAny', async () => {
      expect(await subset(client, { tags: { equalsAny: ['mountains'] } })).to.have.members([
        byName['alpha'],
        byName['beta'],
        byName['epsilon'],
      ]);
    });

    it('tags equalsAll', async () => {
      expect(await subset(client, { tags: { equalsAll: ['mountains', 'beach'] } })).to.deep.equal([byName['beta']]);
    });

    it('tags equalsNone', async () => {
      expect(await subset(client, { tags: { equalsNone: ['beach'] } })).to.have.members([
        byName['alpha'],
        byName['delta'],
        byName['epsilon'],
        byName['clip'],
      ]);
    });

    it('tags exists false', async () => {
      expect(await subset(client, { tags: { exists: false } })).to.have.members([byName['delta'], byName['clip']]);
    });

    it('actors equalsAny', async () => {
      expect(await subset(client, { actors: { equalsAny: ['alice'] } })).to.deep.equal([byName['epsilon']]);
    });

    it('actors exists false', async () => {
      expect(await subset(client, { actors: { exists: false } })).to.have.members(
        all().filter((hash) => hash !== byName['epsilon']),
      );
    });

    it('type equalsAny', async () => {
      expect(await subset(client, { type: { equalsAny: ['video'] } })).to.deep.equal([byName['clip']]);
    });

    it('type exists false matches nothing (every media has a type)', async () => {
      expect(await subset(client, { type: { exists: false } })).to.deep.equal([]);
    });
  });

  describe('String filters', () => {
    it('hash equalsAny', async () => {
      expect(await subset(client, { hash: { equalsAny: [byName['alpha'], byName['clip']] } })).to.have.members([
        byName['alpha'],
        byName['clip'],
      ]);
    });

    it('hash equalsAll', async () => {
      expect(await subset(client, { hash: { equalsAll: [byName['alpha']] } })).to.deep.equal([byName['alpha']]);
    });

    it('hash equalsAny with unknown hashes', async () => {
      expect(await subset(client, { hash: { equalsAny: ['no-such-hash'] } })).to.deep.equal([]);
    });

    it('path likeAny is case-insensitive', async () => {
      expect(await subset(client, { path: { likeAny: ['ALPHA'] } })).to.deep.equal([byName['alpha']]);
    });

    it('dir likeAny', async () => {
      expect(await subset(client, { dir: { likeAny: ['nested'] } })).to.deep.equal([byName['epsilon']]);
    });
  });

  describe('Number filters', () => {
    it('rating min', async () => {
      expect(await subset(client, { rating: { min: 2 } })).to.have.members([
        byName['alpha'],
        byName['beta'],
        byName['delta'],
        byName['epsilon'],
      ]);
    });

    it('rating max', async () => {
      expect(await subset(client, { rating: { max: 2 } })).to.have.members([
        byName['gamma'],
        byName['delta'],
        byName['clip'],
      ]);
    });

    it('rating equalsAny', async () => {
      expect(await subset(client, { rating: { equalsAny: [5, 0] } })).to.have.members([
        byName['alpha'],
        byName['clip'],
      ]);
    });

    it('length filters match videos only', async () => {
      expect(await subset(client, { length: { min: 1 } })).to.deep.equal([byName['clip']]);
      expect(await subset(client, { length: { max: 1 } })).to.deep.equal([]);
    });

    it('quality filters', async () => {
      expect(await subset(client, { quality: { min: 100_000 } })).to.deep.equal([]);
      expect(await subset(client, { quality: { max: 100_000 } })).to.have.members(all());
    });
  });

  describe('Boolean filters', () => {
    it('thumbnail true matches imported stills and videos', async () => {
      expect(await subset(client, { thumbnail: true })).to.have.members(all());
    });

    it('thumbnail false matches nothing (thumbnails were generated)', async () => {
      expect(await subset(client, { thumbnail: false })).to.deep.equal([]);
    });

    it('a forced corrupted: false override ignores the requested constraint', async () => {
      // The route overwrites constraints.corrupted = false after parsing, so
      // requesting corrupted media is silently ignored and everything is
      // returned. Locked to pin that behaviour.
      expect(await subset(client, { corrupted: true })).to.have.members(all());
    });
  });

  describe('Full-text search', () => {
    it('matches on tags', async () => {
      expect(await subset(client, { keywordSearch: 'mountains' })).to.have.members([
        byName['alpha'],
        byName['beta'],
        byName['epsilon'],
      ]);
    });

    it('matches on actors', async () => {
      expect(await subset(client, { keywordSearch: 'alice' })).to.deep.equal([byName['epsilon']]);
    });

    it('matches on path tokens', async () => {
      expect(await subset(client, { keywordSearch: 'delta' })).to.deep.equal([byName['delta']]);
    });

    it('matches on type', async () => {
      expect(await subset(client, { keywordSearch: 'video' })).to.deep.equal([byName['clip']]);
    });

    it('matches on titles set through PATCH', async () => {
      assertOk(
        await client.patch(`/api/images/${byName['delta']}`, { metadata: { title: 'Golden Hour' } }),
        'PATCH /api/images/:hash',
      );
      expect(await subset(client, { keywordSearch: 'golden' })).to.deep.equal([byName['delta']]);
    });

    it('ANDs filters with the keyword search', async () => {
      expect(await subset(client, { keywordSearch: 'mountains', tags: { equalsAll: ['beach'] } })).to.deep.equal([
        byName['beta'],
      ]);
    });

    it('returns nothing for unknown terms', async () => {
      expect(await subset(client, { keywordSearch: 'zzzznope' })).to.deep.equal([]);
    });
  });

  describe('Sorting and paging', () => {
    it('sortBy rating defaults to descending', async () => {
      expect(await subset(client, { sortBy: 'rating' })).to.deep.equal([
        byName['alpha'],
        byName['epsilon'],
        byName['beta'],
        byName['delta'],
        byName['gamma'],
        byName['clip'],
      ]);
    });

    it('sortBy rating with explicit ASC reverses the order', async () => {
      const descending = await subset(client, { sortBy: 'rating', sortDirection: 'DESC' });
      const ascending = await subset(client, { sortBy: 'rating', sortDirection: 'ASC' });
      expect(ascending).to.deep.equal(descending.slice().reverse());
    });

    it('sortBy path with explicit directions', async () => {
      const asc = await subset(client, { sortBy: 'path', sortDirection: 'ASC' });
      expect(asc[0]).to.equal(byName['alpha']);
      expect(asc[asc.length - 1]).to.equal(byName['epsilon']);
      const desc = await subset(client, { sortBy: 'path', sortDirection: 'DESC' });
      expect(desc).to.deep.equal(asc.slice().reverse());
    });

    it('limit truncates a sorted result', async () => {
      expect(await subset(client, { sortBy: 'rating', limit: 2 })).to.deep.equal([byName['alpha'], byName['epsilon']]);
    });

    it('sample returns a subset of the library', async () => {
      const sample = await subset(client, { sample: 3 });
      expect(sample).to.have.lengthOf(3);
      for (const hash of sample) {
        expect(all()).to.include(hash);
      }
    });

    it('sample larger than the library returns the whole library', async () => {
      const sample = await subset(client, { sample: 100 });
      expect(sample).to.have.lengthOf(6);
      expect(sample).to.have.members(all());
    });
  });

  it('unknown hash detail lookups stay 404', async () => {
    const response = await client.get('/api/images/no-such-hash');
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
  });

  it('detail reflects rating and metadata set earlier in this suite', async () => {
    const media = await detail(client, byName['alpha']);
    expect(media.rating).to.equal(5);
    expect(media.tags.sort()).to.deep.equal(['mountains']);
  });
});
