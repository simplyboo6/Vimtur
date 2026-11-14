import { readFile } from 'node:fs/promises';

// Ids carrying these tokens are dropped by skip_special_tokens. BLIP's added
// [BOS] (bert-base vocab + 2) is deliberately absent: it has no vocab entry.
const SPECIAL_TOKENS = new Set(['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]']);

/** Splits a bert-base `vocab.txt` into id-ordered entries. */
export function loadVocab(text: string): string[] {
  const lines = text.split('\n');
  // vocab.txt ends with a newline; that last empty entry is not a token.
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * WordPiece detokeniser matching transformers'
 * `BertTokenizer.decode(ids, skip_special_tokens=True)` with
 * clean_up_tokenization_spaces (the #159 harness verified it 20/20 against the
 * model's own vocab).
 */
export class WordPieceDetokenizer {
  private readonly vocab: readonly string[];

  private constructor(vocab: readonly string[]) {
    this.vocab = vocab;
  }

  public static fromVocabText(text: string): WordPieceDetokenizer {
    return new WordPieceDetokenizer(loadVocab(text));
  }

  public static async fromFile(path: string): Promise<WordPieceDetokenizer> {
    return new WordPieceDetokenizer(loadVocab(await readFile(path, 'utf8')));
  }

  public decode(ids: readonly number[]): string {
    const tokens: string[] = [];
    for (const id of ids) {
      // A negative or fractional id can only come from a decoder bug, so it is
      // reported rather than silently skipped like an unknown vocabulary id.
      if (!Number.isInteger(id) || id < 0) {
        throw new Error(`Cannot decode token id ${id}: ids must be non-negative integers`);
      }
      // Out-of-vocab ids are skipped rather than failing: the decoder starts on
      // BLIP's [BOS], which the bert-base vocabulary does not carry.
      const token = this.vocab[id];
      if (token === undefined || SPECIAL_TOKENS.has(token)) {
        continue;
      }
      tokens.push(token);
    }
    return cleanUpTokenization(tokens.join(' ').replaceAll(' ##', '').trim());
  }
}

/**
 * transformers' clean_up_tokenization_spaces substitutions. They are global in
 * Python's str.replace, so replaceAll is required: String.replace with a
 * string pattern only replaces the first match.
 */
function cleanUpTokenization(text: string): string {
  return text
    .replaceAll(' .', '.')
    .replaceAll(' ?', '?')
    .replaceAll(' !', '!')
    .replaceAll(' ,', ',')
    .replaceAll(" ' ", "'")
    .replaceAll(" n't", "n't")
    .replaceAll(" 'm", "'m")
    .replaceAll(" 's", "'s")
    .replaceAll(" 've", "'ve")
    .replaceAll(" 're", "'re");
}
