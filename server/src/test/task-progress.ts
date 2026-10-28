import { expect } from 'chai';
import { describe, it } from 'mocha';

import { segmentProgressToWeight } from '../tasks/cache-generator';

// The GENERATE-CACHE task's max is estimated in per-quality segment units and
// in-flight items contribute their weighted share, so the bar moves during
// long videos. These tests pin the conversion maths; the end-to-end progress
// semantics (work-set maxima, current === max) are pinned over HTTP by
// server/src/api-tests/task-progress.spec.ts.
describe('Cache generation progress weighting', () => {
  // A two-hour video at three missing qualities and ~100 estimated segments.
  const ESTIMATE = 300;

  const info = (qualityIndex: number, doneSegments: number, totalSegments: number, qualityCount = 3) => ({
    qualityIndex,
    qualityCount,
    doneSegments,
    totalSegments,
  });

  it('Is zero before any segment completes', () => {
    expect(segmentProgressToWeight(info(0, 0, 100), ESTIMATE)).to.equal(0);
  });

  it('Weights segments within a quality across all qualities', () => {
    // Quality 0 halfway, out of 3 qualities: (0 + 50/100) / 3.
    expect(segmentProgressToWeight(info(0, 50, 100), ESTIMATE)).to.equal(ESTIMATE / 6);
    // Quality 0 finished: 1/3 of the item's estimate.
    expect(segmentProgressToWeight(info(0, 100, 100), ESTIMATE)).to.equal(ESTIMATE / 3);
    // Quality 1 halfway: (1 + 50/100) / 3.
    expect(segmentProgressToWeight(info(1, 50, 100), ESTIMATE)).to.equal(ESTIMATE / 2);
  });

  it('Is continuous across quality boundaries (monotonic while segments complete)', () => {
    let previous = 0;
    const weights: number[] = [];
    for (let quality = 0; quality < 3; quality++) {
      for (let done = 0; done <= 100; done += 10) {
        const weight = segmentProgressToWeight(info(quality, done, 100), ESTIMATE);
        expect(weight, `quality ${quality} done ${done}`).to.be.at.least(previous);
        weights.push(weight);
        previous = weight;
      }
    }
    expect(weights[weights.length - 1]).to.equal(ESTIMATE);
  });

  it('Clamps out-of-range callback data', () => {
    // Segment counts can drift past the total (playlist-derived end values).
    expect(segmentProgressToWeight(info(2, 150, 100), ESTIMATE)).to.equal(ESTIMATE);
    expect(segmentProgressToWeight(info(0, -1, 100), ESTIMATE)).to.equal(0);
  });

  it('Treats a zero quality count as one whole-item quality', () => {
    expect(segmentProgressToWeight(info(0, 40, 100, 0), ESTIMATE)).to.equal((2 / 5) * ESTIMATE);
  });

  it('Completes exactly at the estimate for single-unit (cleanup-only) items', () => {
    expect(segmentProgressToWeight(info(0, 1, 1, 1), 1)).to.equal(1);
  });
});
