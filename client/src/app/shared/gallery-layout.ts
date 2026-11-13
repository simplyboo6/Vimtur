// Pure layout maths for the virtualized gallery. All units are CSS pixels.
// columnsForWidth keeps each flex tile at or above GALLERY_TILE_MIN_WIDTH so the
// column count matches the rendered CSS row, and rows are a fixed height so the
// window can be computed without measuring the DOM.

export const GALLERY_TILE_MIN_WIDTH = 360;
// The media box (and tile) height; the caption overlays it rather than taking
// layout space.
export const GALLERY_TILE_HEIGHT = 240;
// The gap between tiles on both axes (the flex row's column gap and the
// vertical gap between rows).
export const GALLERY_GAP = 4;
// The row is the media box plus the gap: the caption overlays the tile, so it
// adds no height, and the row's own padding comes out of the gap.
export const GALLERY_ROW_HEIGHT = GALLERY_TILE_HEIGHT + GALLERY_GAP;
// The virtual height is totalRows * rowHeight in document pixels. Chrome caps
// document/element height at roughly 33.5M px, so a single-column list beyond
// ~110k items would silently break the scrollbar; the design target is 50k
// items with 4+ columns typical.
// Extra rows rendered above and below the viewport to hide scroll-in latency.
export const GALLERY_OVERSCAN_ROWS = 2;

export interface GalleryViewport {
  columns: number;
  rowHeight: number;
  // window.scrollY (document coordinates).
  scrollTop: number;
  // window.innerHeight.
  viewportHeight: number;
  // Document Y of the gallery container's top.
  containerTop: number;
  overscanRows?: number;
}

export interface GalleryWindow {
  startRow: number;
  endRow: number;
  // Exclusive.
  startIndex: number;
  // Exclusive.
  endIndex: number;
  totalRows: number;
  // startRow * rowHeight, for translating the rendered window.
  offsetY: number;
  // First visible (non-overscan) index.
  positionStart: number;
  // Exclusive last visible index.
  positionEnd: number;
}

export interface GalleryPosition {
  // First visible item.
  startIndex: number;
  // Exclusive.
  endIndex: number;
  total: number;
}

export function columnsForWidth(width: number): number {
  const safeWidth = Math.max(0, width);
  return Math.max(1, Math.floor((safeWidth + GALLERY_GAP) / (GALLERY_TILE_MIN_WIDTH + GALLERY_GAP)));
}

export function computeWindow(itemCount: number, viewport: GalleryViewport): GalleryWindow {
  const count = Math.max(0, Math.floor(itemCount));
  const columns = Math.max(1, Math.floor(viewport.columns));
  const rowHeight = Math.max(1, viewport.rowHeight);
  const overscanRows = Math.max(0, Math.floor(viewport.overscanRows ?? GALLERY_OVERSCAN_ROWS));
  const scrollTop = Math.max(0, viewport.scrollTop);
  const viewportHeight = Math.max(0, viewport.viewportHeight);
  const totalRows = count === 0 ? 0 : Math.ceil(count / columns);

  if (totalRows === 0) {
    return {
      startRow: 0,
      endRow: 0,
      startIndex: 0,
      endIndex: 0,
      totalRows: 0,
      offsetY: 0,
      positionStart: 0,
      positionEnd: 0,
    };
  }

  const localTop = Math.max(0, scrollTop - viewport.containerTop);
  const localBottom = Math.max(localTop, scrollTop + viewportHeight - viewport.containerTop);
  const firstVisible = clamp(Math.floor(localTop / rowHeight), 0, totalRows - 1);
  // A zero-height viewport still shows the row at the scroll position.
  const lastVisible = Math.max(firstVisible, clamp(Math.floor((localBottom - 1) / rowHeight), 0, totalRows - 1));

  const startRow = Math.max(0, firstVisible - overscanRows);
  const endRow = Math.min(totalRows, lastVisible + 1 + overscanRows);

  return {
    startRow,
    endRow,
    startIndex: startRow * columns,
    endIndex: Math.min(count, endRow * columns),
    totalRows,
    offsetY: startRow * rowHeight,
    positionStart: firstVisible * columns,
    positionEnd: Math.min(count, (lastVisible + 1) * columns),
  };
}

// Renders the visible range as a 1-based inclusive indicator, e.g. "41-80 of 50,000".
export function formatGalleryPosition(position?: GalleryPosition): string {
  if (!position || position.total <= 0) {
    return '';
  }
  // Before the first viewport measurement the range is empty, which would
  // otherwise render as "1-0 of N".
  if (position.endIndex <= position.startIndex) {
    return '';
  }
  return `${(position.startIndex + 1).toLocaleString()}-${position.endIndex.toLocaleString()} of ${position.total.toLocaleString()}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
