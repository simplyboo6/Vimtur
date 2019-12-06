export interface QualityConstraints {
  min?: number;
  max?: number;
}

export interface RatingConstraints {
  min?: number;
  max?: number;
}

export interface SubsetConstraints {
  any?: '*' | string[];
  all?: string[];
  none?: '*' | string[];
  quality?: QualityConstraints;
  type?: string | string[];
  rating?: RatingConstraints;
  width?: number; // Min width
  height?: number; // Min height
  dir?: string;
  keywordSearch?: string;
  corrupted?: boolean;
  indexed?: boolean;
  thumbnail?: boolean;
  preview?: boolean;
  cached?: boolean;
  sortBy?: 'hashDate' | 'recommended';
  phashed?: boolean;
  limit?: number;
  // Returns media that have potential clones.
  hasClones?: boolean;
  // Returns media where the clone comparator was before the given date.
  maxCloneDate?: number;
}

export interface SubsetFields {
  hash?: number;
  path?: number;
  phash?: number;
  clones?: number;
}
