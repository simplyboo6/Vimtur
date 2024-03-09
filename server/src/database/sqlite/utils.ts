import type {
  ArrayFilter,
  BaseMedia,
  Media,
  MediaType,
  Metadata,
  NumberFilter,
  Playlist,
  StringFilter,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
} from '@vimtur/common';

export interface RawPlaylist {
  id: string;
  name: string;
  thumbnail: string | null;
  size: number;
}

export function mapRawPlaylist(raw: RawPlaylist): Playlist {
  const playlist: Playlist = {
    id: raw.id,
    name: raw.name,
    size: raw.size,
  };
  if (raw.thumbnail) {
    playlist.thumbnail = raw.thumbnail;
  }
  return playlist;
}

export interface RawMedia {
  hash: string;
  path: string | null;
  dir: string | null;
  type: MediaType | null; // string
  hash_date: number | null;
  rotation: number | null;
  corrupted: number | null;
  thumbnail: number | null;
  thumbnail_optimised: number | null;
  preview: number | null;
  preview_optimised: number | null;
  rating: number | null;
  phash: string | null;
  duplicate_of: string | null;
  clone_date: number | null;
  auto_tags: string | null; // JSON string[]
  clones: string | null; // JSON string[]
  unrelated: string | null; // JSON string[]

  metadata_width: number | null;
  metadata_height: number | null;
  metadata_length: number | null;
  metadata_artist: string | null;
  metadata_album: string | null;
  metadata_title: string | null;
  metadata_created_at: number | null;
  metadata_codec: string | null;
  metadata_quality_cache: string | null; // JSON number[];
  metadata_max_copy: boolean | null;
  metadata_segments: string | null; // JSON SegmentMetadata;
}

export const mediaFieldMap: Array<{ db: keyof RawMedia; js: keyof Media; cast?: 'json' | 'bool' }> = [
  { db: 'hash', js: 'hash' },
  { db: 'path', js: 'path' },
  { db: 'dir', js: 'dir' },
  { db: 'type', js: 'type' },
  { db: 'rotation', js: 'rotation' },
  { db: 'hash_date', js: 'hashDate' },
  { db: 'corrupted', js: 'corrupted', cast: 'bool' },
  { db: 'thumbnail', js: 'thumbnail', cast: 'bool' },
  { db: 'thumbnail_optimised', js: 'thumbnailOptimised', cast: 'bool' },
  { db: 'preview', js: 'preview', cast: 'bool' },
  { db: 'preview_optimised', js: 'previewOptimised', cast: 'bool' },
  { db: 'rating', js: 'rating' },
  { db: 'phash', js: 'phash' },
  { db: 'duplicate_of', js: 'duplicateOf' },
  { db: 'clone_date', js: 'cloneDate' },
  { db: 'auto_tags', js: 'autoTags', cast: 'json' },
  { db: 'clones', js: 'clones', cast: 'json' },
  { db: 'unrelated', js: 'unrelated', cast: 'json' },
];
const requiredMediaKeys = ['hash', 'path', 'dir', 'type', 'hashDate'] as const;

const mediaMetadataFieldMap: Array<{ db: keyof RawMedia; js: keyof Metadata; cast?: 'bool' | 'json' }> = [
  { db: 'metadata_width', js: 'width' },
  { db: 'metadata_height', js: 'height' },
  { db: 'metadata_length', js: 'length' },
  { db: 'metadata_artist', js: 'artist' },
  { db: 'metadata_album', js: 'album' },
  { db: 'metadata_title', js: 'title' },
  { db: 'metadata_created_at', js: 'createdAt' },
  { db: 'metadata_codec', js: 'codec' },
  { db: 'metadata_quality_cache', js: 'qualityCache', cast: 'json' },
  { db: 'metadata_max_copy', js: 'maxCopy', cast: 'bool' },
  { db: 'metadata_segments', js: 'segments', cast: 'json' },
];
const requiredMediaMetadataKeys = ['width', 'height'] as const;

export function mapMediaDbField(field: keyof RawMedia, table = true): string {
  return table ? '`media`.`' + field + '`' : '`' + field + '`';
}

