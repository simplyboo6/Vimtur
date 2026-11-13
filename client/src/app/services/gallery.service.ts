import { Injectable, OnDestroy } from '@angular/core';
import { Media } from '@vimtur/common';
import { ReplaySubject, Subject } from 'rxjs';
import { CollectionMetadata, CollectionService } from 'app/services/collection.service';
import { computeWindow, GalleryPosition, GalleryViewport, GalleryWindow } from 'app/shared/gallery-layout';
import { ConfigService } from './config.service';
import { MediaService } from './media.service';
import { ScrollMemoryService } from './scroll-memory.service';

// Matches the gallery component's route; the service also forgets the saved
// offset because a search can destroy the component before it forgets it.
const GALLERY_ROUTE = '/gallery';

// Cached media details. The gallery rarely revisits more than a screenful, so
// the cap bounds memory while leaving recently seen windows a re-scroll away.
export const GALLERY_CACHE_LIMIT = 1000;
// A failing detail fetch is not retried for this long, otherwise a broken
// backend would spin on every viewport update.
export const GALLERY_ERROR_COOLDOWN_MS = 5000;

const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 50;

export interface GalleryView {
  // Increments on a new collection (search/shuffle/reset).
  version: number;
  startIndex: number;
  // Contiguous slice; undefined = detail not loaded yet.
  items: Array<Media | undefined>;
  total: number;
  totalRows: number;
  offsetY: number;
  // Any item in the window is still pending.
  loading: boolean;
  // Target window.scrollY for this view.
  scrollTop: number;
}

interface QueuedDetail {
  index: number;
  hash: string;
}

@Injectable({
  providedIn: 'root',
})
export class GalleryService implements OnDestroy {
  public readonly view: ReplaySubject<GalleryView | undefined> = new ReplaySubject(1);

  public readonly position: ReplaySubject<GalleryPosition | undefined> = new ReplaySubject(1);

  // The component owns window.scrollBy.
  public readonly scrollByViewportRequest = new Subject<number>();

  // The component owns window.scrollTo for an explicit goto/seek.
  public readonly seekRequest = new Subject<number>();

  private mediaService: MediaService;
  private configService: ConfigService;
  private scrollMemory: ScrollMemoryService;
  private metadata?: CollectionMetadata;
  private active = false;
  private viewport?: GalleryViewport;
  private currentView?: GalleryView;
  private lastPosition?: GalleryPosition;
  // Map insertion order doubles as LRU recency.
  private cache = new Map<string, Media>();
  private inFlight = new Set<string>();
  private activeHashes = new Set<string>();
  private queue: QueuedDetail[] = [];
  private failedUntil = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = 0;
  private pumping = false;

  public constructor(mediaService: MediaService, configService: ConfigService, collectionService: CollectionService, scrollMemory: ScrollMemoryService) {
    this.mediaService = mediaService;
    this.configService = configService;
    this.scrollMemory = scrollMemory;

    collectionService.getMetadata().subscribe(metadata => {
      this.setMetadata(metadata);
    });
  }

  public ngOnDestroy(): void {
    this.clearRetryTimers();
  }

