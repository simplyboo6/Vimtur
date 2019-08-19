interface MetadataBase {
  length?: number;
  artist?: string | null;
  album?: string | null;
  title?: string | null;
  codec?: string;
  qualityCache?: number[];
  maxCopy?: boolean;
  keyframeIndexes?: number[];
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
}

// This is when fetched from the database.
export interface Media extends BaseMedia {
  absolutePath: string;
}
