// SigLIP2 text tokenizer, a TypeScript port of the POC's src/siglip2.mjs:
// the onnx-community tokenizer.json is a Replace(' ' -> '▁') normaliser, no
// lowercasing (the vocabulary is case-sensitive), then a single BPE pass over
// the whole string (the Metaspace pre-splitter has nothing left to split
// after normalisation), a post-processor appending <eos> (id 1) and padding
// right to the fixed context with <pad> (id 0). Unknown pieces map to <unk>
// (id 3). The graph takes only input_ids; the POC verified no attention-mask
// input exists, so none is produced here.

import FS from 'node:fs';

/** token -> id map size sanity: the published vocabulary is 256k pieces. */
const EXPECTED_VOCAB_SIZE = 256_000;

export const SIGLIP2_PAD_ID = 0;
export const SIGLIP2_EOS_ID = 1;
export const SIGLIP2_UNK_ID = 3;

export interface TokenizerJsonModel {
  type: string;
  vocab: Record<string, number>;
  merges: [string, string][];
}

export class SigLip2Tokenizer {
  /** token -> id. */
  private readonly vocab: Map<string, number>;
  /** concatenated pair -> rank; lower (earlier in the merge list) merges first. */
  private readonly mergeRanks: Map<string, number>;
  /** Whole-word BPE results; prompts repeat the same few words constantly. */
  private readonly cache = new Map<string, string[]>();
  private readonly eosId: number;
  private readonly unkId: number;
  private readonly padId: number;
  public readonly contextLength: number;

  public constructor(vocab: Record<string, number>, merges: [string, string][], contextLength: number) {
    this.vocab = new Map(Object.entries(vocab));
    this.mergeRanks = new Map();
    for (const [index, [first, second]] of merges.entries()) {
      this.mergeRanks.set(first + second, index);
    }
    this.padId = SIGLIP2_PAD_ID;
    this.eosId = SIGLIP2_EOS_ID;
    this.unkId = SIGLIP2_UNK_ID;
    this.contextLength = contextLength;
  }

  /**
   * Main-thread construction: parses the multi-megabyte tokenizer.json once
   * per run, off the event loop; ONNX encode workers never touch the file
   * (they only receive finished token rows).
   */
  public static async fromTokenizerJson(path: string, contextLength: number): Promise<SigLip2Tokenizer> {
    const doc = JSON.parse(await FS.promises.readFile(path, 'utf8')) as { model: TokenizerJsonModel };
    const model = doc.model;
    if (model.type !== 'BPE') {
      throw new Error(`Expected the SigLIP2 BPE tokenizer, got ${model.type}`);
    }
    if (Object.keys(model.vocab).length !== EXPECTED_VOCAB_SIZE) {
      throw new Error(
        `Expected a ${EXPECTED_VOCAB_SIZE}-piece SigLIP2 vocabulary, got ${Object.keys(model.vocab).length}`,
      );
    }
    return new SigLip2Tokenizer(model.vocab, model.merges, contextLength);
  }

  /** Byte-Pair Encoding (BPE): repeatedly merge the adjacent pair with the lowest merge rank. */
  private applyBpeMerges(word: string): string[] {
    const cached = this.cache.get(word);
    if (cached !== undefined) {
      return cached;
    }
    let parts = [...word];
    let visits = 0;
    for (;;) {
      let bestRank = Infinity;
      let bestIndex = -1;
      for (let i = 0; i < parts.length - 1; i++) {
        const rank = this.mergeRanks.get(parts[i] + parts[i + 1]);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          bestIndex = i;
        }
      }
      if (bestIndex === -1) {
        break;
      }
      parts = [...parts.slice(0, bestIndex), parts[bestIndex] + parts[bestIndex + 1], ...parts.slice(bestIndex + 2)];
      // Safety bound: real prompts are short so this never fires; a
      // pathological merge table would otherwise loop forever.
      visits++;
      if (visits > 10_000) {
        throw new Error('BPE failed to converge');
      }
    }
    this.cache.set(word, parts);
    return parts;
  }

  /**
   * Encodes into exactly `contextLength` ids: BPE pieces, truncation that
   * leaves one slot for <eos>, then right-padding with <pad>.
   */
  public encodeToIds(text: string): number[] {
    // The JSON normaliser is a single Replace rule; case is untouched.
    const normalised = text.replace(/ /g, '▁');
    const ids: number[] = [];
    for (const piece of this.applyBpeMerges(normalised)) {
      const id = this.vocab.get(piece);
      ids.push(id === undefined ? this.unkId : id);
    }
    return this.padAndTruncate(ids);
  }

  /** Truncate to leave exactly one slot for <eos>, then right-pad. */
  private padAndTruncate(ids: number[]): number[] {
    if (ids.length >= this.contextLength) {
      return [...ids.slice(0, this.contextLength - 1), this.eosId];
    }
    return [...ids, this.eosId, ...new Array<number>(this.contextLength - ids.length - 1).fill(this.padId)];
  }
}
