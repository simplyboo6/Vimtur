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
import { v4 as uuidv4 } from 'uuid';
import { BadRequest, NotFound } from '../../errors';
import { Database } from '../../types';
import { SqliteController } from './controller';
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
  protected db: SqliteController;
  protected libraryPath: string;

  public constructor(db: SqliteController, libraryPath: string) {
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
    const db = new SqliteController(filename);
    await db.exec('CREATE TABLE IF NOT EXISTS `migrations` (`id` TEXT NOT NULL PRIMARY KEY)');
    for (const migrationFilename of ['001-initial.sql', '002-media-deleted-primary-key.sql']) {
      if (await db.get('SELECT * FROM `migrations` WHERE `id` = ?', [migrationFilename])) {
        continue;
      }
      const path = Path.resolve(__dirname, 'migrations', migrationFilename);
      const migration = await FS.readFile(path).then((file) => file.toString());
      await db.exec(migration);
      await db.run('INSERT INTO `migrations` (`id`) VALUES (?)', [migrationFilename]);
    }

    return new SqliteConnector(db, libraryPath);
  }

  // Media
  public async getMedia(hash: string): Promise<Media | undefined> {
    const rawMedia = await this.db.get<RawMedia>('SELECT * FROM `media` WHERE `hash` = ?', [hash]);
    if (!rawMedia) {
      return undefined;
    }
    const media = rawMediaToMedia(rawMedia);
    const tags = await this.db.all<{
      tag_id: string;
    }>('SELECT `tag_id` FROM `media_tags` WHERE `media_hash` = ?', [hash]);
    const actors = await this.db.all<{ actor_id: string }>(
      'SELECT `actor_id` FROM `media_actors` WHERE `media_hash` = ?',
      [hash],
    );
    const mediaPlaylists = await this.db.all<{ playlist_id: string; order: number }>(
      'SELECT * FROM `media_playlists` WHERE `media_hash` = ?',
      [hash],
    );
    return {
      ...media,
      tags: tags.map((tag) => tag.tag_id),
      actors: actors.map((actor) => actor.actor_id),
      playlists: mediaPlaylists.map((playlist) => ({ id: playlist.playlist_id, order: playlist.order })),
      absolutePath: Path.resolve(this.libraryPath, media.path),
    };
  }

  public async saveMedia(hash: string, update: UpdateMedia | BaseMedia): Promise<Media> {
    const { query, values } = makeMediaUpsert(hash, update);
    await this.db.transaction((transaction) => {
      transaction.run(query + ' WHERE `hash` = ?', [...values, hash]);
      const baseMedia = update as BaseMedia;
      if (baseMedia.tags) {
        transaction.run('DELETE FROM `media_tags` WHERE `media_hash` = ?', [hash]);
        if (baseMedia.tags.length > 0) {
          const values: unknown[] = [];
          for (const tag of baseMedia.tags) {
            values.push(hash, tag);
          }
          transaction.run(
            'INSERT INTO `media_tags` (`media_hash`, `tag_id`) VALUES ' + baseMedia.tags.map(() => '(?, ?)').join(', '),
            values,
          );
        }
      }
      if (baseMedia.actors) {
        transaction.run('DELETE FROM `media_actors` WHERE `media_hash` = ?', [hash]);
        if (baseMedia.actors.length > 0) {
          const values: unknown[] = [];
          for (const actor of baseMedia.actors) {
            values.push(hash, actor);
          }
          transaction.run(
            'INSERT INTO `media_actors` (`media_hash`, `actor_id`) VALUES ' +
              baseMedia.actors.map(() => '(?, ?)').join(', '),
            values,
          );
        }
      }
    });

    const media = await this.getMedia(update.hash ?? hash);
    if (!media) {
      throw new Error('Failed to find media after update');
    }
    return media;
  }

  public async saveBulkMedia(constraints: SubsetConstraints, media: UpdateMedia): Promise<number> {
    const updateQuery = makeMediaUpdate(media);
    const constraintsQuery = buildMediaQuery(constraints);
    const query =
      updateQuery.query +
      ' FROM (' +
      constraintsQuery.query +
      ') AS `joined_media` WHERE `joined_media`.`hash` = `media`.`hash`';
    const values = [...updateQuery.values, ...constraintsQuery.values];
    const res = await this.db.run(query, values);
    return res.changes;
  }

  public async removeMedia(hash: string, ignoreInImport: boolean): Promise<void> {
    if (ignoreInImport) {
      const media = await this.getMedia(hash);
      if (media) {
        await this.addDeleted(media);
      }
    }
    await this.db.run('DELETE FROM `media` WHERE `hash` = ?', [hash]);
  }

  public async addDeleted(deleted: DeletedMedia): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO `media_deleted` (`hash`, `path`) VALUES (?, ?)', [
      deleted.hash,
      deleted.path,
    ]);
  }

  public async isDeletedPath(path: string): Promise<boolean> {
    const deletedItem = await this.db.get<unknown>('SELECT * FROM `media_deleted` WHERE `path` = ?', [path]);
    return deletedItem !== null && deletedItem !== undefined;
  }

  public async isDeletedHash(hash: string): Promise<boolean> {
    const deletedItem = await this.db.get<unknown>('SELECT * FROM `media_deleted` WHERE `hash` = ?', [hash]);
    return deletedItem !== null && deletedItem !== undefined;
  }

  public getDeletedMedia(): Promise<DeletedMedia[]> {
    return this.db.all<DeletedMedia>('SELECT * FROM `media_deleted`');
  }

  // Media - tags
  public async addMediaTag(hash: string, tag: string): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO `media_tags` (`media_hash`, `tag_id`) VALUES (?, ?)', [hash, tag]);
  }

  public async removeMediaTag(hash: string, tag: string): Promise<void> {
    await this.db.run('DELETE FROM `media_tags` WHERE `media_hash` = ? AND `tag_id` = ?', [hash, tag]);
  }

  // Media - actors
  public async addMediaActor(hash: string, actor: string): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO `media_actors` (`media_hash`, `actor_id`) VALUES (?, ?)', [hash, actor]);
  }

  public async removeMediaActor(hash: string, actor: string): Promise<void> {
    await this.db.run('DELETE FROM `media_actors` WHERE `media_hash` = ? AND `actor_id` = ?', [hash, actor]);
  }
  // Media - playlists
  public async addMediaToPlaylist(hash: string, playlistId: string): Promise<MediaPlaylist> {
    await this.db.transaction((transaction) => {
      transaction.run(
        'INSERT OR IGNORE INTO `media_playlists` (`media_hash`, `playlist_id`, `order`) VALUES (?, ?, IFNULL((SELECT MAX(`order`) FROM `media_playlists` WHERE `playlist_id` = ?) + 1, 0))',
        [hash, playlistId, playlistId],
      );
      transaction.run(
        'UPDATE `playlists` SET `size` = (SELECT COUNT(*) FROM `media_playlists` WHERE `playlist_id` = ?) WHERE `id` = ?',
        [playlistId, playlistId],
      );
    });
    const mediaPlaylist = await this.db.get<{ order: number }>(
      'SELECT `order` FROM `media_playlists` WHERE `media_hash` = ? AND `playlist_id` = ?',
      [hash, playlistId],
    );
    if (!mediaPlaylist) {
      throw new Error('Unable to find media added to playlist');
    }
    return { id: playlistId, order: mediaPlaylist.order };
  }

  public async removeMediaFromPlaylist(hash: string, playlistId: string): Promise<void> {
    await this.db.transaction((transaction) => {
      transaction.run(
        'UPDATE `media_playlists` SET `order` = `order` - 1 WHERE `playlist_id` = ? AND `order` > (SELECT `order` FROM `media_playlists` WHERE `playlist_id` = ? AND `media_hash` = ?)',
        [playlistId, playlistId, hash],
      );
      transaction.run('DELETE FROM `media_playlists` WHERE `media_hash` = ? AND `playlist_id` = ?', [hash, playlistId]);
      transaction.run(
        'UPDATE `playlists` SET `size` = IFNULL((SELECT COUNT(*) FROM `media_playlists` WHERE `playlist_id` = ?), 0) WHERE `id` = ?',
        [playlistId, playlistId],
      );
    });
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

    const mediaPlaylist = await this.db.get<{ order: number }>(
      'SELECT `order` FROM `media_playlists` WHERE `media_hash` = ? AND `playlist_id` = ?',
      [hash, playlistId],
    );
    if (!mediaPlaylist) {
      throw new BadRequest('Media not already in playlist');
    }
    const oldLocation = mediaPlaylist.order;
    await this.db.transaction((transaction) => {
      if (newLocation > oldLocation) {
        transaction.run(
          'UPDATE `media_playlists` SET `order` = `order` - 1 WHERE `playlist_id` = ? AND `order` > ? AND `order` <= ?',
          [playlistId, oldLocation, newLocation],
        );
        transaction.run('UPDATE `media_playlists` SET `order` = ? WHERE `playlist_id` = ? AND `media_hash` = ?', [
          newLocation,
          playlistId,
          hash,
        ]);
      } else {
        transaction.run(
          'UPDATE `media_playlists` SET `order` = `order` + 1 WHERE `playlist_id` = ? AND `order` < ? AND `order` >= ?',
          [playlistId, oldLocation, newLocation],
        );
        transaction.run('UPDATE `media_playlists` SET `order` = ? WHERE `playlist_id` = ? AND `media_hash` = ?', [
          newLocation,
          playlistId,
          hash,
        ]);
      }
    });
  }

  // Searching
  public async subset(constraints: SubsetConstraints): Promise<string[]> {
    const { query, values } = buildMediaQuery(constraints);
    const raw = await this.db.all<{ hash: string }>(query, values);
    return raw.map((el) => el.hash);
  }

  public async subsetFields(constraints: SubsetConstraints, fields: SubsetFields | 'all'): Promise<BaseMedia[]> {
    const { query, values } = buildMediaQuery(constraints, fields);
    const raw = await this.db.all<RawMedia>(query, values);
    return raw.map((el) => rawToPartial<RawMedia, Media>(el, mediaFieldMap)) as BaseMedia[];
  }

  // Actors
  public async addActor(name: string): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO `actors` (`id`) VALUES (?)', [name]);
  }

  public async removeActor(name: string): Promise<void> {
    await this.db.run('DELETE FROM `actors` WHERE `id` = ?', [name]);
  }

  public async getActors(): Promise<string[]> {
    const raw = await this.db.all<{ id: string }>('SELECT * FROM `actors`');
    return raw.map((el) => el.id);
  }

  // Tags
  public async addTag(name: string): Promise<void> {
    await this.db.run('INSERT OR IGNORE INTO `tags` (`id`) VALUES (?)', [name]);
  }

  public async removeTag(name: string): Promise<void> {
    await this.db.run('DELETE FROM `tags` WHERE `id` = ?', [name]);
  }

  public async getTags(): Promise<string[]> {
    const raw = await this.db.all<{ id: string }>('SELECT * FROM `tags`');
    return raw.map((el) => el.id);
  }

  // Playlists
  public async addPlaylist(request: PlaylistCreate): Promise<Playlist> {
    const id = uuidv4();
    await this.db.run('INSERT INTO `playlists` (`id`, `name`, `thumbnail`) VALUES (?, ?, ?)', [
      id,
      request.name,
      request.thumbnail || null,
    ]);
    for (const hash of request.hashes || []) {
      await this.addMediaToPlaylist(hash, id);
    }
    const playlist = await this.getPlaylist(id);
    if (!playlist) {
      throw new NotFound('Failed to get new playlist');
    }
    return playlist;
  }

  public async removePlaylist(id: string): Promise<void> {
    await this.db.run('DELETE FROM `playlists` WHERE `id` = ?', [id]);
  }

  public async updatePlaylist(id: string, request: PlaylistUpdate): Promise<void> {
    await this.db.run(
      'UPDATE `playlists` SET `name` = IFNULL(?, `name`), `thumbnail` = IFNULL(?, `thumbnail`) WHERE `id` = ?',
      [request.name || null, request.thumbnail || null, id],
    );
  }

  public async getPlaylists(): Promise<Playlist[]> {
    const raw = await this.db.all<RawPlaylist>('SELECT * FROM `playlists`');
    return raw.map(mapRawPlaylist);
  }

  public async getPlaylist(id: string): Promise<Playlist | undefined> {
    const raw = await this.db.get<RawPlaylist>('SELECT * FROM `playlists` WHERE `id` = ?', [id]);
    if (!raw) {
      return undefined;
    }
    return mapRawPlaylist(raw);
  }

  // Config
  public async getUserConfig(): Promise<Configuration.Partial> {
    const row = await this.db.get<{ key: string; value: string }>("SELECT * FROM `config` WHERE `key` = 'user'");
    if (!row) {
      return {};
    }
    return JSON.parse(row.value);
  }
  public async saveUserConfig(config: Configuration.Partial): Promise<void> {
    await this.db.run("INSERT OR REPLACE INTO `config` (`key`, `value`) VALUES('user', ?)", [JSON.stringify(config)]);
  }

  // Utility
  public close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  public async resetAutoTags(): Promise<void> {
    await this.db.run(
      'UPDATE `media` SET `auto_tags` = NULL WHERE `hash` IN (SELECT `hash` FROM `media` WHERE `auto_tags` IS NOT NULL)',
    );
  }

  public async testCleanup(): Promise<void> {
    if (!process.env.TEST_MODE) {
      throw new Error('testCleanup called outside of test mode');
    }
    for (const table of ['playlists', 'media_fts', 'media', 'media_deleted', 'tags', 'actors', 'config']) {
      await this.db.run(`DELETE FROM ${table}`);
    }
  }
}