export function rawToPartial<T, K>(
  raw: T,
  mapList: Array<{ db: keyof T; js: keyof K; cast?: 'bool' | 'json' }>,
): Partial<K> {
  const intermediate: Partial<K> = {};

  for (const map of mapList) {
    const value = raw[map.db];
    if (value === null || value === undefined) {
      continue;
    }
    switch (map.cast) {
      case 'bool':
        intermediate[map.js] = Boolean(value) as unknown as undefined;
        break;
      case 'json':
        if (typeof value !== 'string') {
          throw new Error(`Attempt to parse non-string JSON value: ${String(map.js)} - ${String(value)}`);
        }
        intermediate[map.js] = JSON.parse(value);
        break;
      default:
        intermediate[map.js] = value as unknown as undefined;
        break;
    }
  }

  return intermediate;
}

export function rawMediaToMedia(raw: RawMedia): Omit<Media, 'tags' | 'actors' | 'playlists' | 'absolutePath'> {
  const intermediate = rawToPartial<RawMedia, Media>(raw, mediaFieldMap);

  if (!intermediate.path) {
    throw new Error('Cannot calculate absolutePath without path');
  }

  const metadataIntermediate = rawToPartial<RawMedia, Metadata>(raw, mediaMetadataFieldMap);
  if (Object.values(metadataIntermediate).find((val) => val !== undefined)) {
    for (const key of requiredMediaMetadataKeys) {
      if (metadataIntermediate[key] === undefined) {
        throw new Error(`Required key undefined: ${key}`);
      }
    }
    intermediate.metadata = metadataIntermediate as Metadata;
  }

  for (const key of requiredMediaKeys) {
    if (intermediate[key] === undefined) {
      throw new Error(`Required key undefined: ${key}`);
    }
  }
  return intermediate as Media;
}

export function makeMediaUpsert(mediaRaw: UpdateMedia | BaseMedia): QueryObj {
  const media = mediaRaw as Partial<Media>;
  const keyValues: Partial<Record<keyof RawMedia, unknown>> = {};
  for (const map of mediaFieldMap) {
    const value = media[map.js];
    if (value === undefined) {
      continue;
    }

    switch (map.cast) {
      case 'json':
        keyValues[map.db] = JSON.stringify(value);
        break;
      case 'bool':
        keyValues[map.db] = value ? 1 : 0;
        break;
      default:
        keyValues[map.db] = value;
        break;
    }
  }
  if (media.metadata) {
    for (const map of mediaMetadataFieldMap) {
      const value = media.metadata[map.js];
      if (value === undefined) {
        continue;
      }
      switch (map.cast) {
        case 'json':
          keyValues[map.db] = JSON.stringify(value);
          break;
        case 'bool':
          keyValues[map.db] = value ? 1 : 0;
          break;
        default:
          keyValues[map.db] = value;
          break;
      }
    }
  }
  const keys = Object.keys(keyValues) as Array<keyof RawMedia>;
  if (keys.length === 0) {
    throw new Error('Nothing to update');
  }
  return {
    query:
      'INSERT INTO `media` (' +
      keys.map((key) => mapMediaDbField(key, false)).join(', ') +
      ') VALUES (' +
      keys.map(() => '?').join(', ') +
      ') ON CONFLICT (`hash`) DO UPDATE SET ' +
      keys
        .filter((key) => key !== 'hash')
        .map((key) => mapMediaDbField(key, false) + ' = ?')
        .join(', '),
    values: [
      ...keys.map((key) => keyValues[key]),
      ...keys.filter((key) => key !== 'hash').map((key) => keyValues[key]),
    ],
  };
}

export function makeMediaUpdate(mediaRaw: UpdateMedia): QueryObj {
  const media = mediaRaw as Partial<Media>;
  const keyValues: Partial<Record<keyof RawMedia, unknown>> = {};
  for (const map of mediaFieldMap) {
    const value = media[map.js];
    if (value === undefined) {
      continue;
    }

    switch (map.cast) {
      case 'json':
        keyValues[map.db] = JSON.stringify(value);
        break;
      case 'bool':
        keyValues[map.db] = value ? 1 : 0;
        break;
      default:
        keyValues[map.db] = value;
        break;
    }
  }
  if (media.metadata) {
    for (const map of mediaMetadataFieldMap) {
      const value = media.metadata[map.js];
      if (value === undefined) {
        continue;
      }
      switch (map.cast) {
        case 'json':
          keyValues[map.db] = JSON.stringify(value);
          break;
        case 'bool':
          keyValues[map.db] = value ? 1 : 0;
          break;
        default:
          keyValues[map.db] = value;
          break;
      }
    }
  }
  const keys = Object.keys(keyValues) as Array<keyof RawMedia>;
  if (keys.length === 0) {
    throw new Error('Nothing to update');
  }
  return {
    query:
      'UPDATE `media` SET ' +
      keys
        .filter((key) => key !== 'hash')
        .map((key) => mapMediaDbField(key, false) + ' = ?')
        .join(', '),
    values: keys.filter((key) => key !== 'hash').map((key) => keyValues[key]),
  };
}

