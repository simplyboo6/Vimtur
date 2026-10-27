import type { SegmentMetadata } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ImportUtils } from '../cache/import-utils';

// Asserts that a segment list continuously covers [0, length] without gaps, duplicates or overshoot.
function assertContinuous(segments: SegmentMetadata, length: number): void {
  expect(segments.standard.length).to.be.at.least(1);
  expect(segments.standard[0].start).to.equal(0);
  let previousEnd = 0;
  for (const segment of segments.standard) {
    expect(segment.start).to.equal(previousEnd);
    expect(segment.end).to.be.at.most(length);
    expect(segment.end).to.be.above(segment.start);
    previousEnd = segment.end;
  }
  expect(previousEnd).to.equal(length);
}

describe('Segment Generation', () => {
  it('Generates a single whole-file segment without usable keyframes', () => {
    const segments = ImportUtils.buildSegments([], 60);
    expect(segments.standard).to.deep.equal([{ start: 0, end: 60 }]);
    assertContinuous(segments, 60);
  });

  it('Generates a single whole-file segment for short videos', () => {
    const segments = ImportUtils.buildSegments([1, 3, 5], 8);
    expect(segments.standard).to.deep.equal([{ start: 0, end: 8 }]);
    assertContinuous(segments, 8);
  });

  it('Drops degenerate keyframes and covers continuously', () => {
    // NaN, negative, zero and past-end keyframes must all be discarded.
    const segments = ImportUtils.buildSegments([1, 4, NaN, -2, 0, 15, 25], 40);
    assertContinuous(segments, 40);
    // [1, 4, 15] only 15 - 1 is over the max gap so cuts at 15, 25 is too close.
    expect(segments.standard).to.deep.equal([
      { start: 0, end: 1 },
      { start: 1, end: 15 },
      { start: 15, end: 40 },
    ]);
  });

  it('Skips keyframes closer than the max gap', () => {
    const segments = ImportUtils.buildSegments([2, 5, 7, 18, 20], 30);
    assertContinuous(segments, 30);
    // [2, 5, 7] are all within one max gap of the previous boundary so only 18 cuts.
    expect(segments.standard).to.deep.equal([
      { start: 0, end: 2 },
      { start: 2, end: 18 },
      { start: 18, end: 30 },
    ]);
  });

  it('Covers the tail when the final gap is over the max gap', () => {
    const segments = ImportUtils.buildSegments([30, 60], 89.5);
    assertContinuous(segments, 89.5);
    expect(segments.standard).to.deep.equal([
      { start: 0, end: 30 },
      { start: 30, end: 60 },
      { start: 60, end: 89.5 },
    ]);
  });

  it('Extends a single keyframe gap into a tail instead of duplicating it', () => {
    const segments = ImportUtils.buildSegments([10], 50);
    assertContinuous(segments, 50);
    // A lone keyframe at 10 means the only cut is the tail itself.
    expect(segments.standard).to.deep.equal([{ start: 0, end: 50 }]);
  });
});
