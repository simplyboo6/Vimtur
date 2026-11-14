/** A decoder output tensor whose rows can be read without loading ONNX. */
export interface LogitsTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}

/** Runs the decoder over a token prefix and returns its logits. */
export type LogitsRunner = (ids: readonly number[]) => Promise<LogitsTensor>;

export interface GreedyDecodeOptions {
  startTokenId: number;
  endTokenIds: readonly number[];
  maxNewTokens: number;
}

/**
 * Greedy (argmax) decoding over a stateless decoder, exported separately from
 * the ONNX session so the loop's stop and row-selection rules are unit-tested
 * without a pack.
 *
 * The next-token logits are the LAST row, not the row at the prefix's length:
 * GIT-family decoders prepend one logits row per image token, so the output has
 * `imageTokens + T` rows. The last row is therefore correct for both that
 * family and plain row-per-prefix-token decoders.
 */
export async function decodeGreedy(runLogits: LogitsRunner, options: GreedyDecodeOptions): Promise<number[]> {
  const ids = [options.startTokenId];
  const endIds = new Set(options.endTokenIds);
  for (let step = 0; step < options.maxNewTokens; step++) {
    const logits = await runLogits(ids);
    if (logits.dims.length !== 3) {
      throw new Error(`Decoder logits have ${logits.dims.length} dims [${logits.dims.join(', ')}], expected 3`);
    }
    const [batch, rows, vocabSize] = logits.dims;
    const expected = batch * rows * vocabSize;
    if (logits.data.length !== expected) {
      throw new Error(
        `Decoder logits have ${logits.data.length} values, expected ${expected} for dims ` +
          `[${logits.dims.join(', ')}]`,
      );
    }

    const offset = (rows - 1) * vocabSize;
    let best = 0;
    let bestScore = logits.data[offset];
    for (let token = 1; token < vocabSize; token++) {
      const score = logits.data[offset + token];
      if (score > bestScore) {
        best = token;
        bestScore = score;
      }
    }
    ids.push(best);
    if (endIds.has(best)) {
      break;
    }
  }
  return ids;
}
