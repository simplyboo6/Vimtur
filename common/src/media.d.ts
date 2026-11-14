export interface Segment {
  start: number;
  end: number;
}

export interface SegmentMetadata {
  standard: Segment[];
}

interface MetadataBase {
  createdAt?: number;
  length?: number;
  artist?: string | null;
  album?: string | null;
  title?: string | null;
  codec?: string;
  qualityCache?: number[];
  maxCopy?: boolean;
  segments?: SegmentMetadata;
}

export interface Metadata extends MetadataBase {
  width: number;
  height: number;
}

export type MediaType = 'still' | 'gif' | 'video';

export interface MediaPlaylist {
  id: string;
  order: number;
}

// As stored within the database.
export interface BaseMedia {
  hash: string;
  path: string;
  dir: string;
  rotation?: number;
  type: MediaType;
  tags: string[];
  autoTags?: string[];
  // The generated caption. Absent means it has not been captioned; '' means the
  // pipeline processed the image and produced nothing. Mirrors autoTags'
  // null/[] distinction.
  autoCaption?: string;
  actors: string[];
  hashDate: number;
  metadata?: Metadata;
  corrupted?: boolean;
  thumbnail?: boolean;
  thumbnailOptimised?: boolean;
  preview?: boolean;
  previewOptimised?: boolean;
  rating?: number;
  // Base64 Buffer
  phash?: string;
  // Array of hashes of potential clones.
  clones?: string[];
  // pHash matches that are unrelated.
  unrelated?: string[];
  // If this is a duplicate/alias of a different file
  // then this should be set to the master files hash.
  duplicateOf?: string;
  // Time the clone comparator was run for this media.
  cloneDate?: number;
  playlists?: MediaPlaylist[];

  // Augmented onto the response if searching for a playlist.
  playlist?: string;
  order?: number;
}

// Optional for updates
export interface UpdateMetadata extends MetadataBase {
  width?: number;
  height?: number;
}

// Possible fields to update media.
export interface UpdateMedia {
  hash?: string;
  path?: string;
  dir?: string;
  rotation?: number;
  hashDate?: number;
  // Tags and actors are updated with separate endpoints.
  // This is to avoid race conditions.
  // autoTags is the deliberate exception below: it is a whole list the server
  // generates, so setting or clearing it cannot race the way adding/removing a
  // single relational tag would.
  // This doesn't need to be done for metadata because the
  // only arrays in it are modified server-side.
  metadata?: UpdateMetadata;
  corrupted?: boolean;
  thumbnail?: boolean;
  thumbnailOptimised?: boolean;
  preview?: boolean;
  previewOptimised?: boolean;
  rating?: number;
  // Base64 Buffer
  phash?: string;
  clones?: string[];
  cloneDate?: number;
  duplicateOf?: string;
  // Update only field. Will only add as unrelated.
  unrelated?: string[];
  /**
   * The generated tag list, written as a whole (never merged). Omit it to
   * leave the current value alone, send an array to replace the list, or send
   * null to clear it back to the unprocessed state. null and [] are different
   * states: [] means the pipeline processed the media and scored nothing,
   * while null (stored as SQL NULL / an absent field) means it has not been
   * scored and a skip-existing run will consider it again. Mirrors
   * Configuration's explicit-null manualThreshold override.
   */
  autoTags?: string[] | null;
  /**
   * The generated caption, written as a whole string. Omit it to leave the
   * current value alone, send a string to replace it, or send null to clear it
   * back to the unprocessed state. null and '' are different states: '' means
   * the pipeline processed the image and produced no caption, while null
   * (stored as SQL NULL / an absent field) means it has not been captioned and
   * a skip-existing run will consider it again.
   */
  autoCaption?: string | null;
}

export interface MediaResolution {
  aliases: string[];
  unrelated: string[];
}

// This is when fetched from the database.
export interface Media extends BaseMedia {
  absolutePath: string;
}

export interface DeletedMedia {
  hash: string;
  path: string;
}
