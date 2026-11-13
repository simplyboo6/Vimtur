import { describe, expect, it } from 'vitest';

import { columnsForWidth, computeWindow, formatGalleryPosition, GalleryPosition, GalleryViewport } from 'app/shared/gallery-layout';

function viewport(overrides: Partial<GalleryViewport> = {}): GalleryViewport {
  return {
    columns: 3,
    rowHeight: 100,
    scrollTop: 0,
    viewportHeight: 300,
    containerTop: 0,
    ...overrides,
  };
}

function position(overrides: Partial<GalleryPosition> = {}): GalleryPosition {
  return {
    startIndex: 0,
    endIndex: 15,
    total: 50000,
    ...overrides,
  };
}

describe('columnsForWidth', () => {
  it('never drops below one column', () => {
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(-100)).toBe(1);
  });

  it('counts the minimum tile width plus the gap per column', () => {
    expect(columnsForWidth(360)).toBe(1);
    expect(columnsForWidth(719)).toBe(1);
    // A second 360px tile needs 360 + 4 + 360 px, so 720 is still one column.
    expect(columnsForWidth(720)).toBe(1);
    expect(columnsForWidth(1000)).toBe(2);
    expect(columnsForWidth(1440)).toBe(3);
  });
});

describe('computeWindow', () => {
  it('returns an empty window for an empty collection', () => {
    expect(computeWindow(0, viewport())).toEqual({
      startRow: 0,
      endRow: 0,
      startIndex: 0,
      endIndex: 0,
      totalRows: 0,
      offsetY: 0,
      positionStart: 0,
      positionEnd: 0,
    });
  });

  it('renders everything when the collection is shorter than the viewport', () => {
    expect(computeWindow(5, viewport())).toEqual({
      startRow: 0,
      endRow: 2,
      startIndex: 0,
      endIndex: 5,
      totalRows: 2,
      offsetY: 0,
      positionStart: 0,
      positionEnd: 5,
    });
  });

  it('treats a viewport exactly one row tall as a single visible row', () => {
    expect(computeWindow(100, viewport({ scrollTop: 200, viewportHeight: 100 }))).toEqual({
      startRow: 0,
      endRow: 5,
      startIndex: 0,
      endIndex: 15,
      totalRows: 34,
      offsetY: 0,
      positionStart: 6,
      positionEnd: 9,
    });
  });

  it('offsets the window by the overscan in the middle of the collection', () => {
    // Viewport top at document Y=1300 with the container at 300 sees rows 10-12.
    expect(computeWindow(100, viewport({ scrollTop: 1300, containerTop: 300 }))).toEqual({
      startRow: 8,
      endRow: 15,
      startIndex: 24,
      endIndex: 45,
      totalRows: 34,
      offsetY: 800,
      positionStart: 30,
      positionEnd: 39,
    });
  });

  it('does not overscan when asked for none', () => {
    expect(computeWindow(100, viewport({ scrollTop: 100, overscanRows: 0 }))).toEqual({
      startRow: 1,
      endRow: 4,
      startIndex: 3,
      endIndex: 12,
      totalRows: 34,
      offsetY: 100,
      positionStart: 3,
      positionEnd: 12,
    });
  });

  it('clamps a scroll past the bottom of the collection to the last row', () => {
    expect(computeWindow(100, viewport({ scrollTop: 3500 }))).toEqual({
      startRow: 31,
      endRow: 34,
      startIndex: 93,
      endIndex: 100,
      totalRows: 34,
      offsetY: 3100,
      positionStart: 99,
      positionEnd: 100,
    });
  });

  it('clamps a scroll past the end after the collection shrinks', () => {
    expect(computeWindow(10, viewport({ scrollTop: 5000 }))).toEqual({
      startRow: 1,
      endRow: 4,
      startIndex: 3,
      endIndex: 10,
      totalRows: 4,
      offsetY: 100,
      positionStart: 9,
      positionEnd: 10,
    });
  });

  it('clamps negative scroll positions and column counts', () => {
    expect(computeWindow(10, viewport({ scrollTop: -500, columns: 0 }))).toEqual({
      startRow: 0,
      endRow: 5,
      startIndex: 0,
      endIndex: 5,
      totalRows: 10,
      offsetY: 0,
      positionStart: 0,
      positionEnd: 3,
    });
  });

  it('ignores a negative overscan', () => {
    expect(computeWindow(100, viewport({ scrollTop: 1000, viewportHeight: 100, overscanRows: -5 }))).toEqual({
      startRow: 10,
      endRow: 11,
      startIndex: 30,
      endIndex: 33,
      totalRows: 34,
      offsetY: 1000,
      positionStart: 30,
      positionEnd: 33,
    });
  });
});

describe('formatGalleryPosition', () => {
  it('renders nothing without a position or a collection', () => {
    expect(formatGalleryPosition()).toBe('');
    expect(formatGalleryPosition(position({ total: 0 }))).toBe('');
  });

  it('renders the first window', () => {
    expect(formatGalleryPosition(position())).toBe('1-15 of 50,000');
  });

  it('renders a middle window as a 1-based inclusive range', () => {
    expect(formatGalleryPosition(position({ startIndex: 40, endIndex: 80 }))).toBe('41-80 of 50,000');
  });

  it('renders the last window up to the total', () => {
    expect(formatGalleryPosition(position({ startIndex: 49960, endIndex: 50000 }))).toBe('49,961-50,000 of 50,000');
  });

  it('separates thousands', () => {
    expect(formatGalleryPosition(position({ startIndex: 1233, endIndex: 1253, total: 1253 }))).toBe('1,234-1,253 of 1,253');
  });

  it('renders nothing while the window has not been measured', () => {
    expect(formatGalleryPosition(position({ startIndex: 0, endIndex: 0 }))).toBe('');
  });
});
