export interface QualityConstraints {
  min?: number;
  max?: number;
}

export interface RatingConstraints {
  min?: number;
  max?: number;
}

export interface StringFilterCommon {
  equalsAny?: string[];
  equalsAll?: string[];
  equalsNone?: string[];
}

export interface ArrayFilter extends StringFilterCommon {
  // Whether item.0 exists
  exists?: boolean;
}

export interface StringFilter extends ArrayFilter {
  likeAny?: string[];
  likeAll?: string[];
  likeNone?: string[];
}

export interface SubsetConstraints {
  // Arrays
  tags?: ArrayFilter;
  actors?: ArrayFilter;
  type?: ArrayFilter;

  // Strings
  artist?: StringFilter;
  album?: StringFilter;
  title?: StringFilter;
  dir?: StringFilter;
  path?: StringFilter;

  quality?: QualityConstraints;
  rating?: RatingConstraints;
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
