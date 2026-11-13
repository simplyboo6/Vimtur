import 'source-map-support/register';

import type { BaseMedia, DeletedMedia, Media, Playlist } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { SqliteConnector } from '../database/sqlite';
import { SearchIndexer } from '../insights/tokens';
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

    it('subsetFields (all) aggregates tags and actors', async () => {
      const all = await database.subsetFields({}, 'all');
      expect(all.length).to.equal(5);
      const byHash = new Map(all.map((el) => [el.hash, el]));

      expect(byHash.get('hash-0')?.tags).to.deep.equal(['tag-a', 'tag-b']);
      expect(byHash.get('hash-1')?.tags).to.deep.equal(['tag-b', 'tag-c']);
      // Media without join rows must come back as empty arrays, not undefined.
      expect(byHash.get('hash-2')?.tags).to.deep.equal([]);
      expect(byHash.get('hash-2')?.actors).to.deep.equal([]);
    });

    after(async () => {
      await database.testCleanup();
    });
  });

  describe('countSubset tests', () => {
    before(async () => {
      // tagged still (thumbnail), untagged still, tagged still without a
      // thumbnail, tagged video and tagged gif: the calibration eligibility
      // funnel the AUTO-TAG calibration counts before sampling.
      const fixtures: Array<{ hash: string; type: Media['type']; tagged?: boolean; thumbnail?: boolean }> = [
        { hash: 'count-tagged-still', type: 'still', tagged: true, thumbnail: true },
        { hash: 'count-untagged-still', type: 'still', thumbnail: true },
        { hash: 'count-tagged-no-thumbnail', type: 'still', tagged: true },
        { hash: 'count-tagged-video', type: 'video', tagged: true },
        { hash: 'count-tagged-gif', type: 'gif', tagged: true },
      ];
      await database.addTag('count-tag');
      for (const fixture of fixtures) {
        await database.saveMedia(fixture.hash, {
          hash: fixture.hash,
          path: `/tmp/${fixture.hash}.bin`,
          dir: '/tmp',
          type: fixture.type,
          actors: [],
          tags: [],
          hashDate: Date.now(),
          thumbnail: fixture.thumbnail,
          metadata: { height: 1080, width: 1920 },
        });
        if (fixture.tagged) {
          await database.addMediaTag(fixture.hash, 'count-tag');
        }
      }
    });

    it('counts tagged media of every type', async () => {
      expect(await database.countSubset({ tags: { exists: true } })).to.equal(4);
    });

    it('counts tagged stills', async () => {
      expect(await database.countSubset({ type: { equalsAny: ['still'] }, tags: { exists: true } })).to.equal(2);
    });

    it('counts tagged stills with a thumbnail', async () => {
      expect(
        await database.countSubset({ type: { equalsAny: ['still'] }, tags: { exists: true }, thumbnail: true }),
      ).to.equal(1);
    });

    it('ignores sample, limit, sortBy and sortDirection', async () => {
      const constraints = { tags: { exists: true }, sample: 1, limit: 1, sortBy: 'hashDate' as const };
      expect(await database.countSubset(constraints)).to.equal(4);
      // The count must not write the defaulted sort direction back either.
      expect(constraints).to.deep.equal({ tags: { exists: true }, sample: 1, limit: 1, sortBy: 'hashDate' });
    });

    it('counts an empty match as zero', async () => {
      expect(await database.countSubset({ hash: { equalsAny: ['missing'] } })).to.equal(0);
    });

    after(async () => {
      await database.testCleanup();
    });
  });

  describe('autoTags null clear', () => {
    // clear-0: manual + auto; clear-1: auto only; clear-2: manual only;
    // clear-3: manual + the stored "processed, nothing scored" [] marker.
    const AUTO_TAGS: Record<number, string[]> = { 0: ['auto-0'], 1: ['auto-1'], 3: [] };

    before(async () => {
      for (const index of [0, 1, 2, 3]) {
        await database.saveMedia(`clear-${index}`, {
          hash: `clear-${index}`,
          path: `/tmp/clear-${index}.jpg`,
          dir: '/tmp',
          type: 'still',
          actors: [],
          tags: [],
          hashDate: Date.now(),
          metadata: { height: 1080, width: 1920 },
          autoTags: AUTO_TAGS[index],
        });
      }
      await database.addTag('manual');
      await database.addMediaTag('clear-0', 'manual');
      await database.addMediaTag('clear-2', 'manual');
      await database.addMediaTag('clear-3', 'manual');
    });

    after(async () => {
      await database.testCleanup();
    });

    it('saveBulkMedia with autoTags: null clears only the matching rows', async () => {
      const cleared = await database.saveBulkMedia(
        { tags: { exists: true }, autoTags: { exists: true } },
        { autoTags: null },
      );
      // Both the scored row and the stored [] "processed" marker are cleared.
      expect(cleared).to.equal(2);
      expect((await database.getMedia('clear-0'))?.autoTags).to.equal(undefined);
      // The auto-only item keeps its scored list (it has no manual tag).
      expect((await database.getMedia('clear-1'))?.autoTags).to.deep.equal(['auto-1']);
      expect((await database.getMedia('clear-3'))?.autoTags).to.equal(undefined);
      // clear-2 never had auto tags, so it is untouched and still unprocessed.
      expect((await database.getMedia('clear-2'))?.autoTags).to.equal(undefined);
      // NULL, not [], is what skip-existing keys off: only the cleared items are
      // treated as unprocessed again, and the [] marker still counts as present.
      expect(await database.subset({ autoTags: { exists: false } })).to.have.members(['clear-0', 'clear-2', 'clear-3']);
      expect(await database.subset({ autoTags: { exists: true } })).to.deep.equal(['clear-1']);
    });

    it('saveMedia with autoTags: null un-marks a stored [] marker', async () => {
      // The PATCH route's shape: one row, one explicit null, no other fields.
      // Its own row so the fixtures above stay untouched for the bulk case.
      await database.saveMedia('patch-clear', {
        hash: 'patch-clear',
        path: '/tmp/patch-clear.jpg',
        dir: '/tmp',
        type: 'still',
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { height: 1080, width: 1920 },
        autoTags: [],
      });
      await database.saveMedia('patch-clear', { autoTags: null });
      // The read path turns SQL NULL into an absent property, so the API
      // response omits the list rather than serving JSON null.
      expect((await database.getMedia('patch-clear'))?.autoTags).to.equal(undefined);
      // NULL, not [], is what skip-existing keys off: the row is now in the
      // unprocessed work set alongside the never-scored manual row.
      expect(await database.subset({ autoTags: { exists: false } })).to.include('patch-clear');
      expect(await database.subset({ autoTags: { exists: true } })).to.not.include('patch-clear');
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
      expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
      expect(fetchedMedia!.playlists![0].order).to.equal(0);
    });

    it('Add second media to playlist', async () => {
      await database.addMediaToPlaylist(media[0].hash, playlists[0].id);
      await database.addMediaToPlaylist(media[1].hash, playlists[0].id);

      {
        const fetchedMedia = await database.getMedia(media[0].hash);
        expect(fetchedMedia).to.be.an('object');
        expect(fetchedMedia!.playlists).to.be.an('array');

        expect(fetchedMedia!.playlists!.length).to.equal(1);
        expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
        expect(fetchedMedia!.playlists![0].order).to.equal(0);
      }

      {
        const fetchedMedia = await database.getMedia(media[1].hash);
        expect(fetchedMedia).to.be.an('object');
        expect(fetchedMedia!.playlists).to.be.an('array');

        expect(fetchedMedia!.playlists!.length).to.equal(1);
        expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
        expect(fetchedMedia!.playlists![0].order).to.equal(1);
      }
    });

    it('counts media cheaply and tracks deletions', async () => {
      const base = await database.countMedia();

      await database.saveMedia('hash-count-test', {
        hash: 'hash-count-test',
        path: '/tmp/count-test.jpg',
        dir: '/tmp',
        type: 'still',
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { height: 1080, width: 1920 },
      });
      expect(await database.countMedia()).to.equal(base + 1);

      // ignoreInImport=false removes the row outright, keeping the count unchanged after.
      await database.removeMedia('hash-count-test', false);
      expect(await database.countMedia()).to.equal(base);
    });

    describe('Media deleted from the library', () => {
      it('decrements the size of every playlist that held the media', async () => {
        await database.addMediaToPlaylist(media[0].hash, playlists[0].id);
        await database.addMediaToPlaylist(media[0].hash, playlists[1].id);
        await database.addMediaToPlaylist(media[1].hash, playlists[1].id);

        await database.removeMedia(media[0].hash, false);

        expect((await database.getPlaylist(playlists[0].id))!.size).to.equal(0);
        expect((await database.getPlaylist(playlists[1].id))!.size).to.equal(1);
      });

      it('leaves sizes untouched when the media was in no playlist', async () => {
        await database.addMediaToPlaylist(media[0].hash, playlists[0].id);

        await database.removeMedia(media[4].hash, false);

        expect((await database.getPlaylist(playlists[0].id))!.size).to.equal(1);
      });

      it('does not leave a playlist thumbnail pointing at deleted media', async () => {
        const playlist = await database.addPlaylist({ name: 'Thumb test' });
        await database.updatePlaylist(playlist.id, { thumbnail: media[0].hash });

        await database.removeMedia(media[0].hash, false);

        expect((await database.getPlaylist(playlist.id))!.thumbnail).to.equal(undefined);
      });
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
          expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0].order).to.equal(order);
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
          expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0].order).to.equal(order);
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
          expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0].order).to.equal(order);
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
          expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
          expect(fetchedMedia!.playlists![0].order).to.equal(order);
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
            expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
            expect(fetchedMedia!.playlists![0].order).to.equal(order);
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
            expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
            expect(fetchedMedia!.playlists![0].order).to.equal(order);
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
            expect(fetchedMedia!.playlists![0].id).to.equal(playlists[0].id);
            expect(fetchedMedia!.playlists![0].order).to.equal(order);
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

  describe('Deleted media ignore list', () => {
    after(async () => {
      await database.testCleanup();
    });

    // Compare sorted so the assertions do not depend on the engine's return
    // order; the API sorts, the connector does not promise an order.
    const rows = async (): Promise<DeletedMedia[]> =>
      (await database.getDeletedMedia()).sort((a, b) => a.hash.localeCompare(b.hash) || a.path.localeCompare(b.path));

    // The cases below share one dataset on purpose, pinning accumulation and
    // removal as rows are added; a shuffle or an isolated `.only` will therefore
    // fail for reasons unrelated to the case under test.
    it('records a path for a deleted media hash', async () => {
      await database.addDeleted({ hash: 'ignored-0', path: 'a/one.jpg' });

      expect(await rows()).to.deep.equal([{ hash: 'ignored-0', path: 'a/one.jpg' }]);
      expect(await database.isDeletedPath('a/one.jpg')).to.equal(true);
      expect(await database.isDeletedHash('ignored-0')).to.equal(true);
    });

    it('adds a second path for the same hash instead of replacing the first', async () => {
      await database.addDeleted({ hash: 'ignored-0', path: 'b/two.jpg' });

      expect(await rows()).to.deep.equal([
        { hash: 'ignored-0', path: 'a/one.jpg' },
        { hash: 'ignored-0', path: 'b/two.jpg' },
      ]);
    });

    it('is idempotent for a repeated hash and path', async () => {
      await database.addDeleted({ hash: 'ignored-0', path: 'a/one.jpg' });

      expect(await rows()).to.have.lengthOf(2);
    });

    it('removes every path recorded for a hash and leaves other hashes alone', async () => {
      await database.addDeleted({ hash: 'ignored-1', path: 'c/three.jpg' });

      await database.removeDeleted('ignored-0');

      expect(await rows()).to.deep.equal([{ hash: 'ignored-1', path: 'c/three.jpg' }]);
      expect(await database.isDeletedPath('a/one.jpg')).to.equal(false);
      expect(await database.isDeletedPath('b/two.jpg')).to.equal(false);
      expect(await database.isDeletedHash('ignored-0')).to.equal(false);
      expect(await database.isDeletedHash('ignored-1')).to.equal(true);
    });

    it('is a no-op when the hash has no recorded paths', async () => {
      await database.removeDeleted('never-recorded');

      expect(await rows()).to.deep.equal([{ hash: 'ignored-1', path: 'c/three.jpg' }]);
    });

    it('records the path when media is deleted with the import ignore flag', async () => {
      await database.saveMedia('ignored-media', {
        hash: 'ignored-media',
        path: '/tmp/ignored-media.jpg',
        dir: '/tmp',
        type: 'still',
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { height: 1080, width: 1920 },
      });

      await database.removeMedia('ignored-media', true);

      expect(await database.isDeletedPath('/tmp/ignored-media.jpg')).to.equal(true);
      expect(await database.isDeletedHash('ignored-media')).to.equal(true);
      expect(await database.getMedia('ignored-media')).to.equal(undefined);
    });

    it('leaves the ignore list alone when media is deleted without the flag', async () => {
      await database.saveMedia('unignored-media', {
        hash: 'unignored-media',
        path: '/tmp/unignored-media.jpg',
        dir: '/tmp',
        type: 'still',
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { height: 1080, width: 1920 },
      });

      await database.removeMedia('unignored-media', false);

      expect(await database.isDeletedPath('/tmp/unignored-media.jpg')).to.equal(false);
      expect(await database.isDeletedHash('unignored-media')).to.equal(false);
    });
  });

  describe('Task state', () => {
    after(async () => {
      await database.testCleanup();
    });

    it('stores and reads back a value', async () => {
      const state = { tags: { cat: 7 }, calibratedAt: 'yesterday' };
      await database.setTaskState('AUTO-TAG-TEST', 'calibration', state);
      expect(await database.getTaskState('AUTO-TAG-TEST', 'calibration')).to.deep.equal(state);
    });

    it('returns undefined for a key that was never stored', async () => {
      expect(await database.getTaskState('AUTO-TAG-TEST', 'missing')).to.equal(undefined);
    });

    it('overwrites an existing value for the same task and key', async () => {
      await database.setTaskState('AUTO-TAG-TEST', 'calibration', { run: 1 });
      await database.setTaskState('AUTO-TAG-TEST', 'calibration', { run: 2 });
      expect(await database.getTaskState('AUTO-TAG-TEST', 'calibration')).to.deep.equal({ run: 2 });
    });

    it('isolates the same key between task ids', async () => {
      await database.setTaskState('AUTO-TAG-ONE', 'calibration', { task: 'one' });
      await database.setTaskState('AUTO-TAG-TWO', 'calibration', { task: 'two' });
      expect(await database.getTaskState('AUTO-TAG-ONE', 'calibration')).to.deep.equal({ task: 'one' });
      expect(await database.getTaskState('AUTO-TAG-TWO', 'calibration')).to.deep.equal({ task: 'two' });
    });

    it('clears stored state in testCleanup', async () => {
      await database.setTaskState('AUTO-TAG-TEST', 'calibration', { run: 3 });
      await database.testCleanup();
      expect(await database.getTaskState('AUTO-TAG-TEST', 'calibration')).to.equal(undefined);
    });
  });

  describe('Insights tokens', () => {
    it('registerMedia tolerates missing tags/actors', () => {
      const indexer = new SearchIndexer();
      const tokens = indexer.registerMedia({
        hash: 'hash-bare',
        path: '/tmp/bare.jpg',
        dir: '/tmp',
        type: 'still',
        hashDate: Date.now(),
      } as BaseMedia);
      expect(Object.keys(tokens)).to.deep.equal(['still']);
    });
  });

  after(async () => {
    await database.close();
  });
});
