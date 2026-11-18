import Crypto from 'node:crypto';
import FS from 'node:fs';

import type { CaptionerPool } from '../../tasks/autocaption/captioner';
import type { CaptionPackDefinition } from '../../tasks/autocaption/pack';

/**
 * Deterministic TEST_MODE stand-in for the captioner. It lives with the tests
 * and is never loaded outside TEST_MODE (captioner.ts reaches it through a
 * guarded dynamic import), though it does compile into dist/test. The caption
 * is seeded from the file's content hash, so the same file always produces the
 * same text and the pipeline's state machine behaves like the real one — while
 * needing neither ONNX sessions nor a downloaded pack. The text is
 * intentionally meaningless: the fake exists to exercise the plumbing, not
 * model quality.
 */
export class FakeCaptionerPool implements CaptionerPool {
  public async caption(_pack: CaptionPackDefinition, absolutePath: string): Promise<string> {
    // Seeded from the file bytes: identical content captions identically. A
    // '00' digest prefix is the deterministic "model produced nothing" fixture,
    // so the empty-caption ('' marker) path is testable end to end.
    const digest = Crypto.createHash('sha256')
      .update(await FS.promises.readFile(absolutePath))
      .digest('hex');
    // The marker api-test searches for a 00-prefixed fixture before starting the
    // server and passes that exact digest here: a prefix match would also make
    // an unrelated fixture return '' on ~1 in 256 ImageMagick builds, and those
    // tests expect a real caption. The prefix stays as the no-env fallback for
    // ad-hoc TEST_MODE runs.
    const emptySha = process.env['AUTOCAPTION_FAKE_EMPTY_SHA'];
    const empty = emptySha !== undefined ? digest === emptySha : digest.startsWith('00');
    return empty ? '' : `a still image (fake caption ${digest.slice(0, 8)})`;
  }

  public async quit(): Promise<void> {
    // Nothing to release: no sessions were ever created.
    return Promise.resolve();
  }
}
