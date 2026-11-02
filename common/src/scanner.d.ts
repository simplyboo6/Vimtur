export namespace Scanner {
  /** The computed diff of a scan: library paths not in the database, and database paths not in the library. */
  export interface FilterResults {
    newPaths: string[];
    missingPaths: string[];
  }

  /**
   * A scan's pending-work state, assembled client-side from the SCAN task's three task_state
   * keys ('generated-at', 'new-paths', 'missing-paths', all definition-id keyed) through the
   * generic GET /api/tasks/state/:taskId/:key endpoint. The server neither stores nor serves
   * this as a single record; if any of the three keys is absent or mis-shaped the state reads
   * as "no scan".
   */
  export interface ScanResults {
    /** Epoch milliseconds when the last successful scan completed. Retained across INDEX / DELETE-MISSING consumption for the UI's "last scan" display. */
    generatedAt: number;
    /** Library paths found by the scan but not yet indexed. Rewritten to [] once INDEX has consumed them. */
    newPaths: string[];
    /** Database paths no longer present in the library, pending DELETE-MISSING. Rewritten to [] once deletion starts. */
    missingPaths: string[];
  }
}
