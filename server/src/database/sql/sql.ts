import { Database } from '../../types';
import FS from 'fs';
import Path from 'path';
import {
  BaseMedia,
  Configuration,
  Media,
  MediaPlaylist,
  Playlist,
  PlaylistCreate,
  PlaylistEntryUpdate,
  PlaylistUpdate,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
  Metadata
} from '@vimtur/common';
import Config from '../../config';
import { ObjectId } from 'mongodb';
import { BadRequest, NotFound } from '../../errors';

export interface SqlQueryOptions {
  transaction?: boolean;
}

export interface SqlQuery {
  sql: string;
  values?: unknown[];
  // Set to true if no results expected.
  run?: boolean;
}

export interface SqlModificationResult {
  modifiedCount: number;
}

const UPDATE_DIR = `${__dirname}/updates`;
const UPDATE_FILES = FS.readdirSync(UPDATE_DIR, { encoding: 'utf8' }).sort().filter(file => file.endsWith('.sql')).map(file => `${UPDATE_DIR}/${file}`);

export abstract class SqlConnector extends Database {
  protected abstract query(query: SqlQuery[], options?: SqlQueryOptions): Promise<unknown[][]>;
  public abstract close(): Promise<void>;

  public async update(): Promise<void> {
    await this.query([{
      sql: 'CREATE TABLE IF NOT EXISTS `updates` (`key` VARCHAR(255) PRIMARY KEY)',
      run: true
    }]);
    const [appliedFiles] = await this.query([{ sql: 'SELECT * FROM `updates`' }]);
    for (const file of UPDATE_FILES) {
      if (appliedFiles.includes(file)) {
        continue;
      }
      // Sync because the server doesn't listen until this is done
      // so it doesn't matter.
      const data = FS.readFileSync(file).toString();

      const queries = data.split('\n').map(line => {
        return line.split('--')[0].trim();
      }).filter(line => !!line).join('\n').split(';').map(query => query.trim()).filter(query => !!query).map(sql => ({ sql, run: true }));

      await this.query(queries);
    }
  }

  public async getMedia(hash: string): Promise<Media | undefined> {
    const [[mediaRaw], qualityCaches, autoTags, tags, actors, clones, playlists] = await this.query([
      { sql: 'SELECT * FROM media WHERE hash = ?', values: [hash] },
      { sql: 'SELECT * FROM media_quality_cache WHERE hash = ?', values: [hash] },
      { sql: 'SELECT * FROM media_auto_tags WHERE hash = ?', values: [hash] },
      { sql: 'SELECT * FROM media_tags INNER JOIN tags ON tags.id = media_tags.tagId WHERE hash = ?', values: [hash] },
      { sql: 'SELECT * FROM media_actors INNER JOIN actors ON actors.id = media_actors.actorId WHERE hash = ?', values: [hash] },
      { sql: 'SELECT * FROM media_clones WHERE hash = ?', values: [hash] },
      { sql: 'SELECT * FROM media_playlists WHERE hash = ?', values: [hash] },
    ]);
    if (!mediaRaw) {
      return undefined;
    }

    const mediaRecord: Record<string, unknown> = {};
    for (const key of Object.keys(mediaRaw as Record<string, unknown>)) {
      const value = (mediaRaw as Record<string, unknown>)[key];
      if (value === null || value === undefined) {
        continue;
      }
      if (key.startsWith('metadata_')) {
        const metadata = (mediaRecord.metadata || {}) as Record<string, unknown>;
        if (key === 'metadata_segments') {
          metadata[key.split('metadata_')[1]] = JSON.parse(value as string);
        } else {
          metadata[key.split('metadata_')[1]] = value;
        }
        mediaRecord.metadata = metadata;
      } else {
        mediaRecord[key] = value;
      }
    }

    if (qualityCaches.length) {
      const metadata = (mediaRecord.metadata || {}) as Record<string, unknown>;
      metadata.qualityCache = (qualityCaches as Array<{ quality: number }>).map(cache => cache.quality);
      mediaRecord.metadata = metadata;
    }

    if (autoTags.length) {
      mediaRecord.autoTags = (autoTags as Array<{tag: string }>).map(autoTag => autoTag.tag);
    }

    if (tags.length) {
      mediaRecord.tags = (tags as Array<{name: string }>).map(tagObj => tagObj.name);
    }

    if (actors.length) {
      mediaRecord.actors = (actors as Array<{name: string }>).map(actorObj => actorObj.name);
    }

    if (clones.length) {
      mediaRecord.clones = (clones as Array<{clone: string }>).map(cloneObj => cloneObj.clone);
    }

    if (playlists.length) {
      mediaRecord.playlists = (playlists as Array<{playlistId: string, order: number }>).map(playlistObj => ({ id: playlistObj.playlistId, order: playlistObj.order }));
    }

    mediaRecord.absolutePath = Path.resolve(Config.get().libraryPath, mediaRecord.path as string);

    return mediaRecord as unknown as Media;
  }