export interface QueryObj {
  query: string;
  values: unknown[];
}

export interface HavingQuery {
  join: QueryObj;
  having: QueryObj;
}

function buildArrayFilter(table: string, field: string, filter: ArrayFilter | undefined): QueryObj | undefined {
  if (filter === undefined) {
    return undefined;
  }

  const havings: string[] = [];
  const values: unknown[] = [];
  if (filter.equalsAny) {
    havings.push('IFNULL(SUM(' + field + ' IN (' + filter.equalsAny.map(() => '?').join(', ') + ')), 0) > 0');
    values.push(...filter.equalsAny);
  }
  if (filter.equalsAll) {
    havings.push('IFNULL(SUM(' + field + ' IN (' + filter.equalsAll.map(() => '?').join(', ') + ')), 0) = ?');
    values.push(...filter.equalsAll, filter.equalsAll.length);
  }
  if (filter.equalsNone) {
    havings.push('IFNULL(SUM(' + field + ' IN (' + filter.equalsNone.map(() => '?').join(', ') + ')), 0) = 0');
    values.push(...filter.equalsNone);
  }
  if (filter.exists !== undefined) {
    if (filter.exists) {
      havings.push('COUNT(' + field + ') > 0');
    } else {
      havings.push('COUNT(' + field + ') = 0');
    }
  }
  if (havings.length === 0) {
    return undefined;
  }

  const innerSelect =
    'SELECT `media`.`hash` FROM `media` LEFT JOIN ' +
    table +
    ' ON `media`.`hash` = ' +
    table +
    '.`media_hash` GROUP BY `media`.`hash` HAVING ' +
    havings.join(' AND ');

  return {
    // Doesn't work because still matches equalsNone when it has them.
    query: 'INNER JOIN (' + innerSelect + ') AS ' + table + ' ON ' + table + '.`hash` = `media`.`hash`',
    values,
  };
}

function joinQueries(queries: QueryObj[], operator: 'AND' | 'OR'): QueryObj | undefined {
  if (queries.length === 0) {
    return undefined;
  }
  if (queries.length === 1) {
    return queries[0];
  }
  const query = queries.map((query) => `(${query.query})`).join(` ${operator} `);
  const values: unknown[] = [];
  for (const query of queries) {
    values.push(...query.values);
  }
  return { query, values };
}

function buildStringFilter(field: string, filter: StringFilter | undefined): QueryObj | undefined {
  if (filter === undefined) {
    return undefined;
  }

  const queries: QueryObj[] = [];

  if (filter.equalsAny && filter.equalsAny.length > 0) {
    queries.push({
      query: field + ' IN (' + filter.equalsAny.map(() => '?').join(', ') + ')',
      values: filter.equalsAny,
    });
  }
  if (filter.equalsAll && filter.equalsAll.length > 0) {
    // equalsAll doesn't make sense when comparing to a single value so just an =
    queries.push({
      query: field + ' = ?',
      values: [filter.equalsAll[0]],
    });
  }
  if (filter.equalsNone && filter.equalsNone.length > 0) {
    queries.push({
      query: field + ' NOT IN (' + filter.equalsNone.map(() => '?').join(', ') + ') OR ' + field + ' IS NULL',
      values: filter.equalsNone,
    });
  }
  if (filter.exists !== undefined) {
    if (filter.exists) {
      queries.push({ query: field + ' IS NOT NULL', values: [] });
    } else {
      queries.push({ query: field + ' IS NULL', values: [] });
    }
  }
  if (filter.before) {
    queries.push({
      query: field + ' < ?',
      values: [filter.before],
    });
  }
  if (filter.after) {
    queries.push({
      query: field + ' > ?',
      values: [filter.after],
    });
  }
  if (filter.likeAny && filter.likeAny.length > 0) {
    const likeAnyQuery = joinQueries(
      filter.likeAny.map((likeAny) => ({
        query: field + ' LIKE ?',
        values: [`%${likeAny}%`],
      })),
      'OR',
    );
    if (likeAnyQuery) {
      queries.push(likeAnyQuery);
    }
  }
  if (filter.likeAll && filter.likeAll.length > 0) {
    const likeAllQuery = joinQueries(
      filter.likeAll.map((likeAll) => ({
        query: field + ' LIKE ?',
        values: [`%${likeAll}%`],
      })),
      'AND',
    );
    if (likeAllQuery) {
      queries.push(likeAllQuery);
    }
  }
  if (filter.likeNone && filter.likeNone.length > 0) {
    const likeNoneQuery = joinQueries(
      filter.likeNone.map((likeNone) => ({
        query: field + ' NOT LIKE ?',
        values: [`%${likeNone}%`],
      })),
      'AND',
    );
    if (likeNoneQuery) {
      queries.push(joinQueries([{ query: field + ' IS NULL', values: [] }, likeNoneQuery], 'OR') as QueryObj);
    }
  }

  return joinQueries(queries, 'AND');
}

