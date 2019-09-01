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
  cached?: boolean;
  sortBy?: 'hashDate';
  limit?: number;
}

export interface SubsetFields {
  hash?: number;
  path?: number;
}
