import { EventEmitter } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, provideRouter, Router, Scroll } from '@angular/router';
import { Media } from '@vimtur/common';
import { of, ReplaySubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { CollectionService } from 'app/services/collection.service';
import { ConfigService } from 'app/services/config.service';
import { GalleryService, GalleryView } from 'app/services/gallery.service';
import { IntersectionService } from 'app/services/intersection.service';
import { ResizeService } from 'app/services/resize.service';
import { ScrollMemoryService } from 'app/services/scroll-memory.service';
import { GALLERY_ROW_HEIGHT } from 'app/shared/gallery-layout';
import { GalleryComponent } from './gallery.component';

const GALLERY_COLUMNS = 3;
const attachedHosts: HTMLElement[] = [];
let setScrollY: (value: number) => void;
let scrollToSpy: MockInstance;
let scrollBySpy: MockInstance;
let animationFrames: Map<number, FrameRequestCallback>;
let nextAnimationFrameId: number;

function flushAnimationFrames(): void {
  const frames = [...animationFrames.values()];
  animationFrames.clear();
  for (const frame of frames) {
    frame(0);
  }
}

function rect(width: number, top: number): DOMRect {
  return {
    width,
    height: 0,
    top,
    right: width,
    bottom: 0,
    left: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createMedia(hash: string): Media {
  return { hash, path: `/media/${hash}.jpg`, dir: '/media', type: 'still', tags: [], actors: [], hashDate: 0 } as unknown as Media;
}

function createMediaRange(start: number, count: number): Media[] {
  return Array.from({ length: count }, (_, index) => createMedia(`h${start + index}`));
}

function galleryView(overrides: Partial<GalleryView> = {}): GalleryView {
  return {
    version: 1,
    startIndex: 0,
    items: [],
    total: 0,
    totalRows: 0,
    offsetY: 0,
    loading: false,
    scrollTop: 0,
    ...overrides,
  };
}

function emitScroll(router: Router, url: string): void {
  const events = router.events as unknown as Subject<Event>;
  events.next(new Scroll(new NavigationEnd(1, url, url), null, null) as unknown as Event);
}

function emitNavigationStart(router: Router, url: string): void {
  const events = router.events as unknown as Subject<Event>;
  events.next(new NavigationStart(1, url) as unknown as Event);
}

interface Harness {
  fixture: ComponentFixture<GalleryComponent>;
  component: GalleryComponent;
  host: HTMLElement;
  view: ReplaySubject<GalleryView | undefined>;
  scrollByViewportRequest: Subject<number>;
  seekRequest: Subject<number>;
  setViewport: MockInstance;
  setActive: MockInstance;
  collectionService: { goto: MockInstance; getMetadata: () => unknown; isSearching: () => unknown };
  scrollMemory: ScrollMemoryService;
  resizeService: { resizeEmitter: EventEmitter<Map<unknown, ResizeObserverEntry>>; observe: MockInstance; unobserve: MockInstance };
  router: Router;
  rectSpy: MockInstance;
}

function createHarness(options: { attached?: boolean; width?: number; widths?: number[]; top?: number; detect?: boolean } = {}): Harness {
  const attached = options.attached ?? true;
  const view = new ReplaySubject<GalleryView | undefined>(1);
  const scrollByViewportRequest = new Subject<number>();
  const seekRequest = new Subject<number>();
  const setViewport = vi.fn();
  const setActive = vi.fn();
  const galleryService = {
    view,
    scrollByViewportRequest,
    seekRequest,
    setViewport,
    setActive,
  };
  const collectionService = {
    goto: vi.fn(),
    getMetadata: () => of(undefined),
    isSearching: () => of(false),
  };
  const resizeService = {
    resizeEmitter: new EventEmitter<Map<unknown, ResizeObserverEntry>>(),
    observe: vi.fn(),
    unobserve: vi.fn(),
  };
  const widths = options.widths ? [...options.widths] : undefined;

  TestBed.configureTestingModule({
    imports: [GalleryComponent],
    providers: [
      { provide: GalleryService, useValue: galleryService },
      { provide: CollectionService, useValue: collectionService },
      { provide: ResizeService, useValue: resizeService },
      { provide: ConfigService, useValue: { getConfiguration: () => of({}) } },
      {
        provide: IntersectionService,
        useValue: { intersectionEmitter: new EventEmitter<Map<unknown, IntersectionObserverEntry>>(), observe: vi.fn(), unobserve: vi.fn() },
      },
      provideRouter([]),
    ],
  });

  const fixture = TestBed.createComponent(GalleryComponent);
  const host = fixture.nativeElement as HTMLElement;
  const rectSpy = vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => rect(widths?.shift() ?? options.width ?? 1200, options.top ?? 100));
  if (attached) {
    document.body.appendChild(host);
    attachedHosts.push(host);
  }
  if (options.detect !== false) {
    fixture.detectChanges();
  }

  return {
    fixture,
    component: fixture.componentInstance,
    host,
    view,
    scrollByViewportRequest,
    seekRequest,
    setViewport,
    setActive,
    collectionService,
    scrollMemory: TestBed.inject(ScrollMemoryService),
    resizeService,
    router: TestBed.inject(Router),
    rectSpy,
  };
}

beforeEach(() => {
  const scrollYSpy = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
  setScrollY = value => scrollYSpy.mockReturnValue(value);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  animationFrames = new Map();
  nextAnimationFrameId = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = nextAnimationFrameId++;
    animationFrames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
    animationFrames.delete(id);
  });
});

