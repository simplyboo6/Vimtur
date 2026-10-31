/**
 * L2-normalises a vector in place, defensively: the pack emits
 * pre-normalised embeddings, but every consumer gets one guarantee — cosine
 * similarity is the dot product.
 */
export function l2NormaliseRow(row: Float32Array): Float32Array {
  let norm = 0;
  for (const value of row) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return row;
  }
  for (let index = 0; index < row.length; index++) {
    row[index] = row[index] / norm;
  }
  return row;
}
