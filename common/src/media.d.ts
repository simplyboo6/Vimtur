export interface Segment {
  start: number;
  end: number;
}

export interface SegmentMetadata {
  standard: Segment[];
  copy?: Segment[];
}

interface MetadataBase {
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
  rating?: number;
  // Base64 Buffer
  phash?: string;
  // Array of hashes of potential clones.
  clones?: string[];
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
  tags?: string[];
  actors?: string[];
  hashDate?: number;
  metadata?: UpdateMetadata;
  corrupted?: boolean;
  thumbnail?: boolean;
  rating?: number;
  // Base64 Buffer
  phash?: string;
  clones?: string[];
  cloneDate?: number;
}

// This is when fetched from the database.
export interface Media extends BaseMedia {
  absolutePath: string;
}