  public async saveMedia(hash: string, mediaRaw: UpdateMedia | BaseMedia): Promise<Media> {
    // TODO Save clones here?
    const media = mediaRaw as unknown as Partial<BaseMedia>;
    const metadata = media?.metadata as undefined | Partial<Metadata>;

    const fields = [
      { name: 'hash', value: hash },
      { name: 'path', value: media.path },
      { name: 'dir', value: media.dir },
      { name: 'rotation', value: media.rotation },
      { name: 'type', value: media.type },
      { name: 'hashDate', value: media.hashDate },
      { name: 'corrupted', value: media.corrupted },
      { name: 'thumbnail', value: media.thumbnail },
      { name: 'thumbnailOptimised', value: media.thumbnailOptimised },
      { name: 'rating', value: media.rating },
      { name: 'phash', value: media.phash },
      { name: 'cloneDate', value: media.cloneDate },
      // Metadata
      { name: 'metadata_createdAt', value: metadata?.createdAt },
      { name: 'metadata_length', value: metadata?.length },
      { name: 'metadata_artist', value: metadata?.artist },
      { name: 'metadata_album', value: metadata?.album },
      { name: 'metadata_title', value: metadata?.title },
      { name: 'metadata_codec', value: metadata?.codec },
      { name: 'metadata_maxCopy', value: metadata?.maxCopy },
      { name: 'metadata_segments', value: metadata?.segments !== undefined ? JSON.stringify(metadata.segments) : undefined },
    ].filter(field => field.value !== undefined);

    const sqlInsert = 'INSERT INTO media (' + fields.map(field => field.name).join(', ') + ') VALUES (' + fields.map(() => '?').join(', ') + ')';
    const valuesInsert = fields.map(field => field.value);

    const sqlUpdate = 'UPDATE media SET ' + fields.map(field => `${field.name} = ?`).join(', ') + ' WHERE hash = ?';
    const valuesUpdate = [...fields.map(field => field.value), hash];

    const [[updateResultRaw]] = await this.query([{ sql: sqlUpdate, values: valuesUpdate, run: true }]);
    const updateResult = updateResultRaw as SqlModificationResult;

    if (updateResult.modifiedCount === 0) {
      await this.query([{ sql: sqlInsert, values: valuesInsert, run: true }]);
    }

    if (metadata?.qualityCache) {
      await this.query([
        {
          sql: 'DELETE FROM media_quality_cache WHERE hash = ?',
          values: [ hash ],
          run: true
        },
        {
          sql: 'INSERT INTO media_quality_cache (hash, quality) VALUES ' + metadata.qualityCache.map(() => '(?, ?)').join(', '),
          values: metadata.qualityCache.map(quality => ({ hash, quality })),
          run: true
        }
      ], { transaction: true });
    }

    if (media?.autoTags) {
      await this.query([
        {
          sql: 'DELETE FROM media_auto_tags WHERE hash = ?',
          values: [ hash ],
          run: true
        },
        {
          sql: 'INSERT INTO media_auto_tags (hash, tag) VALUES ' + media.autoTags.map(() => '(?, ?)').join(', '),
          values: media.autoTags.map(tag => ({ hash, tag })),
          run: true
        }
      ], { transaction: true });
    }

    const fetchedMedia = await this.getMedia(hash);
    if (!fetchedMedia) {
      throw new NotFound('Inserted media not found');
    }
    return fetchedMedia;
  }

