import type { InsightsResponse } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ApiClient, type ApiServer, assertOk, createStill, runTaskAndWait, startServer } from './harness';

// /api/insights only reports an entry once at least MIN_COUNT_FOR_AVERAGE (20)
// rated media share a token, and drops near-zero averages, so a meaningful
// response needs a bulk library.
describe('Insights API', () => {
  let server: ApiServer;
  let client: ApiClient;
  // Imported hashes, deterministically ordered (sorted) so tag/rating loops
  // below address distinct media reliably.
  let bulkHashes: string[] = [];

  const COUNT = 24;

  // Distinct colours AND sizes: identical files hash identically and collapse
  // into a single media entry, and 6 colour variants alone would only yield 6
  // distinct hashes.
  const COLORS = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan'];

  const importBulk = async (): Promise<void> => {
    for (let i = 0; i < COUNT; i++) {
      await createStill(server.libraryPath, `bulk-${i}.png`, COLORS[i % COLORS.length], 16 + i);
    }
    await runTaskAndWait(client, 'AUTO-IMPORT');
    bulkHashes = assertOk(
      await client.post<string[]>('/api/images/subset', {}),
      'POST /api/images/subset',
    ).sort();
    expect(bulkHashes).to.have.lengthOf(COUNT);
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);
  });

  after(async () => {
    await server.stop();
  });

  it('returns an empty list for an empty library', async () => {
    const insights = assertOk(await client.get<InsightsResponse>('/api/insights'), 'GET /api/insights');
    expect(insights).to.deep.equal([]);
  });

  it('returns nothing when media exist but nothing is rated', async () => {
    await importBulk();
    const insights = assertOk(await client.get<InsightsResponse>('/api/insights'), 'GET /api/insights');
    expect(insights).to.deep.equal([]);
  });

  it('aggregates ratings per shared tag once enough media are rated', async () => {
    assertOk(await client.post<string[]>('/api/tags', { tag: 'bulk' }), 'POST /api/tags');
    for (const hash of bulkHashes.slice(0, 22)) {
      await client.post(`/api/images/${hash}/tags`, { name: 'bulk' });
      await client.patch(`/api/images/${hash}`, { rating: 5 });
    }

    const insights = assertOk(await client.get<InsightsResponse>('/api/insights'), 'GET /api/insights');
    // 22 media rated 5 → mapped rating (5-3)/2 = 1 → average 1, count 22.
    // The media type ('still') is also a scored token, so it appears too.
    expect(insights.map((entry) => entry.name).sort()).to.deep.equal(['bulk', 'still']);
    const bulk = insights.find((entry) => entry.name === 'bulk')!;
    expect(bulk.count).to.equal(22);
    expect(bulk.average).to.be.closeTo(1, 0.001);
  });

  it('drops tags below the count threshold', async () => {
    // 19 ratings for a fresh tag is under the minimum of 20.
    assertOk(await client.post<string[]>('/api/tags', { tag: 'sparse' }), 'POST /api/tags');
    for (const hash of bulkHashes.slice(0, 19)) {
      await client.post(`/api/images/${hash}/tags`, { name: 'sparse' });
    }
    await client.patch<number>('/api/images/bulk-update', {
      constraints: { tags: { equalsAny: ['sparse'] } },
      update: { rating: 1 },
    });

    const insights = assertOk(await client.get<InsightsResponse>('/api/insights'), 'GET /api/insights');
    expect(insights.map((entry) => entry.name).sort()).to.deep.equal(['bulk', 'still']);
  });
});
