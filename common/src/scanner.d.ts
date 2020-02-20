export namespace Scanner {
  export interface FilterResults {
    newPaths: string[];
    missingPaths: string[];
  }

  export interface Summary {
    newPaths: number;
    missingPaths: number;
  }
}
