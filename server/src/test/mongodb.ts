import 'source-map-support/register';

import type { Media, SegmentMetadata } from '@vimtur/common';
import { expect } from 'chai';
import { after, afterEach, before, describe, it } from 'mocha';
import type { Db } from 'mongodb';

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

  // Pins the update-document shape that saveMedia/saveBulkMedia store: the
  // helpers that flatten metadata and strip generated fields are not
  // exercised through the API surface, so assert the stored document directly.
  const getRawMediaDocument = async (hash: string): Promise<Record<string, unknown> | null> => {
    const connector = database as unknown as { db: Db };
    return connector.db.collection('media').findOne({ hash });
  };

  describe('Update flattening', () => {
    afterEach(async () => {
      await database.testCleanup();
    });

    it('merges metadata fields per-entry without over-writing the existing ones', async () => {
      const segments: SegmentMetadata = { standard: [{ start: 0, end: 10 }] };
      await database.saveMedia('meta-merge', {
        hash: 'meta-merge',
        path: '/tmp/meta-merge.jpg',
        dir: '/tmp',
        type: 'still',
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { width: 640, height: 480, segments },
      });

      await database.saveMedia('meta-merge', { metadata: { artist: 'someone' } });

      const media = await database.getMedia('meta-merge');
      expect(media?.metadata?.artist).to.equal('someone');
      expect(media?.metadata?.width).to.equal(640);
      expect(media?.metadata?.height).to.equal(480);
      expect(media?.metadata?.segments).to.deep.equal(segments);
    });

    it('persists falsy-but-real field values (rating 0)', async () => {
      await createMedia('rating-zero');
      await database.saveMedia('rating-zero', { rating: 0 });
      const media = await database.getMedia('rating-zero');
      expect(media?.rating).to.equal(0);
    });

    it('strips generated fields on save-back and keeps absent playlists absent', async () => {
      const media = await createMedia('save-back');
      // A full API response shape written back, as saveMedia's signature allows.
      await database.saveMedia('save-back', media);

      const raw = await getRawMediaDocument('save-back');
      expect(raw).to.not.equal(null);
      expect(raw?.absolutePath).to.equal(undefined);
      expect(raw?.transcode).to.equal(undefined);
      expect(raw?.cached).to.equal(undefined);
      expect(raw?.playlists).to.equal(undefined);
      expect(raw?.['metadata.width']).to.equal(undefined);

      // A stored literal `playlists: null` would break the $addToSet path.
      const playlist = await database.addPlaylist({ name: 'After export' });
      await database.addMediaToPlaylist('save-back', playlist.id);
      const after = await database.getMedia('save-back');
      expect(after?.playlists?.map((entry) => entry.id)).to.deep.equal([playlist.id]);
    });
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
