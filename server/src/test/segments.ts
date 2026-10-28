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

describe('Segment Count Estimation', () => {
  // Progress-reporting estimate: an upper bound on the real count (usually
  // far lower) and degenerate/missing lengths still yield one whole-file unit.
  it('Is an upper bound on the real segment count', () => {
    expect(ImportUtils.estimateSegmentCount(0)).to.equal(1);
    expect(ImportUtils.estimateSegmentCount(3)).to.equal(1);
    expect(ImportUtils.estimateSegmentCount(NaN)).to.equal(1);
    expect(ImportUtils.estimateSegmentCount(100)).to.equal(13);
    expect(ImportUtils.estimateSegmentCount(8940)).to.equal(897);
  });

  it('Never underestimates what buildSegments produces', () => {
    // Cross-check against the real splitter over the same keyframe fixtures,
    // including the pathological case a naive length/gap bound gets wrong:
    // near-zero first keyframe + just-over-gap spacing yields one more cut
    // than gap count (11 real segments vs the 10 naive estimate for a 100s video).
    const pathologicKeyframes: number[] = [];
    for (let i = 0.5; i < 100; i += 10.5) {
      pathologicKeyframes.push(i);
    }
    const fixtures: Array<[number[], number]> = [
      [[], 60],
      [[1, 3, 5], 8],
      [[1, 4, NaN, -2, 0, 15, 25], 40],
      [[2, 5, 7, 18, 20], 30],
      [[30, 60], 89.5],
      [[10], 50],
      [pathologicKeyframes, 100],
      [pathologicKeyframes, 100.5],
      [pathologicKeyframes, 200],
    ];
    for (const [keyframes, length] of fixtures) {
      expect(
        ImportUtils.estimateSegmentCount(length),
        `keyframes ${JSON.stringify(keyframes)} length ${length}`,
      ).to.be.at.least(ImportUtils.buildSegments(keyframes, length).standard.length);
    }
  });
});
