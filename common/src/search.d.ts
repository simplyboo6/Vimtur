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
  dir?: string;
  keywordSearch?: string;
  corrupted?: boolean;
  indexed?: boolean;
  thumbnail?: boolean;
  preview?: boolean;
  cached?: boolean;
  sortBy?: 'hashDate' | 'recommended' | 'rating';
  phashed?: boolean;
  // Returns media that have potential clones.
  hasClones?: boolean;
  // Return a random set of this size.
  sample?: number;
}

export interface SubsetFields {
  hash?: number;
  path?: number;
  phash?: number;
  clones?: number;
}
