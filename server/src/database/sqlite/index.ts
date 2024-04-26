import FS from 'fs/promises';
import Path from 'path';
import type {
  BaseMedia,
  Configuration,
  DeletedMedia,
  Media,
  MediaPlaylist,
  Playlist,
  PlaylistCreate,
  PlaylistEntryUpdate,
  PlaylistUpdate,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
} from '@vimtur/common';
import Sqlite, { Database as SqliteDb } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { BadRequest, NotFound } from '../../errors';
import { Database } from '../../types';
import {
  buildMediaQuery,
  makeMediaUpdate,
  makeMediaUpsert,
  mapRawPlaylist,
  mediaFieldMap,
  RawMedia,
  rawMediaToMedia,
  RawPlaylist,
  rawToPartial,
} from './utils';

export class SqliteConnector extends Database {
  protected db: SqliteDb;
  protected libraryPath: string;

  public constructor(db: SqliteDb, libraryPath: string) {
    super();
    this.db = db;
    this.libraryPath = libraryPath;
  }

  public static async init({
    filename,
    libraryPath,
  }: {
    filename: string;
    libraryPath: string;
  }): Promise<SqliteConnector> {
    const db = new Sqlite(filename);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS `migrations` (`id` TEXT NOT NULL PRIMARY KEY)');
    for (const migrationFilename of ['001-initial.sql', '002-media-deleted-primary-key.sql']) {
      if (db.prepare('SELECT * FROM `migrations` WHERE `id` = ?').get(migrationFilename)) {
        continue;
      }
      const path = Path.resolve(__dirname, 'migrations', migrationFilename);
      const migration = await FS.readFile(path).then((file) => file.toString());
      db.exec(migration);
      db.prepare('INSERT INTO `migrations` (`id`) VALUES (?)').run(migrationFilename);
    }

    return new SqliteConnector(db, libraryPath);
  }

  // Media
  public getMedia(hash: string): Promise<Media | undefined> {
    const rawMedia = this.db.prepare('SELECT * FROM `media` WHERE `hash` = ?').get(hash) as undefined | RawMedia;
    if (!rawMedia) {
      return Promise.resolve(undefined);
    }
    const media = rawMediaToMedia(rawMedia);
    const tags = this.db.prepare('SELECT `tag_id` FROM `media_tags` WHERE `media_hash` = ?').all(hash) as Array<{
      tag_id: string;
    }>;
    const actors = this.db.prepare('SELECT `actor_id` FROM `media_actors` WHERE `media_hash` = ?').all(hash) as Array<{
      actor_id: string;
    }>;
    const mediaPlaylists = this.db
      .prepare('SELECT * FROM `media_playlists` WHERE `media_hash` = ?')
      .all(hash) as Array<{ playlist_id: string; order: number }>;
    return Promise.resolve({
      ...media,
      tags: tags.map((tag) => tag.tag_id),
      actors: actors.map((actor) => actor.actor_id),
      playlists: mediaPlaylists.map((playlist) => ({ id: playlist.playlist_id, order: playlist.order })),
      absolutePath: Path.resolve(this.libraryPath, media.path),
    });
  }

  public async saveMedia(hash: string, update: UpdateMedia | BaseMedia): Promise<Media> {
    const { query, values } = makeMediaUpsert({ ...update, hash });
    this.db.prepare(query + ' WHERE `hash` = ?').run(...values, hash);
    const baseMedia = update as BaseMedia;
    if (baseMedia.tags) {
      this.db.prepare('DELETE FROM `media_tags` WHERE `media_hash` = ?').run(hash);
      if (baseMedia.tags.length > 0) {
        const values: unknown[] = [];
        for (const tag of baseMedia.tags) {
          values.push(hash, tag);
        }
        this.db
          .prepare(
            'INSERT INTO `media_tags` (`media_hash`, `tag_id`) VALUES ' + baseMedia.tags.map(() => '(?, ?)').join(', '),
          )
          .run(...values);
      }
    }
    if (baseMedia.actors) {
      this.db.prepare('DELETE FROM `media_actors` WHERE `media_hash` = ?').run(hash);
      if (baseMedia.actors.length > 0) {
        const values: unknown[] = [];
        for (const actor of baseMedia.actors) {
          values.push(hash, actor);
        }
        this.db
          .prepare(
            'INSERT INTO `media_actors` (`media_hash`, `actor_id`) VALUES ' +
              baseMedia.actors.map(() => '(?, ?)').join(', '),
          )
          .run(...values);
      }
    }

    const media = await this.getMedia(hash);
    if (!media) {
      throw new Error('Failed to find media after update');
    }
    return media;
  }