  public saveBulkMedia(
    constraints: SubsetConstraints,
    media: UpdateMedia,
  ): Promise<number> {
    console.log('saveBulkMedia', constraints, media);
    throw new Error('not implemented');
  }

  public removeMedia(hash: string): Promise<void> {
    console.log('removeMedia', hash);
    throw new Error('not implemented');
  }

  public addMediaTag(hash: string, tag: string): Promise<void> {
    console.log('addMediaTag', hash, tag);
    throw new Error('not implemented');
  }

  public removeMediaTag(hash: string, tag: string): Promise<void> {
    console.log('removeMediaTag', hash, tag);
    throw new Error('not implemented');
  }

  public addMediaActor(hash: string, actor: string): Promise<void> {
    console.log('addMediaActor', hash, actor);
    throw new Error('not implemented');
  }

  public removeMediaActor(hash: string, actor: string): Promise<void> {
    console.log('removeMediaActor', hash, actor);
    throw new Error('not implemented');
  }

  public async addMediaToPlaylist(hash: string, playlistId: string): Promise<MediaPlaylist> {
    const results = await this.query([{
      sql: `INSERT INTO media_playlists (hash, playlistId, \`order\`) VALUES
        (?, ?, IFNULL((SELECT MAX(media_playlists.\`order\`) FROM media_playlists WHERE playlistId = ?) + 1, 0))
      `,
      values: [hash, playlistId, playlistId],
      run: true
    }, {
      sql: 'SELECT * FROM `media_playlists` WHERE `hash` = ? AND `playlistId` = ?',
      values: [hash, playlistId]
    }, {
      sql: 'UPDATE playlists SET size = (SELECT COUNT(*) FROM media_playlists WHERE playlistId = ?) WHERE id = ?',
      values: [playlistId, playlistId],
      run: true
    }], { transaction: true });

    const mediaPlaylistRow = results[1][0] as {
      playlistId: string;
      order: number;
    };
    return {
      id: mediaPlaylistRow.playlistId,
      order: mediaPlaylistRow.order
    }
  }

  public async removeMediaFromPlaylist(hash: string, playlistId: string): Promise<void> {
    await this.query([
      {
        sql: 'UPDATE media_playlists SET `order` = `order` - 1 WHERE playlistId = ? AND `order` > (SELECT `order` FROM media_playlists WHERE hash = ? AND playlistId = ?)',
        values: [ playlistId, hash, playlistId ],
        run: true
      },
      {
        sql: 'DELETE FROM media_playlists WHERE hash = ? AND playlistId = ?',
        values: [hash, playlistId],
        run: true
      }, {
      sql: 'UPDATE playlists SET size = (SELECT COUNT(*) FROM media_playlists WHERE playlistId = ?) WHERE id = ?',
      values: [playlistId, playlistId],
      run: true
    }
    ]);
  }

  public async updateMediaPlaylistOrder(
    hash: string,
    playlistId: string,
    update: PlaylistEntryUpdate,
  ): Promise<void> {
    await this.query([
      {
        sql: 'UPDATE media_playlists SET `order` = `order` - 1 WHERE playlistId = ? AND `order` <= ? AND `order` > (SELECT `order` FROM media_playlists WHERE hash = ? AND playlistId = ?)',
        values: [playlistId, update.order, hash, playlistId],
        run: true,
      },
      {
        sql: 'UPDATE media_playlists SET `order` = `order` + 1 WHERE playlistId = ? AND `order` >= ? AND `order` < (SELECT `order` FROM media_playlists WHERE hash = ? AND playlistId = ?)',
        values: [playlistId, update.order, hash, playlistId],
        run: true,
      },
      {
        sql: 'UPDATE media_playlists SET `order` = ? WHERE hash = ? AND playlistId = ?',
        values: [update.order, hash, playlistId],
        run: true
      }
    ], { transaction: true });
  }

