export interface NumberFilter {
  min?: number;
  max?: number;
  equalsAny?: number[];
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

export type BooleanFilter = boolean;

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

  // Numbers
  quality?: NumberFilter;
  rating?: NumberFilter;
  length?: NumberFilter;

  // Booleans
  corrupted?: BooleanFilter;
  thumbnail?: BooleanFilter;
  preview?: BooleanFilter;

  // Special cases
  keywordSearch?: string;
  sortBy?: 'hashDate' | 'recommended' | 'rating';
  // Checks that metadata exists
  indexed?: boolean;
  // Checks that metadata.qualityCache.0 exists or type != video
  cached?: boolean;
  // Checks if a string exists
  phashed?: boolean;
  // Returns media that have potential clones. clones.length > 0 & exists
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