  public saveBulkMedia(constraints: SubsetConstraints, media: UpdateMedia): Promise<number> {
    const updateQuery = makeMediaUpdate(media);
    const constraintsQuery = buildMediaQuery(constraints);
    const query =
      updateQuery.query +
      ' FROM (' +
      constraintsQuery.query +
      ') AS `joined_media` WHERE `joined_media`.`hash` = `media`.`hash`';
    const values = [...updateQuery.values, ...constraintsQuery.values];
    const res = this.db.prepare(query).run(...values) as { changes: number };
    return Promise.resolve(res.changes);
  }

  public async removeMedia(hash: string, ignoreInImport: boolean): Promise<void> {
    if (ignoreInImport) {
      const media = await this.getMedia(hash);
      if (media) {
        await this.addDeleted(media);
      }
    }
    this.db.prepare('DELETE FROM `media` WHERE `hash` = ?').run(hash);
  }

  public addDeleted(deleted: DeletedMedia): Promise<void> {
    this.db
      .prepare('INSERT OR IGNORE INTO `media_deleted` (`hash`, `path`) VALUES (?, ?)')
      .run(deleted.hash, deleted.path);
    return Promise.resolve();
  }

  public isDeletedPath(path: string): Promise<boolean> {
    const deletedItem = this.db.prepare('SELECT * FROM `media_deleted` WHERE `path` = ?').get(path);
    return Promise.resolve(deletedItem !== null && deletedItem !== undefined);
  }

  public isDeletedHash(hash: string): Promise<boolean> {
    const deletedItem = this.db.prepare('SELECT * FROM `media_deleted` WHERE `hash` = ?').get(hash);
    return Promise.resolve(deletedItem !== null && deletedItem !== undefined);
  }

  public getDeletedMedia(): Promise<DeletedMedia[]> {
    return Promise.resolve(this.db.prepare('SELECT * FROM `media_deleted`').all() as DeletedMedia[]);
  }

