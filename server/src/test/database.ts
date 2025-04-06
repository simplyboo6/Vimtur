import 'source-map-support/register';

import type { Media, Playlist } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { SqliteConnector } from '../database/sqlite';
import type { Database } from '../types/database';

describe('Database Tests', () => {
  let database: Database;

  before(async () => {
    database = await SqliteConnector.init({ filename: ':memory:', libraryPath: '/tmp' });
  });

  describe('Misc tests', () => {
    after(async () => {
      await database.testCleanup();
    });

    it('Update hash', async () => {
      await database.saveMedia(`hash-1`, {
        hash: `hash-1`,
        path: `/tmp/1.jpg`,
        dir: '/tmp',
        type: 'still',
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { height: 1080, width: 1920 },
      });

      await database.saveMedia(`hash-1`, {
        hash: `hash-2`,
      });

      const hashes = await database.subset({ hash: { equalsAny: ['hash-1', 'hash-2'] } });
      expect(hashes).to.deep.equal(['hash-2']);
    });
  });

  describe('Subset tests', () => {
    const media: Media[] = [];

    before(async () => {
      for (let i = 0; i < 5; i++) {
        media.push(
          await database.saveMedia(`hash-${i}`, {
            hash: `hash-${i}`,
            path: `/tmp/${i}.jpg`,
            dir: '/tmp',
            type: 'still',
            actors: [],
            tags: [],
            hashDate: Date.now(),
            metadata: { height: 1080, width: 1920 },
          }),
        );
      }
      await database.addTag('tag-a');
      await database.addTag('tag-b');
      await database.addTag('tag-c');
      await database.addTag('tag-d');
      await database.addMediaTag('hash-0', 'tag-a');
      await database.addMediaTag('hash-0', 'tag-b');
      await database.addMediaTag('hash-1', 'tag-b');
      await database.addMediaTag('hash-1', 'tag-c');
    });

    it('keyword search', async () => {
      const hashes = await database.subset({ keywordSearch: 'tag-b' });
      expect(hashes).to.deep.equal(['hash-0', 'hash-1']);
    });

    it('quality search', async () => {
      const hashes = await database.subset({ quality: { min: 1080 } });
      expect(hashes.length).to.equal(5);
    });

    it('arrayFilter.equalsAny (a, c)', async () => {
      const hashes = await database.subset({ tags: { equalsAny: ['tag-a', 'tag-c'] } });
      expect(hashes).to.deep.equal(['hash-0', 'hash-1']);
    });

    it('arrayFilter.equalsAny (d)', async () => {
      const hashes = await database.subset({ tags: { equalsAny: ['tag-d'] } });
      expect(hashes).to.deep.equal([]);
    });

    it('arrayFilter.equalsNone (d)', async () => {
      const hashes = await database.subset({ tags: { equalsNone: ['tag-d'] } });
      expect(hashes.length).to.equal(5);
    });

    it('arrayFilter.equalsNone (a, b)', async () => {
      const hashes = await database.subset({ tags: { equalsNone: ['tag-a', 'tag-b'] } });
      expect(hashes.length).to.equal(3);
    });

    it('arrayFilter.equalsAll (b)', async () => {
      const hashes = await database.subset({ tags: { equalsAll: ['tag-b'] } });
      expect(hashes.length).to.equal(2);
    });

    it('arrayFilter.equalsAll (b, c)', async () => {
      const hashes = await database.subset({ tags: { equalsAll: ['tag-b', 'tag-c'] } });
      expect(hashes.length).to.equal(1);
    });

    it('arrayFilter.exists (true)', async () => {
      const hashes = await database.subset({ tags: { exists: true } });
      expect(hashes.length).to.equal(2);
    });

    it('arrayFilter.exists (false)', async () => {
      const hashes = await database.subset({ tags: { exists: false } });
      expect(hashes.length).to.equal(3);
    });

    it('arrayFilter combo', async () => {
      const hashes = await database.subset({
        tags: {
          equalsAll: ['tag-b'],
          equalsAny: ['tag-a', 'tag-c'],
          equalsNone: ['tag-d'],
          exists: true,
        },
      });
      expect(hashes.length).to.equal(2);
    });

    it('keyword with arrayFilter.exists', async () => {
      const hashes = await database.subset({
        keywordSearch: 'tag-a',
        tags: {
          exists: true,
        },
      });
      expect(hashes.length).to.equal(1);
    });

    after(async () => {
      await database.testCleanup();
    });
  });

  describe('Basic playlist tests', () => {
    it('Create playlist', async () => {
      const playlist = await database.addPlaylist({
        name: 'Playlist A',
      });
      expect(playlist.id).to.be.a('string');
      expect(playlist.size).to.equal(0);
      expect(playlist.name).to.equal('Playlist A');
    });

    it('Create and get playlist', async () => {
      const playlist = await database.addPlaylist({
        name: 'Playlist A',
      });
      expect(playlist.id).to.be.a('string');

      const fetched = await database.getPlaylist(playlist.id);
      expect(fetched).to.deep.equal(playlist);
    });

    it('Create and update playlist', async () => {
      const playlistA = await database.addPlaylist({
        name: 'Playlist A',
      });
      expect(playlistA.id).to.be.a('string');

      const playlistB = await database.addPlaylist({
        name: 'Playlist B',
      });
      expect(playlistB.id).to.be.a('string');

      await database.updatePlaylist(playlistA.id, { name: 'Playlist A2' });

      const fetchedA = await database.getPlaylist(playlistA.id);
      const fetchedB = await database.getPlaylist(playlistB.id);

      expect(fetchedA).to.be.an('object');

      expect(fetchedA!.name).to.equal('Playlist A2');
      // Ensure playlist B is untouched.
      expect(fetchedB).to.deep.equal(playlistB);
    });

    it('Create and delete playlist', async () => {
      const playlist = await database.addPlaylist({
        name: 'Playlist A',
      });

      await database.removePlaylist(playlist.id);

      const fetched = await database.getPlaylist(playlist.id);
      expect(fetched).to.equal(undefined);
    });

    it('Create and list playlists', async () => {
      const playlistA = await database.addPlaylist({
        name: 'Playlist A',
      });
      const playlistB = await database.addPlaylist({
        name: 'Playlist B',
      });
      const playlistC = await database.addPlaylist({
        name: 'Playlist C',
      });

      const playlists = await database.getPlaylists();
      expect(playlists.length).to.equal(3);
      expect(playlists.find((playlist) => playlist.id === playlistA.id)).to.be.an('object');
      expect(playlists.find((playlist) => playlist.id === playlistB.id)).to.be.an('object');
      expect(playlists.find((playlist) => playlist.id === playlistC.id)).to.be.an('object');
    });

    it('Ensure correct item is removed', async () => {
      const playlistA = await database.addPlaylist({
        name: 'Playlist A',
      });
      const playlistB = await database.addPlaylist({
        name: 'Playlist B',
      });
      const playlistC = await database.addPlaylist({
        name: 'Playlist C',
      });
      const playlists = await database.getPlaylists();
      expect(playlists.length).to.equal(3);

      await database.removePlaylist(playlistB.id);

      const playlistsPost = await database.getPlaylists();

      expect(playlistsPost.length).to.equal(2);
      expect(playlistsPost.find((playlist) => playlist.id === playlistA.id)).to.be.an('object');
      expect(playlistsPost.find((playlist) => playlist.id === playlistB.id)).to.equal(undefined);
      expect(playlistsPost.find((playlist) => playlist.id === playlistC.id)).to.be.an('object');
    });

    afterEach(async () => {
      await database.testCleanup();
    });
  });

  describe('Playlist content manipulation', () => {
    let playlists: Playlist[] = [];
    let media: Media[] = [];

    beforeEach(async () => {
      playlists = [];
      media = [];

      for (let i = 0; i < 3; i++) {
        playlists.push(
          await database.addPlaylist({
            name: `Playlist ${i}`,
          }),
        );
      }

      for (let i = 0; i < 5; i++) {
        media.push(
          await database.saveMedia(`hash-${i}`, {
            hash: `hash-${i}`,
            path: `/tmp/${i}.jpg`,
            dir: '/tmp',
            type: 'still',
            actors: [],
            tags: [],
            hashDate: Date.now(),
          }),
        );
      }
    });

    afterEach(async () => {
      await database.testCleanup();
    });

    it('Add media to playlist', async () => {
      await database.addMediaToPlaylist(media[0].hash, playlists[0].id);

      const playlist = await database.getPlaylist(playlists[0].id);
      expect(playlist).to.be.an('object');
      expect(playlist!.size).to.equal(1);

      const fetchedMedia = await database.getMedia(media[0].hash);
      expect(fetchedMedia).to.be.an('object');
      expect(fetchedMedia!.playlists).to.be.an('array');

      expect(fetchedMedia!.playlists!.length).to.equal(1);
      expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
      expect(fetchedMedia!.playlists![0]!.order).to.equal(0);
    });

    it('Add second media to playlist', async () => {
      await database.addMediaToPlaylist(media[0].hash, playlists[0].id);
      await database.addMediaToPlaylist(media[1].hash, playlists[0].id);

      {
        const fetchedMedia = await database.getMedia(media[0].hash);
        expect(fetchedMedia).to.be.an('object');
        expect(fetchedMedia!.playlists).to.be.an('array');

        expect(fetchedMedia!.playlists!.length).to.equal(1);
        expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
        expect(fetchedMedia!.playlists![0]!.order).to.equal(0);
      }

      {
        const fetchedMedia = await database.getMedia(media[1].hash);
        expect(fetchedMedia).to.be.an('object');
        expect(fetchedMedia!.playlists).to.be.an('array');

        expect(fetchedMedia!.playlists!.length).to.equal(1);
        expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
        expect(fetchedMedia!.playlists![0]!.order).to.equal(1);
      }
    });

    describe('Ordered existing playlist', () => {
      beforeEach(async () => {
        for (const m of media) {
          await database.addMediaToPlaylist(m.hash, playlists[0].id);
        }
      });

      it('Move media from end to start', async () => {
        await database.updateMediaPlaylistOrder(media[media.length - 1].hash, playlists[0].id, {
          order: 0,
        });

        for (const { hash, order } of [
          { hash: media[0].hash, order: 1 },
          { hash: media[1].hash, order: 2 },
          { hash: media[2].hash, order: 3 },
          { hash: media[3].hash, order: 4 },
          { hash: media[4].hash, order: 0 },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          expect(fetchedMedia!.playlists!.length).to.equal(1);
          expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
        }
      });

      it('Move media from start to end', async () => {
        await database.updateMediaPlaylistOrder(media[0].hash, playlists[0].id, {
          order: media.length - 1,
        });

        for (const { hash, order } of [
          { hash: media[0].hash, order: 4 },
          { hash: media[1].hash, order: 0 },
          { hash: media[2].hash, order: 1 },
          { hash: media[3].hash, order: 2 },
          { hash: media[4].hash, order: 3 },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          expect(fetchedMedia!.playlists!.length).to.equal(1);
          expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
        }
      });

      it('Move from start to middle', async () => {
        await database.updateMediaPlaylistOrder(media[0].hash, playlists[0].id, { order: 2 });

        for (const { hash, order } of [
          { hash: media[0].hash, order: 2 },
          { hash: media[1].hash, order: 0 },
          { hash: media[2].hash, order: 1 },
          { hash: media[3].hash, order: 3 },
          { hash: media[4].hash, order: 4 },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          expect(fetchedMedia!.playlists!.length).to.equal(1);
          expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
        }
      });

      it('Move from middle to start', async () => {
        await database.updateMediaPlaylistOrder(media[2].hash, playlists[0].id, { order: 0 });

        for (const { hash, order } of [
          { hash: media[0].hash, order: 1 },
          { hash: media[1].hash, order: 2 },
          { hash: media[2].hash, order: 0 },
          { hash: media[3].hash, order: 3 },
          { hash: media[4].hash, order: 4 },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          expect(fetchedMedia!.playlists!.length).to.equal(1);
          expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
        }
      });

      it('Remove from start', async () => {
        await database.removeMediaFromPlaylist(media[0].hash, playlists[0].id);

        const playlist = await database.getPlaylist(playlists[0].id);
        expect(playlist).to.be.an('object');
        expect(playlist!.size).to.equal(4);

        for (const { hash, order } of [
          { hash: media[0].hash },
          { hash: media[1].hash, order: 0 },
          { hash: media[2].hash, order: 1 },
          { hash: media[3].hash, order: 2 },
          { hash: media[4].hash, order: 3 },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          if (order !== undefined) {
            expect(fetchedMedia!.playlists!.length).to.equal(1);
            expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
            expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
          } else {
            expect(fetchedMedia!.playlists!.length).to.equal(0);
          }
        }
      });

      it('Remove from middle', async () => {
        await database.removeMediaFromPlaylist(media[2].hash, playlists[0].id);

        const playlist = await database.getPlaylist(playlists[0].id);
        expect(playlist).to.be.an('object');
        expect(playlist!.size).to.equal(4);

        for (const { hash, order } of [
          { hash: media[0].hash, order: 0 },
          { hash: media[1].hash, order: 1 },
          { hash: media[2].hash },
          { hash: media[3].hash, order: 2 },
          { hash: media[4].hash, order: 3 },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          if (order !== undefined) {
            expect(fetchedMedia!.playlists!.length).to.equal(1);
            expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
            expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
          } else {
            expect(fetchedMedia!.playlists!.length).to.equal(0);
          }
        }
      });

      it('Remove from end', async () => {
        await database.removeMediaFromPlaylist(media[media.length - 1].hash, playlists[0].id);

        const playlist = await database.getPlaylist(playlists[0].id);
        expect(playlist).to.be.an('object');
        expect(playlist!.size).to.equal(4);

        for (const { hash, order } of [
          { hash: media[0].hash, order: 0 },
          { hash: media[1].hash, order: 1 },
          { hash: media[2].hash, order: 2 },
          { hash: media[3].hash, order: 3 },
          { hash: media[4].hash },
        ]) {
          const fetchedMedia = await database.getMedia(hash);
          expect(fetchedMedia).to.be.an('object');
          expect(fetchedMedia!.playlists).to.be.an('array');

          if (order !== undefined) {
            expect(fetchedMedia!.playlists!.length).to.equal(1);
            expect(fetchedMedia!.playlists![0]!.id).to.equal(playlists[0].id);
            expect(fetchedMedia!.playlists![0]!.order).to.equal(order);
          } else {
            expect(fetchedMedia!.playlists!.length).to.equal(0);
          }
        }
      });
    });

    describe('Multiple playlists', () => {
      beforeEach(async () => {
        for (const m of media) {
          await database.addMediaToPlaylist(m.hash, playlists[0].id);
        }

        await database.addMediaToPlaylist(media[1].hash, playlists[1].id);
        await database.addMediaToPlaylist(media[2].hash, playlists[1].id);
        await database.addMediaToPlaylist(media[0].hash, playlists[1].id);
        await database.addMediaToPlaylist(media[3].hash, playlists[1].id);
      });

      const checkPlaylistB = async (): Promise<void> => {
        const subset = await database.subset({
          playlist: playlists[1].id,
        });

        expect(subset.length).to.equal(4);

        let i = 0;
        for (const order of [1, 2, 0, 3]) {
          expect(subset[i]).to.equal(media[order].hash);
          i++;
        }
      };

      it('Search by playlist and default sort by order (already ordered)', async () => {
        const subset = await database.subset({
          playlist: playlists[0].id,
        });
        expect(subset.length).to.equal(media.length);

        for (let i = 0; i < subset.length; i++) {
          expect(subset[i]).to.equal(media[i].hash);
        }
      });

      it('Search by playlist and default sort by order (unordered)', async () => {
        await checkPlaylistB();
      });

      it('Reordering one playlist does not effect another', async () => {
        await database.updateMediaPlaylistOrder(media[2].hash, playlists[0].id, { order: 0 });
        await checkPlaylistB();
      });

      it('Removing one playlist does not effect another', async () => {
        await database.removeMediaFromPlaylist(media[2].hash, playlists[0].id);
        await checkPlaylistB();
      });
    });
  });

  after(async () => {
    await database.close();
  });
});
