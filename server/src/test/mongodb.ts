import 'source-map-support/register';

import type { BaseMedia, DeletedMedia, Media, SegmentMetadata } from '@vimtur/common';
import { expect } from 'chai';
import { after, afterEach, before, beforeEach, describe, it } from 'mocha';
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
  async function getRawMediaDocument(hash: string): Promise<Record<string, unknown> | null> {
    const connector = database as unknown as { db: Db };
    return connector.db.collection('media').findOne({ hash });
  }

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

  describe('autoTags null clear', () => {
    // clear-0: manual + auto; clear-1: auto only; clear-2: manual only;
    // clear-3: manual + the stored "processed, nothing scored" [] marker.
    const AUTO_TAGS: Record<number, string[]> = { 0: ['auto-0'], 1: ['auto-1'], 3: [] };

    beforeEach(async () => {
      for (const index of [0, 1, 2, 3]) {
        const autoTags: string[] | undefined = AUTO_TAGS[index];
        await createMedia(`clear-${index}`);
        // Only write the overlay when the fixture has one: an inserted
        // `autoTags: undefined` would store null and defeat exists: false.
        if (autoTags !== undefined) {
          await database.saveMedia(`clear-${index}`, { autoTags });
        }
      }
      await database.addTag('manual');
      await database.addMediaTag('clear-0', 'manual');
      await database.addMediaTag('clear-2', 'manual');
      await database.addMediaTag('clear-3', 'manual');
    });

    afterEach(async () => {
      await database.testCleanup();
    });

    it('saveBulkMedia with autoTags: null clears only the matching rows', async () => {
      const cleared = await database.saveBulkMedia(
        { tags: { exists: true }, autoTags: { exists: true } },
        { autoTags: null },
      );
      // Both the scored row and the stored [] "processed" marker are cleared.
      expect(cleared).to.equal(2);
      // The read path drops the stored null so a cleared row looks exactly
      // like one that was never marked, matching SQLite's absent property.
      expect((await database.getMedia('clear-0'))?.autoTags).to.equal(undefined);
      // The auto-only item keeps its scored list (it has no manual tag).
      expect((await database.getMedia('clear-1'))?.autoTags).to.deep.equal(['auto-1']);
      expect((await database.getMedia('clear-3'))?.autoTags).to.equal(undefined);
      // clear-2 never had auto tags, so it is untouched and still unprocessed.
      expect((await database.getMedia('clear-2'))?.autoTags).to.equal(undefined);
      // The [] marker counts as present (it is a processed state), so only the
      // cleared rows and the never-scored one come back as unprocessed.
      expect(await database.subset({ autoTags: { exists: false } })).to.have.members(['clear-0', 'clear-2', 'clear-3']);
      expect(await database.subset({ autoTags: { exists: true } })).to.deep.equal(['clear-1']);
    });

    it('saveMedia with autoTags: null un-marks a stored [] marker', async () => {
      // The PATCH route's shape: one row, one explicit null, no other fields.
      // Its own row so the fixtures above keep their own assertions.
      await createMedia('patch-clear');
      await database.saveMedia('patch-clear', { autoTags: [] });
      const saved = await database.saveMedia('patch-clear', { autoTags: null });
      // Mongo stores a null field; the read path (saveMedia's read-back and
      // getMedia) drops it so the wire shape matches SQLite's absent property,
      // and the filters are what make it read as unprocessed to the pipeline.
      expect(saved).to.not.have.property('autoTags');
      expect(await database.getMedia('patch-clear')).to.not.have.property('autoTags');
      const raw = await getRawMediaDocument('patch-clear');
      expect(raw?.autoTags, 'stored representation').to.equal(null);
      expect(await database.subset({ autoTags: { exists: false } })).to.include('patch-clear');
      expect(await database.subset({ autoTags: { exists: true } })).to.not.include('patch-clear');
    });
  });

  describe('countSubset', () => {
    // Mirrors the SQLite fixture set: the calibration eligibility funnel the
    // zero-shot tasks count before sampling.
    const saveFixture = async (
      hash: string,
      type: Media['type'],
      options: { tagged?: boolean; thumbnail?: boolean } = {},
    ): Promise<void> => {
      const media: BaseMedia = {
        hash,
        path: `/tmp/${hash}.bin`,
        dir: '/tmp',
        type,
        actors: [],
        tags: [],
        hashDate: Date.now(),
        metadata: { height: 1080, width: 1920 },
      };
      if (options.thumbnail) {
        media.thumbnail = true;
      }
      await database.saveMedia(hash, media);
      if (options.tagged) {
        await database.addMediaTag(hash, 'count-tag');
      }
    };

    before(async () => {
      await database.addTag('count-tag');
      // tagged still (thumbnail), untagged still, tagged still without a
      // thumbnail, tagged video and tagged gif.
      await saveFixture('count-tagged-still', 'still', { tagged: true, thumbnail: true });
      await saveFixture('count-untagged-still', 'still', { thumbnail: true });
      await saveFixture('count-tagged-no-thumbnail', 'still', { tagged: true });
      await saveFixture('count-tagged-video', 'video', { tagged: true });
      await saveFixture('count-tagged-gif', 'gif', { tagged: true });
    });

    after(async () => {
      await database.testCleanup();
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
      // The count leaves the caller's constraints untouched.
      expect(constraints).to.deep.equal({ tags: { exists: true }, sample: 1, limit: 1, sortBy: 'hashDate' });
    });

    it('counts an empty match as zero', async () => {
      expect(await database.countSubset({ hash: { equalsAny: ['missing'] } })).to.equal(0);
    });
  });

  // Same fixtures as test/database.ts: both engines must agree on the ignore
  // list's (hash, path) keying, or SCAN loses paths the other engine keeps.
  describe('Deleted media ignore list', () => {
    after(async () => {
      await database.testCleanup();
    });

    const rows = async (): Promise<DeletedMedia[]> =>
      (await database.getDeletedMedia()).sort((a, b) => a.hash.localeCompare(b.hash) || a.path.localeCompare(b.path));

    const rawDocument = (hash: string): Promise<Record<string, unknown> | null> => {
      const connector = database as unknown as { db: Db };
      return connector.db.collection('media.deleted').findOne({ hash });
    };

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

    it('stores only the hash and path when the indexer passes a whole media document', async () => {
      const media = await createMedia('ignored-media');
      await database.addDeleted(media);

      const document = await rawDocument('ignored-media');
      expect(document, 'stored ignore entry').to.not.equal(null);
      expect(document).to.include({ hash: 'ignored-media', path: '/tmp/ignored-media.jpg' });
      expect(document).to.not.have.property('metadata');
      expect(document).to.not.have.property('absolutePath');
    });

    it('is idempotent for a repeated hash and path', async () => {
      await database.addDeleted({ hash: 'ignored-0', path: 'a/one.jpg' });

      expect((await rows()).filter((row) => row.hash === 'ignored-0')).to.have.lengthOf(2);
    });

    it('removes every path recorded for a hash and leaves other hashes alone', async () => {
      await database.addDeleted({ hash: 'ignored-1', path: 'c/three.jpg' });

      await database.removeDeleted('ignored-0');

      expect(await rows()).to.deep.equal([
        { hash: 'ignored-1', path: 'c/three.jpg' },
        { hash: 'ignored-media', path: '/tmp/ignored-media.jpg' },
      ]);
      expect(await database.isDeletedPath('a/one.jpg')).to.equal(false);
      expect(await database.isDeletedPath('b/two.jpg')).to.equal(false);
      expect(await database.isDeletedHash('ignored-0')).to.equal(false);
      expect(await database.isDeletedHash('ignored-1')).to.equal(true);
    });

    it('is a no-op when the hash has no recorded paths', async () => {
      await database.removeDeleted('never-recorded');

      expect((await rows()).filter((row) => row.hash !== 'ignored-1')).to.have.lengthOf(1);
    });

    it('records the path when media is deleted with the import ignore flag', async () => {
      const media = await createMedia('ignored-on-delete');

      await database.removeMedia(media.hash, true);

      expect(await database.isDeletedPath(media.path)).to.equal(true);
      expect(await database.isDeletedHash(media.hash)).to.equal(true);
      expect(await database.getMedia(media.hash)).to.equal(undefined);
    });

    it('leaves the ignore list alone when media is deleted without the flag', async () => {
      const media = await createMedia('unignored-on-delete');

      await database.removeMedia(media.hash, false);

      expect(await database.isDeletedPath(media.path)).to.equal(false);
      expect(await database.isDeletedHash(media.hash)).to.equal(false);
    });
  });
});
