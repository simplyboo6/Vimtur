import type { TagPrompt } from './prompts';

/**
 * Builds the per-tag scorer over a tag-grouped prompt table: the tag's score
 * is the maximum cosine similarity across its prompt rows.
 *
 * Prompt rows are tag-grouped, so one pass over the table records each tag's
 * prompt offset; every later score is then one lookup rather than a table scan
 * per still (the same positional slicing the calibration uses).
 */
export function makeTagScorer(
  table: TagPrompt[],
  textRows: Float32Array[],
): (imgRow: Float32Array, tag: string) => number {
  const positions = new Map<string, { offset: number; count: number }>();
  let offset = 0;
  for (const entry of table) {
    positions.set(entry.tag, { offset, count: entry.prompts.length });
    offset += entry.prompts.length;
  }
  return (imgRow, tag) => {
    const position = positions.get(tag);
    if (!position) {
      throw new Error(`Tag is not in the prompt table: ${tag}`);
    }
    let best = -Infinity;
    for (let index = 0; index < position.count; index++) {
      best = Math.max(best, dotProduct(imgRow, textRows[position.offset + index]));
    }
    return best;
  };
}

/** Cosine similarity of two L2-normalised embedding rows. */
function dotProduct(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new Error(`Cannot score embedding rows of ${left.length} and ${right.length} dims`);
  }
  let total = 0;
  for (let index = 0; index < left.length; index++) {
    total += left[index] * right[index];
  }
  return total;
}
