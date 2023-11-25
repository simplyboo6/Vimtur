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
  autoTags?: ArrayFilter;

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
  sortBy?: 'hashDate' | 'recommended' | 'rating' | 'length' | 'createdAt' | 'path' | 'order';
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
  order?: number;
}