  // The component owns this: a hidden gallery still renders but must not fetch.
  public setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      return;
    }
    // The component activates before measuring, so the retained viewport can be
    // the previous visit's. Queue it here too: a re-attached gallery whose
    // first measurement matches the retained window would otherwise never
    // request its details.
    const collection = this.metadata?.collection;
    const viewport = this.viewport;
    if (collection && viewport) {
      this.queueWindow(computeWindow(collection.length, viewport));
    }
  }

  public setViewport(viewport: GalleryViewport): void {
    this.viewport = { ...viewport };
    this.refreshView();
  }

  public scrollByViewport(delta: number): void {
    this.scrollByViewportRequest.next(delta);
  }

  // Scrolls the requested 0-based item's row to the top of the viewport.
  public seekToIndex(index: number): boolean {
    const collection = this.metadata?.collection;
    const viewport = this.viewport;
    if (!collection || !viewport) {
      return false;
    }
    if (!Number.isInteger(index) || index < 0 || index >= collection.length) {
      return false;
    }

    this.seekViewportToIndex(index);
    // Forced: an explicit goto must refresh the view even when its row is
    // already the current window.
    this.refreshView(true);
    this.seekRequest.next(viewport.scrollTop);
    return true;
  }

  private setMetadata(metadata?: CollectionMetadata): void {
    const previous = this.metadata?.collection;
    this.metadata = metadata;

    if (!metadata) {
      this.resetCollection();
      return;
    }

    if (previous === metadata.collection) {
      // Same collection: a tile click or offset only moves CollectionService's
      // index, which the gallery does not act on until an explicit seek.
      this.refreshView();
      return;
    }

    if (previous !== undefined && metadata.removed) {
      for (const hash of metadata.removed) {
        this.cache.delete(hash);
      }
      this.refreshView(true);
      return;
    }

    if (previous !== undefined && metadata.order === true) {
      this.refreshView(true);
      return;
    }

    // A new search may have torn the gallery component down before its
    // version-change handler could forget the old pixel offset (the app hides
    // the gallery while searching), so retrying that here stops the new
    // results restoring at a stale position.
    this.scrollMemory.forget(GALLERY_ROUTE);
    // A new search, shuffle or reset invalidates every cached detail.
    this.resetCache();
    this.seekViewportToIndex(metadata.index);
    this.refreshView(true);
  }

  private resetCollection(): void {
    this.resetCache();
    this.currentView = undefined;
    this.view.next(undefined);
    this.lastPosition = undefined;
    this.position.next(undefined);
  }

  private resetCache(): void {
    // Late responses from the old collection must be ignored.
    this.generation++;
    this.cache.clear();
    this.inFlight.clear();
    this.activeHashes.clear();
    this.queue = [];
    this.failedUntil.clear();
    this.clearRetryTimers();
  }

  // Places the item's row at the top of the content. containerTop is where the
  // gallery sits at rest (below the fixed navbar), not part of the scroll
  // target: adding it scrolls row 0 up behind the navbar.
  private seekViewportToIndex(index: number): void {
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    const columns = Math.max(1, Math.floor(viewport.columns));
    viewport.scrollTop = Math.max(0, Math.floor(index / columns) * viewport.rowHeight);
  }

  private refreshView(force = false): void {
    const collection = this.metadata?.collection;
    if (!collection) {
      this.currentView = undefined;
      this.activeHashes.clear();
      this.view.next(undefined);
      this.lastPosition = undefined;
      this.position.next(undefined);
      return;
    }

    const viewport = this.viewport;
    if (!viewport) {
      this.emitPosition({ startIndex: 0, endIndex: 0, total: collection.length });
      return;
    }

    const window = computeWindow(collection.length, viewport);

    // The visible range can move while the rendered window does not (the rows
    // clamp at either end of a short collection), so update the range
    // indicator before the window skip.
    this.emitPosition({ startIndex: window.positionStart, endIndex: window.positionEnd, total: collection.length });

    // Scrolling inside a row leaves the rendered window identical. Skip the
    // view work so Angular isn't asked to re-render the same tiles every frame.
    // The stored viewport already holds this frame's scrollTop, so a later
    // goto/seek still starts from where the user actually is. Details are still
    // queued: a window can be emitted while the gallery is detached/inactive
    // (a search replaces the collection), and the re-attached component's first
    // measurement is that same window, so without queueing here its details
    // would never be requested. queueWindow is a no-op when inactive and
    // dedupes cached/in-flight hashes, so a loaded window makes no requests.
    if (!force && this.isUnchangedWindow(window, collection.length)) {
      this.queueWindow(window);
      return;
    }

    const items: Array<Media | undefined> = [];
    this.activeHashes.clear();
    for (let index = window.startIndex; index < window.endIndex; index++) {
      const hash = collection[index];
      this.activeHashes.add(hash);
      items.push(this.cacheGet(hash));
    }

    this.emitView({
      version: this.generation,
      startIndex: window.startIndex,
      items,
      total: collection.length,
      totalRows: window.totalRows,
      offsetY: window.offsetY,
      loading: false,
      scrollTop: viewport.scrollTop,
    });

    this.queueWindow(window);
  }

  private isUnchangedWindow(window: GalleryWindow, total: number): boolean {
    const current = this.currentView;
    if (!current) {
      return false;
    }
    return (
      current.startIndex === window.startIndex &&
      current.items.length === window.endIndex - window.startIndex &&
      current.offsetY === window.offsetY &&
      current.total === total &&
      current.totalRows === window.totalRows &&
      current.version === this.generation
    );
  }

  private emitPosition(position: GalleryPosition): void {
    const last = this.lastPosition;
    if (last && last.startIndex === position.startIndex && last.endIndex === position.endIndex && last.total === position.total) {
      return;
    }
    this.lastPosition = position;
    this.position.next(position);
  }

  private queueWindow(window: GalleryWindow): void {
    const collection = this.metadata?.collection;
    if (!collection) {
      return;
    }
    if (!this.active) {
      // A hidden gallery still renders, but fetching its details would waste
      // bandwidth for windows the user cannot see.
      return;
    }

    const now = Date.now();
    const queue: QueuedDetail[] = [];
    for (let index = window.startIndex; index < window.endIndex; index++) {
      const hash = collection[index];
      if (this.cache.has(hash) || this.inFlight.has(hash)) {
        continue;
      }
      const failedUntil = this.failedUntil.get(hash);
      if (failedUntil !== undefined && failedUntil > now) {
        continue;
      }
      queue.push({ index, hash });
    }

    // Replace rather than append: entries for a window the user has scrolled
    // away from are no longer worth fetching.
    this.queue = queue;
    this.pump();
  }

  private pump(): void {
    // Synchronous responses re-enter here; the outer loop drains the queue.
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      while (this.inFlight.size < this.getBatchSize()) {
        const next = this.queue.shift();
        if (!next) {
          return;
        }
        if (this.cache.has(next.hash) || this.inFlight.has(next.hash)) {
          continue;
        }
        // A removal may have shifted the collection since it was queued.
        if (this.metadata?.collection?.[next.index] !== next.hash) {
          continue;
        }
        this.requestDetail(next.hash, next.index);
      }
    } finally {
      this.pumping = false;
    }
  }

  private requestDetail(hash: string, index: number): void {
    const generation = this.generation;
    this.inFlight.add(hash);
    this.mediaService.getMedia(hash).subscribe(
      media => {
        if (media) {
          this.applyLoaded(media, hash, index, generation);
        } else {
          this.applyError(hash, generation, new Error(`Media not found: ${hash}`));
        }
      },
      err => {
        this.applyError(hash, generation, err);
      },
    );
  }

  private applyLoaded(media: Media, hash: string, index: number, generation: number): void {
    if (generation !== this.generation) {
      return;
    }
    this.inFlight.delete(hash);
    this.cacheSet(hash, media);

    const view = this.currentView;
    const collection = this.metadata?.collection;
    if (view && collection) {
      // A removal or reorder can shift the hash while its request is in flight,
      // so resolve its current position instead of trusting the queued index.
      const currentIndex = collection[index] === hash ? index : collection.indexOf(hash);
      const offset = currentIndex - view.startIndex;
      if (currentIndex >= 0 && offset >= 0 && offset < view.items.length) {
        const items = [...view.items];
        items[offset] = media;
        this.emitView({ ...view, items });
      }
    }

    this.pump();
  }

  private applyError(hash: string, generation: number, err: unknown): void {
    if (generation !== this.generation) {
      return;
    }
    this.inFlight.delete(hash);
    this.failedUntil.set(hash, Date.now() + GALLERY_ERROR_COOLDOWN_MS);
    console.error('Failed to load gallery media', hash, err);
    this.scheduleRetry(hash);
    this.pump();
  }

  // A one-shot retry for an error that lands while the gallery is stationary,
  // which would otherwise stay a placeholder until the user scrolls.
  private scheduleRetry(hash: string): void {
    const existing = this.retryTimers.get(hash);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(hash);
      this.retryDetail(hash);
    }, GALLERY_ERROR_COOLDOWN_MS);
    this.retryTimers.set(hash, timer);
  }

  private retryDetail(hash: string): void {
    const collection = this.metadata?.collection;
    if (!this.active || !collection || this.cache.has(hash) || !this.activeHashes.has(hash)) {
      return;
    }
    if (this.inFlight.has(hash) || this.queue.some(entry => entry.hash === hash)) {
      return;
    }
    const index = collection.indexOf(hash);
    if (index < 0) {
      return;
    }
    this.queue.push({ index, hash });
    this.pump();
  }

  private clearRetryTimers(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }

  private emitView(view: GalleryView): void {
    const next: GalleryView = {
      ...view,
      loading: view.items.some(item => item === undefined),
    };
    this.currentView = next;
    this.view.next(next);
  }

  private cacheGet(hash: string): Media | undefined {
    const media = this.cache.get(hash);
    if (!media) {
      return undefined;
    }
    // Touch on read so the rendered window is the most recently used.
    this.cache.delete(hash);
    this.cache.set(hash, media);
    return media;
  }

  private cacheSet(hash: string, media: Media): void {
    this.cache.delete(hash);
    this.cache.set(hash, media);
    this.evictCache();
  }

  // Evict the oldest entries, never one that is currently rendered.
  private evictCache(): void {
    for (const hash of this.cache.keys()) {
      if (this.cache.size <= GALLERY_CACHE_LIMIT) {
        return;
      }
      if (this.activeHashes.has(hash)) {
        continue;
      }
      this.cache.delete(hash);
    }
  }

  private getBatchSize(): number {
    const configured = this.configService.config?.user?.galleryImageCount;
    const batchSize = Math.floor(Number(configured) || DEFAULT_BATCH_SIZE);
    return Math.max(1, Math.min(MAX_BATCH_SIZE, batchSize));
  }
}