  // Media - tags
  public addMediaTag(hash: string, tag: string): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO `media_tags` (`media_hash`, `tag_id`) VALUES (?, ?)').run(hash, tag);
    return Promise.resolve();
  }

  public removeMediaTag(hash: string, tag: string): Promise<void> {
    this.db.prepare('DELETE FROM `media_tags` WHERE `media_hash` = ? AND `tag_id` = ?').run(hash, tag);
    return Promise.resolve();
  }

  // Media - actors
  public addMediaActor(hash: string, actor: string): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO `media_actors` (`media_hash`, `actor_id`) VALUES (?, ?)').run(hash, actor);
    return Promise.resolve();
  }

  public removeMediaActor(hash: string, actor: string): Promise<void> {
    this.db.prepare('DELETE FROM `media_actors` WHERE `media_hash` = ? AND `actor_id` = ?').run(hash, actor);
    return Promise.resolve();
  }
  // Media - playlists
  public addMediaToPlaylist(hash: string, playlistId: string): Promise<MediaPlaylist> {
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO `media_playlists` (`media_hash`, `playlist_id`, `order`) VALUES (?, ?, IFNULL((SELECT MAX(`order`) FROM `media_playlists` WHERE `playlist_id` = ?) + 1, 0))',
        )
        .run(hash, playlistId, playlistId);
      this.db
        .prepare(
          'UPDATE `playlists` SET `size` = (SELECT COUNT(*) FROM `media_playlists` WHERE `playlist_id` = ?) WHERE `id` = ?',
        )
        .run(playlistId, playlistId);
    })();
    const mediaPlaylist = this.db
      .prepare('SELECT `order` FROM `media_playlists` WHERE `media_hash` = ? AND `playlist_id` = ?')
      .get(hash, playlistId) as undefined | { order: number };
    if (!mediaPlaylist) {
      throw new Error('Unable to find media added to playlist');
    }
    return Promise.resolve({ id: playlistId, order: mediaPlaylist.order });
  }

  public removeMediaFromPlaylist(hash: string, playlistId: string): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE `media_playlists` SET `order` = `order` - 1 WHERE `playlist_id` = ? AND `order` > (SELECT `order` FROM `media_playlists` WHERE `playlist_id` = ? AND `media_hash` = ?)',
        )
        .run(playlistId, playlistId, hash);
      this.db
        .prepare('DELETE FROM `media_playlists` WHERE `media_hash` = ? AND `playlist_id` = ?')
        .run(hash, playlistId);
      this.db
        .prepare(
          'UPDATE `playlists` SET `size` = IFNULL((SELECT COUNT(*) FROM `media_playlists` WHERE `playlist_id` = ?), 0) WHERE `id` = ?',
        )
        .run(playlistId, playlistId);
    })();
    return Promise.resolve();
  }
  public async updateMediaPlaylistOrder(hash: string, playlistId: string, update: PlaylistEntryUpdate): Promise<void> {
    const playlist = await this.getPlaylist(playlistId);
    if (!playlist) {
      throw new NotFound(`No playlist found with id ${playlistId}`);
    }

    if (update.order >= playlist.size) {
      throw new BadRequest(`Requested location (${update.order}) is >= playlist size (${playlist.size})`);
    }

    const newLocation = update.order;
    if (newLocation < 0) {
      throw new BadRequest(`Requested location (${update.order}) is less than 0`);
    }

    this.db.transaction(() => {
      const mediaPlaylist = this.db
        .prepare('SELECT `order` FROM `media_playlists` WHERE `media_hash` = ? AND `playlist_id` = ?')
        .get(hash, playlistId) as { order: number } | undefined;
      if (!mediaPlaylist) {
        throw new BadRequest('Media not already in playlist');
      }
      const oldLocation = mediaPlaylist.order;

      if (newLocation > oldLocation) {
        this.db
          .prepare(
            'UPDATE `media_playlists` SET `order` = `order` - 1 WHERE `playlist_id` = ? AND `order` > ? AND `order` <= ?',
          )
          .run(playlistId, oldLocation, newLocation);
        this.db
          .prepare('UPDATE `media_playlists` SET `order` = ? WHERE `playlist_id` = ? AND `media_hash` = ?')
          .run(newLocation, playlistId, hash);
      } else {
        this.db
          .prepare(
            'UPDATE `media_playlists` SET `order` = `order` + 1 WHERE `playlist_id` = ? AND `order` < ? AND `order` >= ?',
          )
          .run(playlistId, oldLocation, newLocation);
        this.db
          .prepare('UPDATE `media_playlists` SET `order` = ? WHERE `playlist_id` = ? AND `media_hash` = ?')
          .run(newLocation, playlistId, hash);
      }
    })();
    return Promise.resolve();
  }

  // Searching
  public subset(constraints: SubsetConstraints): Promise<string[]> {
    const { query, values } = buildMediaQuery(constraints);
    const raw = this.db.prepare(query).all(...values) as Array<{ hash: string }>;
    return Promise.resolve(raw.map((el) => el.hash));
  }

  public subsetFields(constraints: SubsetConstraints, fields: SubsetFields | 'all'): Promise<BaseMedia[]> {
    const { query, values } = buildMediaQuery(constraints, fields);
    const raw = this.db.prepare(query).all(...values) as Array<RawMedia>;
    return Promise.resolve(raw.map((el) => rawToPartial<RawMedia, Media>(el, mediaFieldMap)) as BaseMedia[]);
  }

  // Actors
  public addActor(name: string): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO `actors` (`id`) VALUES (?)').run(name);
    return Promise.resolve();
  }

  public removeActor(name: string): Promise<void> {
    this.db.prepare('DELETE FROM `actors` WHERE `id` = ?').run(name);
    return Promise.resolve();
  }

  public getActors(): Promise<string[]> {
    const raw = this.db.prepare('SELECT * FROM `actors`').all() as Array<{ id: string }>;
    return Promise.resolve(raw.map((el) => el.id));
  }

  // Tags
  public addTag(name: string): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO `tags` (`id`) VALUES (?)').run(name);
    return Promise.resolve();
  }

  public removeTag(name: string): Promise<void> {
    this.db.prepare('DELETE FROM `tags` WHERE `id` = ?').run(name);
    return Promise.resolve();
  }

  public getTags(): Promise<string[]> {
    const raw = this.db.prepare('SELECT * FROM `tags`').all() as Array<{ id: string }>;
    return Promise.resolve(raw.map((el) => el.id));
  }

  // Playlists
  public async addPlaylist(request: PlaylistCreate): Promise<Playlist> {
    const id = uuidv4();
    this.db
      .prepare('INSERT INTO `playlists` (`id`, `name`, `thumbnail`) VALUES (?, ?, ?)')
      .run(id, request.name, request.thumbnail || null);
    for (const hash of request.hashes || []) {
      await this.addMediaToPlaylist(hash, id);
    }
    const playlist = await this.getPlaylist(id);
    if (!playlist) {
      throw new NotFound('Failed to get new playlist');
    }
    return playlist;
  }

  public removePlaylist(id: string): Promise<void> {
    this.db.prepare('DELETE FROM `playlists` WHERE `id` = ?').run(id);
    return Promise.resolve();
  }

  public updatePlaylist(id: string, request: PlaylistUpdate): Promise<void> {
    this.db
      .prepare('UPDATE `playlists` SET `name` = IFNULL(?, `name`), `thumbnail` = IFNULL(?, `thumbnail`) WHERE `id` = ?')
      .run(request.name || null, request.thumbnail || null, id);
    return Promise.resolve();
  }

  public getPlaylists(): Promise<Playlist[]> {
    const raw = this.db.prepare('SELECT * FROM `playlists`').all() as RawPlaylist[];
    return Promise.resolve(raw.map(mapRawPlaylist));
  }

  public getPlaylist(id: string): Promise<Playlist | undefined> {
    const raw = this.db.prepare('SELECT * FROM `playlists` WHERE `id` = ?').get(id) as RawPlaylist | undefined;
    if (!raw) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(mapRawPlaylist(raw));
  }

  // Config
  public getUserConfig(): Promise<Configuration.Partial> {
    const row = this.db.prepare("SELECT * FROM `config` WHERE `key` = 'user'").get() as
      | { key: string; value: string }
      | undefined;
    if (!row) {
      return Promise.resolve({});
    }
    return Promise.resolve(JSON.parse(row.value));
  }
  public saveUserConfig(config: Configuration.Partial): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO `config` (`key`, `value`) VALUES('user', ?)").run(JSON.stringify(config));
    return Promise.resolve();
  }

  // Utility
  public close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  public resetClones(): Promise<void> {
    this.db.exec(
      'UPDATE `media` SET `clones` = NULL WHERE `hash` IN ((SELECT `hash` FROM `media` WHERE `clones` IS NOT NULL))',
    );
    return Promise.resolve();
  }

  public async resetAutoTags(): Promise<void> {
    this.db.exec(
      'UPDATE `media` SET `auto_tags` = NULL WHERE `hash` IN ((SELECT `hash` FROM `media` WHERE `auto_tags` IS NOT NULL))',
    );
    return Promise.resolve();
  }

  public async testCleanup(): Promise<void> {
    if (!process.env.TEST_MODE) {
      throw new Error('testCleanup called outside of test mode');
    }
    this.db.exec('DELETE FROM `playlists`');
    this.db.exec('DELETE FROM `media_fts`');
    this.db.exec('DELETE FROM `media`');
    this.db.exec('DELETE FROM `media_deleted`');
    this.db.exec('DELETE FROM `tags`');
    this.db.exec('DELETE FROM `actors`');
    this.db.exec('DELETE FROM `config`');
  }
}
