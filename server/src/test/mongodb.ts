import 'source-map-support/register';

import type { Media } from '@vimtur/common';
import { expect } from 'chai';
import { after, afterEach, before, describe, it } from 'mocha';

import Config from '../config';
import { MongoConnector } from '../database/mongodb';
import type { Database } from '../types/database';

// These tests talk to a real mongod — run-tests.sh provides a disposable
// container matching the DATABASE_URI env. They only run when the configured
// database provider is MongoDB; otherwise they are skipped so the other test
// files can be executed per-file against SQLite.
const describeMongo = Config.get().database?.provider === 'mongodb' ? describe : describe.skip;

describeMongo('Database Tests: MongoDB', () => {
  let database: Database;

  const createMedia = async (hash: string): Promise<Media> => {
    return database.saveMedia(hash, {
      hash,
      path: `/tmp/${hash}.jpg`,
      dir: '/tmp',
      type: 'still',
      actors: [],
      tags: [],
      hashDate: Date.now(),
      metadata: { height: 1080, width: 1920 },
    });
  };

  before(async () => {
    database = await MongoConnector.init();
  });

  after(async () => {
    await database.close();
  });

  describe('Playlist integrity', () => {
    afterEach(async () => {
      await database.testCleanup();
    });

    it('removing a playlist pulls its entries from every media and deletes the playlist', async () => {
      const playlist = await database.addPlaylist({ name: 'Doomed' });
      const survivor = await database.addPlaylist({ name: 'Survivor' });
      for (const hash of ['doomed-a', 'doomed-b', 'survivor']) {
        await createMedia(hash);
      }

      await database.addMediaToPlaylist('doomed-a', playlist.id);
      await database.addMediaToPlaylist('doomed-b', playlist.id);
      await database.addMediaToPlaylist('survivor', playlist.id);
      await database.addMediaToPlaylist('survivor', survivor.id);

      await database.removePlaylist(playlist.id);

      expect(await database.getPlaylist(playlist.id)).to.equal(undefined);
      expect((await database.getPlaylist(survivor.id))!.size).to.equal(1);

      for (const hash of ['doomed-a', 'doomed-b']) {
        const fetched = await database.getMedia(hash);
        expect(fetched!.playlists ?? []).to.have.lengthOf(0);
      }

      // Membership of playlists that still exist is untouched.
      const survivorMedia = await database.getMedia('survivor');
      expect((survivorMedia!.playlists ?? []).map((entry) => entry.id)).to.deep.equal([survivor.id]);
    });

    it('removing media from the library decrements playlist sizes', async () => {
      const playlist = await database.addPlaylist({ name: 'Counted' });
      for (const hash of ['gone-a', 'gone-b', 'staying']) {
        await createMedia(hash);
      }

      await database.addMediaToPlaylist('gone-a', playlist.id);
      await database.addMediaToPlaylist('gone-b', playlist.id);

      await database.removeMedia('gone-a', false);

      expect((await database.getPlaylist(playlist.id))!.size).to.equal(1);
    });

    it('removing media from a playlist unsets the playlist thumbnail', async () => {
      const playlist = await database.addPlaylist({ name: 'With thumbnail' });
      for (const hash of ['thumb-hash', 'other-hash']) {
        await createMedia(hash);
      }

      await database.addMediaToPlaylist('thumb-hash', playlist.id);
      await database.addMediaToPlaylist('other-hash', playlist.id);

      let fetched = await database.getPlaylist(playlist.id);
      expect(fetched!.thumbnail).to.equal('thumb-hash');

      await database.removeMediaFromPlaylist('thumb-hash', playlist.id);
      fetched = await database.getPlaylist(playlist.id);
      expect(fetched!.thumbnail).to.equal(undefined);
    });
  });
});
