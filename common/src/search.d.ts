export interface NumberFilter {
  min?: number;
  max?: number;
  equalsAny?: number[];
}

export interface StringFilterCommon {
  equalsAny?: string[];
  equalsAll?: string[];
  equalsNone?: string[];
  exists?: boolean;
}

export interface ArrayFilter extends StringFilterCommon {
  // Whether item.0 exists
  // exists?: boolean;
}

export interface StringFilter extends ArrayFilter {
  before?: string;
  after?: string;
  likeAny?: string[];
  likeAll?: string[];
  likeNone?: string[];
}

export type BooleanFilter = boolean;

export interface SubsetConstraints {
  // Arrays
  tags?: ArrayFilter;
  actors?: ArrayFilter;
  type?: StringFilter;
  // Only currently searched by Full-text, but exists: false is used.
  autoTags?: StringFilter;

  // Strings
  hash?: StringFilter;
  artist?: StringFilter;
  album?: StringFilter;
  title?: StringFilter;
  dir?: StringFilter;
  path?: StringFilter;
  duplicateOf?: StringFilter;

  // Numbers
  quality?: NumberFilter;
  rating?: NumberFilter;
  length?: NumberFilter;

  // Booleans
  corrupted?: BooleanFilter;
  thumbnail?: BooleanFilter;
  thumbnailOptimised?: BooleanFilter;
  preview?: BooleanFilter;
  previewOptimised?: BooleanFilter;

  // Special cases
  keywordSearch?: string;
  // Object ID, if set can sort by order.
  playlist?: string;
  sortBy?: 'hashDate' | 'recommended' | 'rating' | 'length' | 'createdAt' | 'path' | 'order' | 'dir';
  // If not set defaults to whatever is sensible for the sortBy field.
  sortDirection?: 'ASC' | 'DESC';
  // Checks that metadata exists
  indexed?: BooleanFilter;
  // Checks that metadata.qualityCache.0 exists or type != video
  cached?: BooleanFilter;
  // Checks if a string exists
  phashed?: BooleanFilter;
  // Returns media that have potential clones. clones.length > 0 & exists
  hasClones?: BooleanFilter;
  // Return a random set of this size.
  sample?: number;
  // Return the first number of matches
  limit?: number;
}

export interface SubsetFields {
  hash?: number;
  path?: number;
  phash?: number;
  clones?: number;
  order?: number;
}
