import { Media } from '@vimtur/common';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionMetadata, CollectionService } from 'app/services/collection.service';
import { ConfigService } from 'app/services/config.service';
import { GALLERY_CACHE_LIMIT, GALLERY_ERROR_COOLDOWN_MS, GalleryService, GalleryView } from 'app/services/gallery.service';
import { MediaService } from 'app/services/media.service';
import { ScrollMemoryService } from 'app/services/scroll-memory.service';
import { GalleryPosition, GalleryViewport } from 'app/shared/gallery-layout';

function createMedia(hash: string): Media {
  return { hash } as unknown as Media;
}

function makeCollection(count: number, prefix = 'h'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

function hashRange(start: number, end: number, prefix = 'h'): string[] {
  return Array.from({ length: end - start }, (_, index) => `${prefix}${start + index}`);
}

function viewport(overrides: Partial<GalleryViewport> = {}): GalleryViewport {
  return {
    columns: 3,
    rowHeight: 100,
    scrollTop: 100,
    viewportHeight: 300,
    containerTop: 100,
    ...overrides,
  };
}

function createHarness(
  getMedia: (hash: string) => Observable<Media | undefined> = hash => of(createMedia(hash)),
  options: { galleryImageCount?: number; configLoaded?: boolean; active?: boolean } = {},
) {
  const metadata = new Subject<CollectionMetadata | undefined>();
  const mediaService = { getMedia: vi.fn(getMedia) };
  const configService = {
    config: options.configLoaded === false ? undefined : { user: { galleryImageCount: options.galleryImageCount ?? 15 } },
  };
  const collectionService = { getMetadata: () => metadata };
  const scrollMemory = { forget: vi.fn(), remember: vi.fn(), recall: vi.fn() };

  const service = new GalleryService(
    mediaService as unknown as MediaService,
    configService as unknown as ConfigService,
    collectionService as unknown as CollectionService,
    scrollMemory as unknown as ScrollMemoryService,
  );
  service.setActive(options.active !== false);

  const views: Array<GalleryView | undefined> = [];
  const positions: Array<GalleryPosition | undefined> = [];
  service.view.subscribe(view => views.push(view));
  service.position.subscribe(position => positions.push(position));

  return { service, getMedia: mediaService.getMedia, metadata, views, positions, scrollMemory };
}

function createDeferredRequests() {
  const pending: Array<{ hash: string; subject: Subject<Media | undefined> }> = [];
  const getMedia = vi.fn((hash: string) => {
    const subject = new Subject<Media | undefined>();
    pending.push({ hash, subject });
    return subject.asObservable();
  });

  function take(hash: string): Subject<Media | undefined> | undefined {
    const index = pending.findIndex(request => request.hash === hash);
    if (index < 0) {
      return undefined;
    }
    return pending.splice(index, 1)[0].subject;
  }

  return {
    getMedia,
    pending,
    requestedHashes: (): string[] => getMedia.mock.calls.map(call => call[0]),
    requestCount: (): number => getMedia.mock.calls.length,
    resolve(hash: string): void {
      take(hash)?.next(createMedia(hash));
    },
    resolveAll(): void {
      // Resolving one request pumps the next queued one, so drain until empty.
      while (pending.length > 0) {
        const request = pending.shift();
        if (!request) {
          return;
        }
        request.subject.next(createMedia(request.hash));
      }
    },
  };
}

describe('GalleryService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('viewport', () => {
    it('is safe before the configuration and a collection exist', () => {
      const harness = createHarness(undefined, { configLoaded: false });

      expect(() => harness.service.setViewport(viewport())).not.toThrow();

      expect(harness.views.at(-1)).toBeUndefined();
      expect(harness.positions.at(-1)).toBeUndefined();
      expect(harness.getMedia).not.toHaveBeenCalled();
    });

    it('loads the window when the viewport arrives after the collection', () => {
      const harness = createHarness();

      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      expect(harness.getMedia).not.toHaveBeenCalled();
      expect(harness.positions.at(-1)?.total).toBe(100);

      harness.service.setViewport(viewport());

      expect(harness.getMedia.mock.calls.length).toBe(15);
      expect(harness.views.at(-1)?.startIndex).toBe(0);
    });

    it('loads the window when the collection arrives after the viewport', () => {
      const harness = createHarness();
      harness.service.setViewport(viewport());
      expect(harness.getMedia).not.toHaveBeenCalled();

      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      // The seek puts row 0 at the page top, so the viewport only covers the
      // 200px of content below its own top (2 visible rows plus 2 overscanned).
      expect(harness.getMedia.mock.calls.length).toBe(12);
      expect(harness.views.at(-1)?.total).toBe(100);
      expect(harness.views.at(-1)?.totalRows).toBe(34);
    });

    it('fetches exactly the window hashes and swaps placeholders for details', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport());

      expect(requests.requestedHashes()).toEqual(hashRange(0, 15));
      const placeholders = harness.views.at(-1);
      expect(placeholders?.items).toHaveLength(15);
      expect(placeholders?.items.every(item => item === undefined)).toBe(true);
      expect(placeholders?.loading).toBe(true);
      expect(placeholders?.total).toBe(100);
      expect(placeholders?.totalRows).toBe(34);
      expect(placeholders?.offsetY).toBe(0);
      expect(placeholders?.scrollTop).toBe(100);

      requests.resolve('h0');

      const partial = harness.views.at(-1);
      expect(partial?.items[0]?.hash).toBe('h0');
      expect(partial?.loading).toBe(true);
      // Emitted arrays are never mutated; loaded items arrive in a copy.
      expect(partial?.items).not.toBe(placeholders?.items);
      expect(placeholders?.items[0]).toBeUndefined();

      requests.resolveAll();

      const loaded = harness.views.at(-1);
      expect(loaded?.loading).toBe(false);
      expect(loaded?.items.map(item => item?.hash)).toEqual(hashRange(0, 15));
    });

    it('reports visible positions without the overscan rows', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport({ scrollTop: 500, containerTop: 0, viewportHeight: 100 }));

      expect(harness.views.at(-1)?.startIndex).toBe(9);
      expect(harness.views.at(-1)?.items).toHaveLength(15);
      expect(harness.positions.at(-1)).toEqual({ startIndex: 15, endIndex: 18, total: 100 });
    });
  });

  describe('redundant frames', () => {
    it('skips a scroll frame that stays inside the same row', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport({ scrollTop: 550, containerTop: 0 }));

      const views = harness.views.length;
      const positions = harness.positions.length;

      // Same rows, but the container moved while the local offset stayed put.
      harness.service.setViewport(viewport({ scrollTop: 600, containerTop: 50 }));

      expect(harness.views.length).toBe(views);
      expect(harness.positions.length).toBe(positions);

      const targets: number[] = [];
      harness.service.seekRequest.subscribe(target => targets.push(target));
      expect(harness.service.seekToIndex(0)).toBe(true);
      // Row 0 aligns with the page top, not with the navbar offset below it.
      expect(targets).toEqual([0]);
    });

    it('emits when the scroll crosses into a new row', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport({ scrollTop: 550, containerTop: 0 }));
      const views = harness.views.length;
      expect(harness.views.at(-1)?.startIndex).toBe(9);
      expect(harness.views.at(-1)?.offsetY).toBe(300);

      harness.service.setViewport(viewport({ scrollTop: 700, containerTop: 0 }));

      expect(harness.views.length).toBeGreaterThan(views);
      expect(harness.views.at(-1)?.startIndex).toBe(15);
      expect(harness.views.at(-1)?.offsetY).toBe(500);
    });

    it('emits for a new collection even when the window is unchanged', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport({ scrollTop: 500, containerTop: 0 }));
      const views = harness.views.length;
      const version = harness.views.at(-1)?.version;

      // Index 15 seeks back to row 5's top, which is where the view already is.
      harness.metadata.next({ index: 15, collection: [...collection] });

      expect(harness.views.length).toBeGreaterThan(views);
      expect(harness.views.at(-1)?.version).toBe((version ?? 0) + 1);
      expect(harness.views.at(-1)?.startIndex).toBe(9);
      expect(harness.views.at(-1)?.scrollTop).toBe(500);
    });

    it('emits for an order update with an unchanged window', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport({ scrollTop: 550, containerTop: 0 }));
      const views = harness.views.length;

      harness.metadata.next({ index: 0, collection: [...collection], order: true });

      expect(harness.views.length).toBe(views + 1);
      expect(harness.views.at(-1)?.startIndex).toBe(9);
    });

    it('still emits a detail load after a skipped frame', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport({ scrollTop: 550, containerTop: 0 }));
      const views = harness.views.length;
      const positions = harness.positions.length;

      harness.service.setViewport(viewport({ scrollTop: 600, containerTop: 50 }));
      expect(harness.views.length).toBe(views);
      expect(harness.positions.length).toBe(positions);

      requests.resolve('h9');

      expect(harness.views.length).toBe(views + 1);
      expect(harness.views.at(-1)?.items[0]?.hash).toBe('h9');
    });

    it('updates the range indicator when only the visible rows move', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(10) });
      harness.service.setViewport(viewport({ columns: 3, rowHeight: 304, scrollTop: 0, containerTop: 0, viewportHeight: 700 }));
      expect(harness.positions.at(-1)).toEqual({ startIndex: 0, endIndex: 9, total: 10 });
      const views = harness.views.length;

      harness.service.setViewport(viewport({ columns: 3, rowHeight: 304, scrollTop: 304, containerTop: 0, viewportHeight: 700 }));

      // The rendered window is the whole short collection in both frames.
      expect(harness.views.length).toBe(views);
      expect(harness.positions.at(-1)).toEqual({ startIndex: 3, endIndex: 10, total: 10 });
    });

    it('refreshes the view for a seek that does not move the window', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      // Already at row 5's top, which is where a seek to index 15 lands.
      harness.service.setViewport(viewport({ scrollTop: 500, containerTop: 0 }));
      const views = harness.views.length;
      const targets: number[] = [];
      harness.service.seekRequest.subscribe(target => targets.push(target));

      expect(harness.service.seekToIndex(15)).toBe(true);

      expect(targets).toEqual([500]);
      expect(harness.views.length).toBe(views + 1);
      expect(harness.views.at(-1)?.startIndex).toBe(9);
      expect(harness.views.at(-1)?.scrollTop).toBe(500);
    });
  });

  describe('detail loading', () => {
    it('does not re-fetch cached hashes when scrolling back', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport());
      expect(harness.getMedia.mock.calls.length).toBe(15);

      harness.service.setViewport(viewport({ scrollTop: 600 }));
      expect(harness.getMedia.mock.calls.length).toBe(30);
      expect(harness.views.at(-1)?.items.filter(item => item === undefined)).toHaveLength(0);

      harness.service.setViewport(viewport());
      expect(harness.getMedia.mock.calls.length).toBe(30);
      expect(harness.views.at(-1)?.items.filter(item => item === undefined)).toHaveLength(0);
    });

    it('limits outstanding requests to the configured batch size', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia, { galleryImageCount: 3 });
      harness.metadata.next({ index: 0, collection: makeCollection(200) });

      harness.service.setViewport(viewport());

      expect(requests.requestCount()).toBe(3);

      requests.resolve('h0');

      expect(requests.requestCount()).toBe(4);
      expect(requests.pending).toHaveLength(3);
    });

    it('falls back to the default batch size when configured as 0', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia, { galleryImageCount: 0 });
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport({ viewportHeight: 1500 }));

      expect(requests.requestCount()).toBe(15);
    });

    it('clamps the configured batch size to 50', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia, { galleryImageCount: 999 });
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport({ viewportHeight: 1500 }));

      expect(requests.requestCount()).toBe(50);
    });

    it('does not double-fetch when the viewport changes while requests are in flight', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport());
      harness.service.setViewport(viewport({ scrollTop: 1000 }));
      // The batch is still full, so the new window waits for the old requests.
      expect(requests.requestCount()).toBe(15);

      requests.resolveAll();

      const requested = requests.requestedHashes();
      expect(new Set(requested).size).toBe(requested.length);
      const view = harness.views.at(-1);
      expect(view?.startIndex).toBe(21);
      expect(view?.items.filter(item => item === undefined)).toHaveLength(0);
    });

    it('retries a failed detail once the cooldown expires while active', () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const failing = new Set(['h0']);
      const getMedia = vi.fn((hash: string) => (failing.delete(hash) ? throwError(() => new Error('boom')) : of(createMedia(hash))));
      const harness = createHarness(getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      const failedCalls = (): number => getMedia.mock.calls.filter(call => call[0] === 'h0').length;

      expect(() => harness.service.setViewport(viewport())).not.toThrow();
      expect(failedCalls()).toBe(1);
      expect(harness.views.at(-1)?.items[0]).toBeUndefined();

      vi.advanceTimersByTime(GALLERY_ERROR_COOLDOWN_MS - 1);
      expect(failedCalls()).toBe(1);

      vi.advanceTimersByTime(1);
      expect(failedCalls()).toBe(2);
      expect(harness.views.at(-1)?.items[0]?.hash).toBe('h0');
      expect(harness.views.at(-1)?.loading).toBe(false);
    });

    it('does not retry while the gallery is hidden', () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const getMedia = vi.fn((hash: string) => (hash === 'h0' ? throwError(() => new Error('boom')) : of(createMedia(hash))));
      const harness = createHarness(getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      const failedCalls = (): number => getMedia.mock.calls.filter(call => call[0] === 'h0').length;
      harness.service.setViewport(viewport());
      expect(failedCalls()).toBe(1);

      harness.service.setActive(false);
      vi.advanceTimersByTime(GALLERY_ERROR_COOLDOWN_MS);

      expect(failedCalls()).toBe(1);
    });

    it('clears pending retries on a collection reset', () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const getMedia = vi.fn((hash: string) => (hash === 'h0' ? throwError(() => new Error('boom')) : of(createMedia(hash))));
      const harness = createHarness(getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport());
      expect(vi.getTimerCount()).toBe(1);

      harness.metadata.next(undefined);

      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears pending retries on destroy', () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const getMedia = vi.fn((hash: string) => (hash === 'h0' ? throwError(() => new Error('boom')) : of(createMedia(hash))));
      const harness = createHarness(getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport());
      expect(vi.getTimerCount()).toBe(1);

      harness.service.ngOnDestroy();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the active window cached and evicts the oldest inactive entries', () => {
      const harness = createHarness();
      const itemCount = GALLERY_CACHE_LIMIT + 500;
      const rowCount = itemCount / 3;
      harness.metadata.next({ index: 0, collection: makeCollection(itemCount) });
      harness.service.setViewport(viewport());

      for (let row = 1; row < rowCount; row++) {
        harness.service.setViewport(viewport({ scrollTop: 100 + row * 100 }));
      }
      expect(harness.getMedia.mock.calls.length).toBe(itemCount);

      // Re-rendering the bottom window must not re-fetch it.
      harness.service.setViewport(viewport({ scrollTop: 100 + (rowCount - 1) * 100 }));
      expect(harness.getMedia.mock.calls.length).toBe(itemCount);

      // The start of the collection was evicted, so it is fetched again.
      harness.service.setViewport(viewport());
      expect(harness.getMedia.mock.calls.length).toBe(itemCount + 15);
      expect(harness.getMedia.mock.calls.filter(call => call[0] === 'h0')).toHaveLength(2);
    });
  });

  describe('collection changes', () => {
    it('ignores responses from a previous collection', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport());
      expect(requests.requestCount()).toBe(15);

      harness.metadata.next({ index: 0, collection: makeCollection(100, 'n') });

      const reset = harness.views.at(-1);
      expect(reset?.total).toBe(100);
      expect(reset?.startIndex).toBe(0);
      expect(reset?.scrollTop).toBe(0);
      expect(requests.requestCount()).toBe(27);

      const emissions = harness.views.length;
      requests.resolve('h0');

      expect(harness.views.length).toBe(emissions);
      // The stale detail must not be slotted into the new window.
      expect(harness.views.at(-1)?.items[0]).toBeUndefined();
    });

    it('drops removed hashes and shrinks the totals', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport());
      expect(harness.getMedia.mock.calls.length).toBe(15);

      harness.metadata.next({ index: 0, collection: collection.slice(2), removed: ['h0', 'h1'] });

      const view = harness.views.at(-1);
      expect(view?.total).toBe(98);
      expect(view?.totalRows).toBe(33);
      expect(view?.items.map(item => item?.hash)).toEqual(hashRange(2, 17));
      expect(view?.loading).toBe(false);
      // The surviving window hashes stayed cached; only the new tail was fetched.
      expect(harness.getMedia.mock.calls.slice(15).map(call => call[0])).toEqual(['h15', 'h16']);
    });

    it('resets the cache and version for a new search and seeks to the preserved index', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport());
      const version = harness.views.at(-1)?.version;

      harness.metadata.next({ index: 10, collection: [...collection] });

      const view = harness.views.at(-1);
      expect(view?.version).toBe((version ?? 0) + 1);
      // Row 3 of a 3-column layout, aligned with the page top.
      expect(view?.scrollTop).toBe(300);
      expect(view?.startIndex).toBe(0);
      // The window was re-requested in full because the cache was cleared.
      expect(harness.getMedia.mock.calls.length).toBe(36);
      expect(harness.getMedia.mock.calls.slice(15).map(call => call[0])).toEqual(hashRange(0, 21));
    });

    it('seeks a new collection to the page top rather than below the navbar', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      // A second search has a cached viewport when the collection arrives.
      harness.service.setViewport(viewport({ scrollTop: 56, containerTop: 56 }));

      harness.metadata.next({ index: 0, collection: [...collection] });

      expect(harness.views.at(-1)?.scrollTop).toBe(0);
    });

    it('seeks a new collection with a preserved index without the container offset', () => {
      const harness = createHarness();
      const collection = makeCollection(200);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport({ columns: 4, rowHeight: 304, scrollTop: 56, containerTop: 56 }));

      harness.metadata.next({ index: 40, collection: [...collection] });

      // Row 10 of a 4-column layout: 10 * 304, without the 56px navbar offset.
      expect(harness.views.at(-1)?.scrollTop).toBe(3040);
    });

    it('patches a detail whose collection index shifted while it loaded', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia);
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport());

      // Move h0 from the start to index 6 while its request is in flight.
      const reordered = [...collection];
      reordered.splice(0, 1);
      reordered.splice(6, 0, 'h0');
      harness.metadata.next({ index: 0, collection: reordered, order: true });
      expect(harness.views.at(-1)?.items[6]).toBeUndefined();

      requests.resolve('h0');

      expect(harness.views.at(-1)?.items[6]?.hash).toBe('h0');
      expect(harness.views.at(-1)?.items[0]?.hash).not.toBe('h0');
    });

    it('does not move the scroll position on an ordinary index change', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.service.setViewport(viewport());
      const views = harness.views.length;
      expect(harness.views.at(-1)?.scrollTop).toBe(100);

      harness.metadata.next({ index: 10, collection });

      // A tile click gathers the index for the viewer route; the gallery itself
      // must not move until an explicit seek is requested.
      expect(harness.views.length).toBe(views);
      expect(harness.views.at(-1)?.scrollTop).toBe(100);
    });
  });

  describe('activity', () => {
    it('renders without fetching while the gallery is hidden', () => {
      const harness = createHarness(undefined, { active: false });
      harness.metadata.next({ index: 0, collection: makeCollection(100) });

      harness.service.setViewport(viewport());

      expect(harness.views.at(-1)?.startIndex).toBe(0);
      expect(harness.views.at(-1)?.loading).toBe(true);
      expect(harness.getMedia).not.toHaveBeenCalled();

      harness.service.setActive(true);
      harness.service.setViewport(viewport({ scrollTop: 200 }));

      expect(harness.getMedia.mock.calls.length).toBeGreaterThan(0);
      expect(harness.views.at(-1)?.loading).toBe(false);
    });

    it('queues the retained window when the gallery becomes active again', () => {
      const requests = createDeferredRequests();
      const harness = createHarness(requests.getMedia);
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport());
      requests.resolveAll();

      // A search replaces the collection while the gallery is detached.
      harness.service.setActive(false);
      harness.metadata.next({ index: 0, collection: makeCollection(100, 'n') });
      expect(harness.views.at(-1)?.items.every(item => item === undefined)).toBe(true);
      const requestsBefore = requests.requestCount();

      // Re-attaching measures the same window as the one already emitted.
      harness.service.setActive(true);
      harness.service.setViewport(viewport());

      expect(requests.requestCount()).toBeGreaterThan(requestsBefore);
      requests.resolveAll();
      expect(harness.views.at(-1)?.loading).toBe(false);
      expect(harness.views.at(-1)?.items[0]?.hash).toBe('n0');
    });

    it('makes no requests when re-measuring a fully loaded window', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport());
      const requests = harness.getMedia.mock.calls.length;

      harness.service.setViewport(viewport());
      harness.service.setActive(true);

      expect(harness.getMedia.mock.calls.length).toBe(requests);
    });
  });

  describe('scroll memory', () => {
    it('forgets the gallery position when a new collection starts', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.scrollMemory.forget.mockClear();

      harness.metadata.next({ index: 0, collection: makeCollection(100, 'n') });

      expect(harness.scrollMemory.forget).toHaveBeenCalledWith('/gallery');
    });

    it('keeps the gallery position for removed, order and same-collection updates', () => {
      const harness = createHarness();
      const collection = makeCollection(100);
      harness.metadata.next({ index: 0, collection });
      harness.scrollMemory.forget.mockClear();

      harness.metadata.next({ index: 5, collection });
      harness.metadata.next({ index: 0, collection: [...collection], order: true });
      harness.metadata.next({ index: 0, collection: collection.slice(1), removed: ['h0'] });

      expect(harness.scrollMemory.forget).not.toHaveBeenCalled();
    });
  });

  describe('seekToIndex', () => {
    it('scrolls the requested item row to the top and emits the target', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport());

      const targets: number[] = [];
      harness.service.seekRequest.subscribe(target => targets.push(target));

      expect(harness.service.seekToIndex(40)).toBe(true);

      // Row 13 of a 3-column layout, aligned with the page top.
      expect(targets).toEqual([1300]);
      const view = harness.views.at(-1);
      expect(view?.scrollTop).toBe(1300);
      expect(view?.startIndex).toBe(30);
    });

    it('seeks row 0 to the page top, not below the navbar', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport({ scrollTop: 56, containerTop: 56 }));
      const targets: number[] = [];
      harness.service.seekRequest.subscribe(target => targets.push(target));

      expect(harness.service.seekToIndex(0)).toBe(true);

      expect(targets).toEqual([0]);
      expect(harness.views.at(-1)?.scrollTop).toBe(0);
    });

    it('does not offset a seek target by the measured container top', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(100) });
      harness.service.setViewport(viewport({ columns: 4, rowHeight: 304, scrollTop: 56, containerTop: 56 }));
      const targets: number[] = [];
      harness.service.seekRequest.subscribe(target => targets.push(target));

      expect(harness.service.seekToIndex(40)).toBe(true);

      // Row 10 of a 4-column layout: 10 * 304, without the 56px navbar offset.
      expect(targets).toEqual([3040]);
    });

    it('rejects an out-of-range or non-integer index without moving or emitting', () => {
      const harness = createHarness();
      harness.metadata.next({ index: 0, collection: makeCollection(10) });
      harness.service.setViewport(viewport());

      const targets: number[] = [];
      harness.service.seekRequest.subscribe(target => targets.push(target));
      const emissions = harness.views.length;

      expect(harness.service.seekToIndex(-1)).toBe(false);
      expect(harness.service.seekToIndex(10)).toBe(false);
      expect(harness.service.seekToIndex(1.5)).toBe(false);

      expect(targets).toEqual([]);
      expect(harness.views.length).toBe(emissions);
    });

    it('rejects a seek without a collection or a viewport', () => {
      const noCollection = createHarness();
      noCollection.service.setViewport(viewport());
      expect(noCollection.service.seekToIndex(0)).toBe(false);

      const noViewport = createHarness();
      noViewport.metadata.next({ index: 0, collection: makeCollection(10) });
      const targets: number[] = [];
      noViewport.service.seekRequest.subscribe(target => targets.push(target));
      expect(noViewport.service.seekToIndex(0)).toBe(false);
      expect(targets).toEqual([]);
    });
  });
});