  public subset(constraints: SubsetConstraints): Promise<string[]> {
    console.log('subset', constraints);
    throw new Error('not implemented');
  }

  public subsetFields(
    constraints: SubsetConstraints,
    fields?: SubsetFields,
  ): Promise<BaseMedia[]> {
    const columns: string[] = fields ? Object.keys(fields).map(field => '`media`.`' + field + '`') : ['`media`.`hash`'];

    if (constraints.tags) {
      const tagQuery =
    }

    console.log('subsetFields', constraints, fields);
    throw new Error('not implemented');
  }

  public addActor(name: string): Promise<void> {
    console.log('addActor', name);
    throw new Error('not implemented');
  }

  public removeActor(name: string): Promise<void> {
    console.log('removeActor', name);
    throw new Error('not implemented');
  }

  public getActors(): Promise<string[]> {
    console.log('getActors');
    throw new Error('not implemented');
  }

  public addTag(name: string): Promise<void> {
    console.log('addTag', name);
    throw new Error('not implemented');
  }

  public removeTag(name: string): Promise<void> {
    console.log('removeTag', name);
    throw new Error('not implemented');
  }

  public getTags(): Promise<string[]> {
    console.log('getTags');
    throw new Error('not implemented');
  }

  public async addPlaylist(request: PlaylistCreate): Promise<Playlist> {
    const id = new ObjectId().toHexString();
    await this.query([{
      sql: 'INSERT INTO `playlists` (`id`, `name`, `thumbnail`) VALUES (?, ?, ?)',
      values: [ id, request.name, request.thumbnail || null ],
      run: true
    }]);

    if (request.hashes) {
      for (const hash of request.hashes) {
        await this.addMediaToPlaylist(hash, id);
      }
    }

    const playlist = await this.getPlaylist(id);
    if (!playlist) {
      throw new Error('New playlist not found');
    }
    return playlist;
  }

  public async removePlaylist(id: string): Promise<void> {
    await this.query([{
      sql: 'DELETE FROM playlists WHERE id = ?',
      values: [id],
      run: true
    }]);
  }

  public async updatePlaylist(id: string, request: PlaylistUpdate): Promise<void> {
    const updateFields = [
      { field: 'name', value: request.name },
      { field: 'thumbnail', value: request.thumbnail }
    ].filter(field => field.value !== undefined);
    if (updateFields.length === 0) {
      throw new BadRequest('No updates specified');
    }

    await this.query([{
      sql: 'UPDATE playlists SET ' + updateFields.map(field => `${field.field} = ?`).join(', ') + ' WHERE id = ?',
      values: [...updateFields.map(field => field.value), id],
      run: true
    }]);
  }

  public async getPlaylists(): Promise<Playlist[]> {
    const [playlists] = await this.query([{
      sql: 'SELECT * FROM `playlists` ORDER BY name'
    }]);
    return playlists as Playlist[];
  }

  public async getPlaylist(id: string): Promise<Playlist | undefined> {
    const [[playlistRow]] = await this.query([{
      sql: 'SELECT * FROM `playlists` WHERE `id` = ?',
      values: [id]
    }]);
    return playlistRow as Playlist | undefined;
  }

  public getUserConfig(): Promise<Configuration.Partial> {
    console.log('getUserConfig');
    throw new Error('not implemented');
  }

  public saveUserConfig(config: Configuration.Partial): Promise<void> {
    console.log('saveUserConfig', config);
    throw new Error('not implemented');
  }

  public resetClones(age: number): Promise<void> {
    console.log('resetClones', age);
    throw new Error('not implemented');
  }

  public resetAutoTags(): Promise<void> {
    console.log('resetAutoTags');
    throw new Error('not implemented');
  }
}