afterEach(() => {
  for (const host of attachedHosts.splice(0)) {
    host.remove();
  }
  vi.restoreAllMocks();
});

describe('GalleryComponent', () => {
  it('renders only the windowed items of a large collection', () => {
    const harness = createHarness();

    harness.view.next(galleryView({ total: 50000, totalRows: Math.ceil(50000 / GALLERY_COLUMNS), items: createMediaRange(0, 15) }));
    harness.fixture.detectChanges();

    expect(harness.host.querySelectorAll('.image-container')).toHaveLength(15);
  });

  it('chunks the window into rows of the measured column count', () => {
    const harness = createHarness({ width: 1200 });
    harness.view.next(galleryView({ total: 15, totalRows: 5, items: createMediaRange(0, 15) }));
    harness.fixture.detectChanges();

    const rowSizes = (): number[] => Array.from(harness.host.querySelectorAll('.gallery-row')).map(row => row.querySelectorAll('.image-container').length);
    expect(rowSizes()).toEqual([3, 3, 3, 3, 3]);

    harness.view.next(galleryView({ total: 7, totalRows: 3, items: createMediaRange(0, 7) }));
    harness.fixture.detectChanges();

    expect(rowSizes()).toEqual([3, 3, 1]);
  });

  it('sizes the container from the total rows and translates the rendered window', () => {
    const harness = createHarness();

    // jsdom rounds CSS lengths to six significant figures, so keep this small.
    harness.view.next(galleryView({ total: 300, totalRows: 100, items: createMediaRange(0, 15), offsetY: 608 }));
    harness.fixture.detectChanges();

    const viewport = harness.host.querySelector('.gallery-viewport') as HTMLElement;
    const window = harness.host.querySelector('.gallery-window') as HTMLElement;
    expect(viewport.style.height).toBe(`${100 * GALLERY_ROW_HEIGHT}px`);
    expect(window.style.transform).toBe('translateY(608px)');
  });

  it('renders placeholders without an image and loaded items with a link and image', () => {
    const harness = createHarness();

    harness.view.next(galleryView({ total: 2, totalRows: 1, items: [undefined, createMedia('abc')] }));
    harness.fixture.detectChanges();

    const containers = harness.host.querySelectorAll('.image-container');
    expect(containers).toHaveLength(2);
    expect(containers[0].querySelector('img')).toBeNull();
    expect(containers[0].querySelector('app-preview')).toBeNull();
    expect(containers[0].querySelector('.placeholder')?.getAttribute('aria-hidden')).toBe('true');
    expect(containers[1].querySelector('a')).not.toBeNull();
    expect(containers[1].querySelector('img')?.getAttribute('src')).toBe('/cache/thumbnails/abc.png');
  });

  it('renders a preview for a video that has one', () => {
    const harness = createHarness();
    const video = {
      ...createMedia('vid'),
      type: 'video',
      preview: true,
      metadata: { width: 1920, height: 1080, length: 10 },
    } as unknown as Media;

    harness.view.next(galleryView({ total: 1, totalRows: 1, items: [video] }));
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.image-container app-preview')).not.toBeNull();
    expect(harness.host.querySelector('.image-container img.gallery-img')).toBeNull();
  });

  it('reports document coordinates to the gallery service', () => {
    const harness = createHarness({ width: 1200, top: 100 });
    setScrollY(300);
    harness.setViewport.mockClear();

    harness.component.updateViewport();

    expect(harness.setViewport).toHaveBeenCalledTimes(1);
    expect(harness.setViewport).toHaveBeenCalledWith({
      columns: GALLERY_COLUMNS,
      rowHeight: GALLERY_ROW_HEIGHT,
      scrollTop: 300,
      viewportHeight: 800,
      containerTop: 400,
    });
  });

  it('recomputes the columns on resize', () => {
    const harness = createHarness({ width: 1200 });
    expect(harness.setViewport.mock.calls.at(-1)?.[0].columns).toBe(GALLERY_COLUMNS);
    harness.setViewport.mockClear();

    harness.rectSpy.mockReturnValue(rect(800, 100));
    harness.component.onWindowResize();

    expect(harness.setViewport).toHaveBeenCalledTimes(1);
    expect(harness.setViewport.mock.calls[0][0].columns).toBe(2);
  });

  it('re-measures the laid-out width after the first render', () => {
    const harness = createHarness({ widths: [0, 1200], detect: false });

    harness.fixture.detectChanges();

    // ngOnInit measured before layout, so the first viewport is single-column.
    expect(harness.setViewport.mock.calls[0][0].columns).toBe(1);
    expect(animationFrames.size).toBe(1);

    flushAnimationFrames();

    expect(harness.setViewport).toHaveBeenLastCalledWith({
      columns: GALLERY_COLUMNS,
      rowHeight: GALLERY_ROW_HEIGHT,
      scrollTop: 0,
      viewportHeight: 800,
      containerTop: 100,
    });
  });

  it('re-measures when the host element resizes and stops observing on destroy', () => {
    const harness = createHarness();
    expect(harness.resizeService.observe).toHaveBeenCalledWith(expect.objectContaining({ nativeElement: harness.host }));
    harness.setViewport.mockClear();

    harness.rectSpy.mockReturnValue(rect(800, 100));
    harness.resizeService.resizeEmitter.emit(new Map([[harness.host, {} as ResizeObserverEntry]]));

    expect(harness.setViewport).toHaveBeenCalledTimes(1);
    expect(harness.setViewport.mock.calls[0][0].columns).toBe(2);

    harness.fixture.destroy();
    expect(harness.resizeService.unobserve).toHaveBeenCalledWith(expect.objectContaining({ nativeElement: harness.host }));
    expect(harness.setActive).toHaveBeenLastCalledWith(false);
  });

  it('remembers the measured scroll position on a throttled scroll', () => {
    const harness = createHarness();
    flushAnimationFrames();
    harness.setViewport.mockClear();
    const remember = vi.spyOn(harness.scrollMemory, 'remember');
    setScrollY(1234);

    window.dispatchEvent(new Event('scroll'));
    expect(animationFrames.size).toBe(1);

    flushAnimationFrames();

    expect(remember).toHaveBeenCalledWith('/gallery', 1234);
    expect(harness.setViewport).toHaveBeenCalledTimes(1);
    expect(harness.setViewport).toHaveBeenCalledWith({
      columns: GALLERY_COLUMNS,
      rowHeight: GALLERY_ROW_HEIGHT,
      scrollTop: 1234,
      viewportHeight: 800,
      containerTop: 1334,
    });
  });

  it('activates on init and deactivates on navigation start', () => {
    const harness = createHarness();
    expect(harness.setActive).toHaveBeenCalledWith(true);

    harness.setActive.mockClear();
    emitNavigationStart(harness.router, '/viewer');

    expect(harness.setActive).toHaveBeenCalledWith(false);
  });

  it('activates on a gallery Scroll event', () => {
    const harness = createHarness();
    harness.setActive.mockClear();
    harness.setViewport.mockClear();

    emitScroll(harness.router, '/gallery');

    expect(harness.setActive).toHaveBeenCalledWith(true);
    // There is no restore target, so the window is measured immediately.
    expect(harness.setViewport).toHaveBeenCalledTimes(1);
  });

  it('shows Loading… while the window is loading', () => {
    const harness = createHarness();
    harness.view.next(galleryView({ total: 10, totalRows: 4, items: [undefined, undefined], loading: true }));
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.gallery-status')?.textContent).toBe('Loading…');
  });

  it('shows End of results when the window reaches the total', () => {
    const harness = createHarness();
    harness.view.next(galleryView({ total: 2, totalRows: 1, items: createMediaRange(0, 2) }));
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.gallery-status')?.textContent).toBe('End of results');
  });

  it('shows no status for an empty collection', () => {
    const harness = createHarness();
    harness.view.next(galleryView({ total: 0, totalRows: 0, items: [] }));
    harness.fixture.detectChanges();

    expect(harness.host.querySelector('.gallery-status')?.textContent).toBe('');
  });

  it('forgets the saved scroll and seeks to the new collection version', () => {
    const harness = createHarness();
    const forget = vi.spyOn(harness.scrollMemory, 'forget');
    harness.view.next(galleryView({ version: 1 }));
    harness.fixture.detectChanges();
    forget.mockClear();
    scrollToSpy.mockClear();

    harness.view.next(galleryView({ version: 2, scrollTop: 456 }));

    expect(forget).toHaveBeenCalledWith('/gallery');
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 456, behavior: 'instant' });
  });

  it('defers the version scroll while detached until the gallery route is entered', () => {
    const harness = createHarness({ attached: false });
    const connected = vi.spyOn(harness.host, 'isConnected', 'get').mockReturnValue(false);

    harness.view.next(galleryView({ version: 1 }));
    harness.view.next(galleryView({ version: 2, scrollTop: 789 }));
    expect(scrollToSpy).not.toHaveBeenCalled();

    harness.scrollMemory.remember('/gallery', 111);
    connected.mockReturnValue(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      expect(scrollToSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(0);

      expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 789, behavior: 'instant' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the remembered scroll on a gallery Scroll event only', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 250);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery?tab=1');
      expect(scrollToSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(0);
      expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 250, behavior: 'instant' });

      harness.setViewport.mockClear();
      scrollToSpy.mockClear();
      emitScroll(harness.router, '/viewer');

      expect(scrollToSpy).not.toHaveBeenCalled();
      expect(harness.setViewport).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers the scroll restore past the synchronous event dispatch and keeps only the latest target', () => {
    const harness = createHarness();
    harness.setViewport.mockClear();
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      harness.scrollMemory.remember('/gallery', 1609238);
      emitScroll(harness.router, '/gallery');
      expect(scrollToSpy).not.toHaveBeenCalled();

      harness.scrollMemory.remember('/gallery', 1700000);
      emitScroll(harness.router, '/gallery');
      expect(scrollToSpy).not.toHaveBeenCalled();

      // A target must not measure/queue the top window before restoring; the
      // restore waits for RouterScroller's synchronous scroll-to-top.
      expect(harness.setViewport).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);

      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 1700000, behavior: 'instant' });
      expect(harness.setViewport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending scroll restore on destroy', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 250);
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      harness.fixture.destroy();

      vi.advanceTimersByTime(0);

      expect(scrollToSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending restore when a different route is navigated to', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 250);
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      emitScroll(harness.router, '/viewer');

      vi.advanceTimersByTime(0);

      expect(scrollToSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not apply a restore when the gallery detached before the timer fires', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 250);
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      vi.spyOn(harness.host, 'isConnected', 'get').mockReturnValue(false);

      vi.advanceTimersByTime(0);

      expect(scrollToSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-applies a drifted scroll restore exactly once', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 1700000);
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      vi.advanceTimersByTime(0);
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 1700000, behavior: 'instant' });

      // Chrome's scroll anchoring drifted the restored position while the
      // virtual window recycled rows.
      setScrollY(1594764);
      flushAnimationFrames();

      expect(scrollToSpy).toHaveBeenCalledTimes(2);
      expect(scrollToSpy).toHaveBeenLastCalledWith({ left: 0, top: 1700000, behavior: 'instant' });
      expect(animationFrames.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-apply a restored scroll that stayed put', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 1700000);
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      vi.advanceTimersByTime(0);
      expect(scrollToSpy).toHaveBeenCalledTimes(1);

      setScrollY(1700000);
      flushAnimationFrames();

      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      expect(animationFrames.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending scroll recheck on destroy', () => {
    const harness = createHarness();
    harness.scrollMemory.remember('/gallery', 250);
    scrollToSpy.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emitScroll(harness.router, '/gallery');
      vi.advanceTimersByTime(0);
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      // The post-render measurement and the post-restore recheck are pending.
      expect(animationFrames.size).toBe(2);

      harness.fixture.destroy();
      expect(animationFrames.size).toBe(0);

      flushAnimationFrames();
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls the window by a viewport on a scroll request', () => {
    const harness = createHarness();

    harness.scrollByViewportRequest.next(2);

    expect(scrollBySpy).toHaveBeenCalledWith({ top: 1600, behavior: 'smooth' });
  });

  it('scrolls to the target and re-measures the viewport on a seek request', () => {
    const harness = createHarness();
    harness.setViewport.mockClear();
    scrollToSpy.mockClear();

    harness.seekRequest.next(1400);

    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 1400, behavior: 'instant' });
    expect(harness.setViewport).toHaveBeenCalledTimes(1);
  });
});
