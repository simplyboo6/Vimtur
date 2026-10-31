/**
 * Calibration metrics, from the POC (src/metrics.mjs): AUROC as the tag's
 * quality, and a best-F1 threshold search. Everything is pure and
 * deterministic so the unit tests can pin the edge cases (all-positive,
 * tie-heavy, empty-negatives).
 */

/**
 * Area under the ROC curve from the two score distributions. Ties credit
 * half (Mann-Whitney), so tied scores are not worse than either ordering.
 */
export function auroc(positives: number[], negatives: number[]): number {
  if (positives.length === 0 || negatives.length === 0) {
    throw new Error('AUROC needs both positive and negative examples');
  }
  let total = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) {
        total += 1;
      } else if (positive === negative) {
        // Ties land exactly on the curve; they carry half credit.
        total += 0.5;
      }
    }
  }
  return total / (positives.length * negatives.length);
}

/**
 * The score cut maximising F1 on the calibration sample, searching every
 * distinct score as a candidate (score >= cut counts as predicted). Ties in
 * F1 keep the highest cut: same F1 at higher precision.
 *
 * A negative best cut returns null: cosine similarity below zero carries no
 * signal for a tag, and emitting on "barely anti-similar" would tag
 * untaggable media, so that calibration is signal-less and records null. A
 * best cut of exactly 0 stays 0 — zero is a real candidate score when the
 * F1-optimal cut genuinely is zero, not a placeholder for "no signal".
 *
 * Throws when either class is empty: F1 and its tie-breaking are only defined
 * with examples of both, so callers must skip such tags before calling.
 */
export function bestF1Threshold(positives: number[], negatives: number[]): number | null {
  if (positives.length === 0) {
    throw new Error('bestF1Threshold needs at least one positive score');
  }
  if (negatives.length === 0) {
    throw new Error('bestF1Threshold needs at least one negative score');
  }
  const candidates = [...new Set([...positives, ...negatives])].sort((a, b) => a - b);
  let bestF1 = -1;
  let threshold = candidates[candidates.length - 1] ?? 0;
  for (const candidate of candidates) {
    const truePositives = positives.filter((score) => score >= candidate).length;
    const falsePositives = negatives.filter((score) => score >= candidate).length;
    const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = truePositives / positives.length;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    // Greater-or-equal keeps the LAST (highest) candidate among F1 ties.
    if (f1 >= bestF1) {
      bestF1 = f1;
      threshold = candidate;
    }
  }
  // See the doc comment: a negative cut means "no signal"; emit never fires.
  return threshold < 0 ? null : threshold;
}
