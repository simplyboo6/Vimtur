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

// As stored within the database.
export interface BaseMedia {
  hash: string;
  path: string;
  dir: string;
  rotation?: number;
  type: MediaType;
  tags: string[];
  actors: string[];
  hashDate: number;
  metadata?: Metadata;
  corrupted?: boolean;
  thumbnail?: boolean;
  preview?: boolean;
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
  // This doesn't need to be done for metadata because the
  // only arrays in it are modified server-side.
  metadata?: UpdateMetadata;
  corrupted?: boolean;
  thumbnail?: boolean;
  preview?: boolean;
  rating?: number;
  // Base64 Buffer
  phash?: string;
  clones?: string[];
  cloneDate?: number;
  duplicateOf?: string;
  // Update only field. Will only add as unrelated.
  unrelated?: string[];
}

export interface MediaResolution {
  aliases: string[];
  unrelated: string[];
}

// This is when fetched from the database.
export interface Media extends BaseMedia {
  absolutePath: string;
}
