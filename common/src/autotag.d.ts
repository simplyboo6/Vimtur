// Wire shapes for the zero-shot Auto-Tagging pipeline (issue #131). These are
// read over HTTP; server-internal machinery lives in the server's task code.
export namespace Autotag {
  export type TagStatus = 'Calibrated' | 'Review (low support)' | 'Not calibrated' | 'Manually overridden';

  // One tag's outcome inside a calibration run, stored under the calibration
  // task's task-state key 'last-run'.
  export interface TagResult {
    // Best-F1 cosine threshold from the run. Null when the tag has no usable
    // calibration — no positively tagged examples, no negative examples to
    // rank against, or a best cut below zero (a signal-less tag).
    threshold: number | null;
    // Number of manually tagged examples the run scored the tag against.
    support: number;
    // Ranking quality (AUROC) of the tag's score distribution, null when not
    // computable (e.g. no negative examples in the sample).
    quality: number | null;
    // Whether the status rules let the threshold be applied by auto-tagging
    // runs; review rows keep their threshold recorded but inert.
    emitted: boolean;
  }

  // Persisted record of the most recent calibration run.
  export interface CalibrationRun {
    // When the run completed, in epoch milliseconds.
    date: number;
    // Model pack the run scored against, e.g. 'AVES-SIGLIP2-B32'.
    modelId: string;
    // Support floor the run enforced.
    minSupport: number;
    // How many stills the run sampled.
    sampleSize: number;
    perTag: Record<string, TagResult>;
  }
}