function buildNumberFilter(field: string, filter: NumberFilter | undefined): QueryObj | undefined {
  if (filter === undefined) {
    return undefined;
  }

  const queries: QueryObj[] = [];

  if (filter.min !== undefined) {
    queries.push({
      query: field + ' >= ?',
      values: [filter.min],
    });
  }

  if (filter.max !== undefined) {
    queries.push(
      filter.max === 0
        ? {
            query: field + ' <= 0 OR ' + field + ' IS NULL',
            values: [],
          }
        : {
            query: field + ' <= ?',
            values: [filter.max],
          },
    );
  }

  if (filter.equalsAny && filter.equalsAny.length > 0) {
    queries.push({
      query: field + ' IN (' + filter.equalsAny.map(() => '?').join(', ') + ')',
      values: filter.equalsAny,
    });
  }

  return joinQueries(queries, 'AND');
}

export function buildMediaQuery(
  constraints: SubsetConstraints,
  fields?: SubsetFields | 'all',
): { query: string; values: unknown[] } {
  if (!fields) {
    fields = { hash: 1 };
  }
  const columns =
    fields === 'all'
      ? '`media`.*'
      : Object.keys(fields)
          .filter((key) => !!(fields as Record<string, number>)?.[key])
          .map((key) => {
            const column = mediaFieldMap.find((mediaField) => mediaField.js === key)?.db;
            if (!column) {
              throw new Error(`Failed to map subset field ${key}`);
            }
            return mapMediaDbField(column);
          })
          .join(', ');
  const bases: string[] = [
    constraints.keywordSearch
      ? 'SELECT ' + columns + ' FROM `media_fts`(?) INNER JOIN `media` ON `media`.`hash` = `media_fts`.`hash`'
      : 'SELECT ' + columns + ' FROM `media`',
  ];
  // The quotes aren't for sql escaping but so that it searches for string literals as a user would expect.
  const values: unknown[] = constraints.keywordSearch
    ? [
        constraints.keywordSearch
          .trim()
          .split(' ')
          .map((term) => `"${term}"`)
          .join(' OR '),
      ]
    : [];

  // Playlist filter
  if (constraints.playlist) {
    if (!constraints.sortBy) {
      constraints.sortBy = 'order';
    }
    bases.push(
      'INNER JOIN `media_playlists` ON `media`.`hash` = `media_playlists`.`media_hash` AND `media_playlists`.`playlist_id` = ?',
    );
    values.push(constraints.playlist);
  }

  // Array filters
  const tagFilter = buildArrayFilter('`media_tags`', '`tag_id`', constraints.tags);
  if (tagFilter) {
    bases.push(tagFilter.query);
    values.push(...tagFilter.values);
  }

  const actorsFilter = buildArrayFilter('`media_actors`', '`actor_id`', constraints.actors);
  if (actorsFilter) {
    bases.push(actorsFilter.query);
    values.push(...actorsFilter.values);
  }

  // All below add conditions rather than joins
  const queries: QueryObj[] = [];

  const fieldMap = [...mediaFieldMap, ...mediaMetadataFieldMap];

  // String filters
  for (const field of ['type', 'autoTags', 'hash', 'dir', 'path', 'duplicateOf', 'artist', 'album', 'title'] as const) {
    if (!constraints[field]) {
      continue;
    }
    const dbField = fieldMap.find((mediaField) => mediaField.js === field)?.db;
    if (!dbField) {
      throw new Error(`Failed to find DB map for ${field}`);
    }
    const filter = buildStringFilter(mapMediaDbField(dbField), constraints[field]);
    if (filter) {
      queries.push(filter);
    }
  }

  // Boolean filters
  for (const field of ['corrupted', 'thumbnail', 'thumbnailOptimised', 'preview', 'previewOptimised'] as const) {
    if (constraints[field] === undefined) {
      continue;
    }
    const dbField = fieldMap.find((mediaField) => mediaField.js === field)?.db;
    if (!dbField) {
      throw new Error(`Failed to find DB map for ${field}`);
    }
    queries.push({
      query: constraints[field]
        ? mapMediaDbField(dbField) + ' = TRUE'
        : mapMediaDbField(dbField) + ' = FALSE OR ' + mapMediaDbField(dbField) + ' IS NULL',
      values: [],
    });
  }

  // Misc checking for whether things are set and if arrays have items.
  if (constraints.indexed !== undefined) {
    queries.push({
      query: constraints.indexed ? '`media`.`metadata_width` IS NOT NULL' : '`media`.`metadata_width` IS NULL',
      values: [],
    });
  }
  if (constraints.cached !== undefined) {
    queries.push({
      query: constraints.cached
        ? "`media`.`type` != 'video' OR (`media`.`metadata_quality_cache` IS NOT NULL AND `media`.`metadata_quality_cache` != '[]')"
        : "`media`.`type` = 'video' AND (`media`.`metadata_quality_cache` IS NULL OR `media`.`metadata_quality_cache` = '[]')",
      values: [],
    });
  }
  if (constraints.phashed !== undefined) {
    queries.push({
      query: constraints.phashed ? '`media`.`phash` IS NOT NULL' : '`media`.`phash` IS NULL',
      values: [],
    });
  }
  if (constraints.hasClones !== undefined) {
    queries.push({
      query: constraints.hasClones
        ? "`media`.`clones` IS NOT NULL AND `media`.`clones` != '[]'"
        : "`media`.`clones` IS NULL OR `media`.`clones` = '[]'",
      values: [],
    });
  }

  // Number filters
  for (const field of ['quality', 'rating', 'length'] as const) {
    if (!constraints[field]) {
      continue;
    }
    const dbField = fieldMap.find((mediaField) => mediaField.js === field)?.db;
    if (!dbField) {
      throw new Error(`Failed to find DB map for ${field}`);
    }
    const filter = buildNumberFilter(mapMediaDbField(dbField), constraints[field]);
    if (filter) {
      queries.push(filter);
    }
  }

  const suffixes: string[] = [];
  const suffixValues: unknown[] = [];

  if (constraints.sample) {
    suffixes.push('ORDER BY RANDOM() LIMIT ?');
    suffixValues.push(constraints.sample);
  } else if (constraints.sortBy && constraints.sortBy !== 'recommended') {
    if (constraints.sortBy === 'order') {
      suffixes.push('ORDER BY `media_playlists`.`order`');
    } else {
      const dbField = fieldMap.find((mediaField) => mediaField.js === constraints.sortBy)?.db;
      if (!dbField) {
        throw new Error(`Failed to find DB map for ${constraints.sortBy}`);
      }
      suffixes.push('ORDER BY ' + mapMediaDbField(dbField));
    }
    if (!constraints.sortDirection) {
      switch (constraints.sortBy) {
        case 'hashDate': // fallthrough
        case 'rating': // fallthrough
        case 'createdAt':
          constraints.sortDirection = 'DESC';
          break;
        case 'order': // fallthrough
        case 'path': // fallthrough
        case 'dir':
          constraints.sortDirection = 'ASC';
          break;
      }
    }
    suffixes.push(constraints.sortDirection || 'ASC');
  }

  if (constraints.limit) {
    suffixes.push('LIMIT ?');
    suffixValues.push(constraints.limit);
  }

  const conditionsQuery = joinQueries(queries, 'AND');
  if (conditionsQuery) {
    return {
      query: bases.join(' ') + ' WHERE ' + conditionsQuery.query + ' ' + suffixes.join(' '),
      values: [...values, ...conditionsQuery.values, ...suffixValues],
    };
  } else {
    return { query: bases.join(' ') + ' ' + suffixes.join(' '), values: [...values, ...suffixValues] };
  }
}
