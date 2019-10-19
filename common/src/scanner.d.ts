export namespace Scanner {
  export interface FilterResults {
    newPaths: string[];
    missingPaths: string[];
  }

  export type State =
    | 'IDLE'
    | 'SCANNING'
    | 'INDEXING'
    | 'CACHING'
    | 'REHASHING'
    | 'THUMBNAILS'
    | 'KEYFRAME_CACHING'
    | 'CALCULATING_PHASHES';

  export interface StrippedFilterResults {
    newPaths: number;
    missingPaths: string[];
  }

  export interface StrippedStatus {
    state: State;
    progress: Progress;
    scanResults?: StrippedFilterResults;
  }

  export interface Progress {
    current: number;
    max: number;
  }

  export interface Status {
    state: State;
    progress: Progress;
    scanResults?: FilterResults;
  }
}
