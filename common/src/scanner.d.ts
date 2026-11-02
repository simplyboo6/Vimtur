export namespace Scanner {
  /** The computed diff of a scan: library paths not in the database, and database paths not in the library. */
  export interface FilterResults {
    newPaths: string[];
    missingPaths: string[];
  }

  /** A scan's pending-work lists as persisted under the SCAN task's task_state key 'results' (definition-id keyed), so the INDEX / DELETE-MISSING hand-off survives a server restart. Consuming runs rewrite the lists in place; the generatedAt timestamp is deliberately retained until the next successful scan. */
  export interface ScanResults {
    /** Epoch milliseconds when the scan that produced these lists completed. */
    generatedAt: number;
    newPaths: string[];
    missingPaths: string[];
  }

  /** Wire body of GET /api/tasks/SCAN/results. 404s when no scan has ever been stored rather than serving zeros. */
  export interface Summary {
    generatedAt: number;
    newPaths: number;
    missingPaths: number;
  }
}
