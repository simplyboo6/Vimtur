import type { MediaPlaylist, Playlist } from '@vimtur/common';
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

describe('Playlists API', () => {
  let server: ApiServer;
  let client: ApiClient;
  let hashes: string[]; // alpha, beta, gamma, delta in import order
  let playlistA: Playlist;
  let playlistB: Playlist;

  const findHash = async (needle: string): Promise<string> => {
    const results = await subset(client, { path: { likeAny: [needle] } });
    expect(results).to.have.lengthOf(1);
    return results[0];
  };

  // Returns the playlist-scoped search result, which is ordered by entry order.
  const playlistSubset = async (playlistId: string): Promise<string[]> => {
    return subset(client, { playlist: playlistId });
  };

  const playlistEntries = async (playlistId: string): Promise<MediaPlaylist[]> => {
    const playlists = [];
    for (const hash of await playlistSubset(playlistId)) {
      const media = await detail(client, hash);
      playlists.push(...(media.playlists ?? []).filter((entry) => entry.id === playlistId));
    }
    return playlists;
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'alpha.png', 'red');
    await createStill(server.libraryPath, 'beta.png', 'green');
    await createStill(server.libraryPath, 'gamma.png', 'blue');
    await createStill(server.libraryPath, 'delta.png', 'yellow');
    await runTaskAndWait(client, 'AUTO-IMPORT');

    hashes = [await findHash('alpha'), await findHash('beta'), await findHash('gamma'), await findHash('delta')];
  });

  after(async () => {
    await server.stop();
  });

  it('starts with no playlists', async () => {
    const playlists = assertOk(await client.get<Playlist[]>('/api/playlists'), 'GET /api/playlists');
    expect(playlists).to.deep.equal([]);
  });

  it('creates a playlist with a UUID-style id and zero size', async () => {
    const created = assertOk(await client.post<Playlist>('/api/playlists', { name: 'List A' }), 'POST /api/playlists');
    expect(created.name).to.equal('List A');
    expect(created.size).to.equal(0);
    expect(created.id).to.be.a('string').and.to.have.lengthOf.at.least(8);
  });

  it('rejects playlist creation without a name', async () => {
    const response = await client.post('/api/playlists', {});
    expect(response.status).to.equal(400);
  });

  it('adding media returns the entry id and order, and bumps the size', async () => {
    const listed = assertOk(await client.get<Playlist[]>('/api/playlists'), 'GET /api/playlists');
    expect(listed).to.have.lengthOf(1);
    playlistA = listed[0]!;

    const entry = assertOk(
      await client.put<MediaPlaylist>(`/api/images/${hashes[0]}/playlists/${playlistA.id}`),
      `PUT /api/images/${hashes[0]}/playlists/:id`,
    );
    expect(entry.id).to.equal(playlistA.id);
    expect(entry.order).to.equal(0);

    const afterAdd = assertOk(await client.get<Playlist[]>(`/api/playlists`), 'GET /api/playlists');
    expect(afterAdd[0].size).to.equal(1);
  });

  it('adding the same media twice does not duplicate the entry', async () => {
    const entry = assertOk(
      await client.put<MediaPlaylist>(`/api/images/${hashes[0]}/playlists/${playlistA.id}`),
      `PUT /api/images/${hashes[0]}/playlists/:id`,
    );
    expect(entry.order).to.equal(0);
    const afterAgain = assertOk(await client.get<Playlist[]>(`/api/playlists`), 'GET /api/playlists');
    expect(afterAgain[0].size).to.equal(1);
  });

  it('appending media gives increasing orders', async () => {
    for (const [index, hash] of hashes.slice(1, 3).entries()) {
      const entry = assertOk(
        await client.put<MediaPlaylist>(`/api/images/${hash}/playlists/${playlistA.id}`),
        `PUT /api/images/${hash}/playlists/:id`,
      );
      expect(entry.order).to.equal(index + 1);
    }
    const listed = assertOk(await client.get<Playlist[]>(`/api/playlists`), 'GET /api/playlists');
    expect(listed[0].size).to.equal(3);

    const orders = (await playlistEntries(playlistA.id)).map((entry) => entry.order);
    expect(orders.sort((a, b) => a - b)).to.deep.equal([0, 1, 2]);
  });

  it('playlist-scoped search returns hashes in order', async () => {
    expect(await playlistSubset(playlistA.id)).to.deep.equal(hashes.slice(0, 3));
  });

  it('playlist-scoped search can sort by other fields', async () => {
    const results = await subset(client, { playlist: playlistA.id, sortBy: 'path', sortDirection: 'DESC' });
    expect(results).to.have.members(hashes.slice(0, 3));
  });

  it('moving an entry reorders the playlist', async () => {
    // Move the last entry (gamma) to the front.
    const response = await client.patch(`/api/images/${hashes[2]}/playlists/${playlistA.id}`, { order: 0 });
    expect(response.status).to.equal(204);
    expect(await playlistSubset(playlistA.id)).to.deep.equal([hashes[2], hashes[0], hashes[1]]);

    // And back to the end.
    await client.patch(`/api/images/${hashes[2]}/playlists/${playlistA.id}`, { order: 2 });
    expect(await playlistSubset(playlistA.id)).to.deep.equal(hashes.slice(0, 3));
  });

  it('moving an entry out of range is a 400', async () => {
    const response = await client.patch(`/api/images/${hashes[0]}/playlists/${playlistA.id}`, { order: 99 });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('removing an entry shifts later orders down', async () => {
    const response = await client.delete(`/api/images/${hashes[1]}/playlists/${playlistA.id}`);
    expect(response.status).to.equal(204);
    expect(await playlistSubset(playlistA.id)).to.deep.equal([hashes[0], hashes[2]]);
    const listed = assertOk(await client.get<Playlist[]>(`/api/playlists`), 'GET /api/playlists');
    expect(listed[0].size).to.equal(2);

    // Re-add beta for the bulk tests below.
    await client.put(`/api/images/${hashes[1]}/playlists/${playlistA.id}`);
  });

  it('bulk-adds a search subset to a playlist', async () => {
    // alpha, beta, gamma are already members; delta matches the subset and gets added.
    const response = await client.put(`/api/images/subset/playlists/${playlistA.id}`, {});
    expect(response.status).to.equal(204);
    expect(await playlistSubset(playlistA.id)).to.have.members(hashes);
    const listed = assertOk(await client.get<Playlist[]>(`/api/playlists`), 'GET /api/playlists');
    expect(listed[0].size).to.equal(4);
  });

  it('bulk-remove takes a search subset out of a playlist', async () => {
    // Note the body is the constraints object directly (not wrapped in a
    // `constraints` key, unlike /api/images/bulk-update).
    const response = await client.delete(`/api/images/subset/playlists/${playlistA.id}`, {
      hash: { equalsAny: [hashes[0], hashes[1]] },
    });
    expect(response.status).to.equal(204);
    expect(await playlistSubset(playlistA.id)).to.deep.equal([hashes[2], hashes[3]]);
  });

  it('adding media to an unknown playlist is a 404', async () => {
    const response = await client.put(`/api/images/${hashes[0]}/playlists/does-not-exist`);
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
  });

  it('bulk-adding a subset to an unknown playlist is a 404', async () => {
    const response = await client.put('/api/images/subset/playlists/does-not-exist', {});
    expect(response.status).to.equal(404);
    expect(response.data).to.have.property('message');
  });

  it('a second playlist is fully isolated', async () => {
    playlistB = assertOk(await client.post<Playlist>('/api/playlists', { name: 'List B' }), 'POST /api/playlists');
    await client.put(`/api/images/${hashes[3]}/playlists/${playlistB.id}`);

    expect(await playlistSubset(playlistB.id)).to.deep.equal([hashes[3]]);
    expect(await playlistSubset(playlistA.id)).to.deep.equal([hashes[2], hashes[3]]);

    // Renaming one playlist does not affect the other.
    await client.patch(`/api/playlists/${playlistB.id}`, { name: 'List B renamed' });
    const playlists = assertOk(await client.get<Playlist[]>('/api/playlists'), 'GET /api/playlists');
    const a = playlists.find((playlist) => playlist.id === playlistA.id)!;
    const b = playlists.find((playlist) => playlist.id === playlistB.id)!;
    expect(a.name).to.equal('List A');
    expect(b.name).to.equal('List B renamed');

    // Deleting one playlist does not affect the other.
    await client.delete(`/api/playlists/${playlistB.id}`);
    const remaining = assertOk(await client.get<Playlist[]>('/api/playlists'), 'GET /api/playlists');
    expect(remaining.map((playlist) => playlist.id)).to.deep.equal([playlistA.id]);
    expect(await playlistSubset(playlistA.id)).to.deep.equal([hashes[2], hashes[3]]);
  });

  // Unknown playlist reads are a 404; deleting one stays an idempotent
  // no-op (see KNOWN-ISSUES.md "By design").
  describe('Unknown playlist behaviour', () => {
    it('GET is a 404 with a JSON error', async () => {
      const response = await client.get('/api/playlists/does-not-exist');
      expect(response.status).to.equal(404);
      expect(response.data).to.have.property('message');
    });

    it('DELETE remains a silent 204', async () => {
      const response = await client.delete('/api/playlists/does-not-exist');
      expect(response.status).to.equal(204);
    });
  });
});
