import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, NavigationSkipped, NavigationStart, Router, RouterLink, Scroll } from '@angular/router';
import { Media } from '@vimtur/common';
import { Subscription, timer } from 'rxjs';
import { filter } from 'rxjs/operators';
import { CollectionService } from 'services/collection.service';
import { GalleryService, GalleryView } from 'services/gallery.service';
import { ScrollMemoryService } from 'services/scroll-memory.service';
import { columnsForWidth, GALLERY_GAP, GALLERY_ROW_HEIGHT, GALLERY_TILE_HEIGHT } from 'app/shared/gallery-layout';
import { getSubtitle, getThumbnailSrc, getTitle } from 'app/shared/media-formatting';
import { GALLERY_ROUTE } from 'app/shared/routes';
import { LoadingComponent } from '../loading/loading.component';
import { PreviewComponent } from '../preview/preview.component';

interface GalleryRow {
  // Absolute collection index of the row's first item.
  start: number;
  items: Array<Media | undefined>;
}

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [RouterLink, PreviewComponent, LoadingComponent],
})
export class GalleryComponent implements OnInit, AfterViewInit, OnDestroy {
  public view?: GalleryView;
  // The measured column count, also exposed to CSS as --gallery-columns so a
  // partial last row cannot stretch its tiles across the full width.
  public columns = 1;
  public readonly rowHeight = GALLERY_ROW_HEIGHT;
  public readonly gap = GALLERY_GAP;
  public readonly tileHeight = GALLERY_TILE_HEIGHT;
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getSubtitle;
  public readonly getThumbnailSrc = getThumbnailSrc;
  public collectionService: CollectionService;

  private galleryService: GalleryService;
  private scrollMemory: ScrollMemoryService;
  private router: Router;
  private hostElement: ElementRef;
  private subscriptions: Subscription[] = [];
  private firstVisibleIndex = 0;
  private lastVersion?: number;
  private pendingScrollTop?: number;
  private scrollFrame?: number;
  private scrollCheckFrame?: number;
  private scrollRestoreSubscription?: Subscription;

  public constructor(
    galleryService: GalleryService,
    collectionService: CollectionService,
    scrollMemory: ScrollMemoryService,
    router: Router,
    hostElement: ElementRef,
  ) {
    this.galleryService = galleryService;
    this.collectionService = collectionService;
    this.scrollMemory = scrollMemory;
    this.router = router;
    this.hostElement = hostElement;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.galleryService.view.subscribe(view => {
        this.applyView(view);
      }),
    );
    this.subscriptions.push(
      this.galleryService.position.subscribe(position => {
        this.firstVisibleIndex = position?.startIndex ?? 0;
      }),
    );
    this.subscriptions.push(
      this.galleryService.seekRequest.subscribe(target => {
        // An explicit goto: the service has already moved the target window.
        this.scrollToY(target);
        this.updateViewport();
      }),
    );
    // The gallery component is retained while other routes are active, so a
    // navigation away has to stop detail fetching explicitly.
    this.subscriptions.push(
      this.router.events.pipe(filter((event): event is NavigationStart => event instanceof NavigationStart)).subscribe(() => {
        this.galleryService.setActive(false);
      }),
    );
    // This subscription is created after Angular's RouterScroller, so its
    // scroll restoration wins over the built-in scroll-to-top.
    this.subscriptions.push(
      this.router.events.pipe(filter((event): event is Scroll => event instanceof Scroll)).subscribe(event => {
        this.handleRouterScroll(event);
      }),
    );
    this.galleryService.setActive(true);
    this.updateViewport();
  }

  public ngAfterViewInit() {
    // The first updateViewport() runs before layout, so the host can still
    // measure 0px wide. Re-measure once the view is attached to the document.
    this.scheduleFrame(() => this.updateViewport());
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    if (this.scrollFrame !== undefined) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.scrollFrame);
      }
      this.scrollFrame = undefined;
    }

    if (this.scrollCheckFrame !== undefined) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.scrollCheckFrame);
      }
      this.scrollCheckFrame = undefined;
    }

    if (this.scrollRestoreSubscription !== undefined) {
      this.scrollRestoreSubscription.unsubscribe();
      this.scrollRestoreSubscription = undefined;
    }

    this.galleryService.setActive(false);
    this.view = undefined;
  }

  @HostListener('window:scroll')
  public onWindowScroll(): void {
    // Collapse a burst of scroll events into one measurement per frame.
    this.scheduleFrame(() => this.handleScroll());
  }

  @HostListener('window:resize')
  public onWindowResize(): void {
    this.handleResize();
  }

  private handleResize(): void {
    if (!this.hostElement.nativeElement.isConnected) {
      return;
    }

    const hostRect = this.hostElement.nativeElement.getBoundingClientRect();
    const nextColumns = columnsForWidth(hostRect.width);
    if (this.view && nextColumns !== this.columns) {
      // Keep the row holding the current top item at the top after a breakpoint
      // change; this is a no-op at scroll 0.
      const target = Math.floor(this.firstVisibleIndex / nextColumns) * GALLERY_ROW_HEIGHT;
      this.scrollToY(target);
    }
    this.updateViewport();
  }

  public updateViewport(): void {
    if (!this.hostElement.nativeElement.isConnected) {
      return;
    }

    const hostRect = this.hostElement.nativeElement.getBoundingClientRect();
    const columns = columnsForWidth(hostRect.width);
    const scrollTop = window.scrollY;
    const viewportHeight = window.innerHeight;
    const containerTop = hostRect.top + window.scrollY;
    this.columns = columns;

    this.galleryService.setViewport({
      columns,
      rowHeight: GALLERY_ROW_HEIGHT,
      scrollTop,
      viewportHeight,
      containerTop,
    });
  }

  public get rows(): GalleryRow[] {
    const view = this.view;
    if (!view) {
      return [];
    }

    const rows: GalleryRow[] = [];
    for (let offset = 0; offset < view.items.length; offset += this.columns) {
      rows.push({
        start: view.startIndex + offset,
        items: view.items.slice(offset, offset + this.columns),
      });
    }
    return rows;
  }

  public get status(): string {
    const view = this.view;
    if (!view || view.total === 0) {
      return '';
    }
    if (view.loading) {
      return 'Loading…';
    }
    if (view.startIndex + view.items.length >= view.total) {
      return 'End of results';
    }
    return '';
  }

  // A tile click navigates to the hash. Suppress the index-follow once so the
  // goto's index change cannot move the gallery grid the user just clicked in.
  public openMedia(media: Media): void {
    this.galleryService.suppressNextIndexFollow();
    this.collectionService.goto(media.hash);
  }

  private handleScroll(): void {
    if (!this.hostElement.nativeElement.isConnected) {
      return;
    }
    this.scrollMemory.remember(GALLERY_ROUTE, window.scrollY);
    this.updateViewport();
  }

  private scheduleFrame(update: () => void): void {
    // At most one measurement per frame, shared by scroll and post-render events.
    if (this.scrollFrame !== undefined) {
      return;
    }
    if (typeof requestAnimationFrame !== 'function') {
      update();
      return;
    }
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = undefined;
      update();
    });
  }

  private applyView(view?: GalleryView): void {
    const previousVersion = this.lastVersion;
    this.view = view;
    if (!view) {
      return;
    }
    this.lastVersion = view.version;

    // A new collection forgets the saved position and jumps to the target.
    if (previousVersion === undefined || view.version === previousVersion) {
      return;
    }
    this.scrollMemory.forget(GALLERY_ROUTE);
    this.pendingScrollTop = view.scrollTop;

    if (!this.hostElement.nativeElement.isConnected) {
      return;
    }
    this.scrollToY(view.scrollTop);
    this.pendingScrollTop = undefined;
    this.updateViewport();
  }

  private handleRouterScroll(event: Scroll): void {
    // Any navigation supersedes a restore that was waiting on the scheduler.
    if (this.scrollRestoreSubscription !== undefined) {
      this.scrollRestoreSubscription.unsubscribe();
      this.scrollRestoreSubscription = undefined;
    }
    if (this.scrollCheckFrame !== undefined) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.scrollCheckFrame);
      }
      this.scrollCheckFrame = undefined;
    }

    // RouterScroller emits Scroll alongside a NavigationEnd/NavigationSkipped,
    // which is the only event carrying the URL this restoration keys on.
    const routerEvent = event.routerEvent;
    if (!(routerEvent instanceof NavigationEnd || routerEvent instanceof NavigationSkipped)) {
      return;
    }
    const url = routerEvent instanceof NavigationEnd ? routerEvent.urlAfterRedirects || routerEvent.url : routerEvent.url;
    if (url.split('?')[0] !== GALLERY_ROUTE) {
      return;
    }

    this.galleryService.setActive(true);

    const target = this.pendingScrollTop !== undefined ? this.pendingScrollTop : this.scrollMemory.recall(GALLERY_ROUTE);
    if (target === undefined) {
      this.updateViewport();
      return;
    }

    // Do not measure/queue the top window before restoring; RouterScroller's
    // own Scroll consumer runs synchronously after this event dispatch and
    // scrolls to the top. Restoring on the next macrotask wins, and replacing
    // the subscription means a later navigation supersedes an earlier one.
    // timer(0) schedules through the zone-patched async scheduler, so the
    // callback already runs inside Angular's zone; no manual NgZone.run needed.
    this.scrollRestoreSubscription = timer(0).subscribe(() => {
      this.scrollRestoreSubscription = undefined;
      if (!this.hostElement.nativeElement.isConnected) {
        return;
      }
      // Only clear the pending seek this callback actually applied.
      if (this.pendingScrollTop === target) {
        this.pendingScrollTop = undefined;
      }
      this.scrollToY(target);
      this.updateViewport();
      this.scheduleScrollRecheck(target);
    });
  }

  private scheduleScrollRecheck(target: number): void {
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }
    if (this.scrollCheckFrame !== undefined) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.scrollCheckFrame);
      }
    }
    this.scrollCheckFrame = requestAnimationFrame(() => {
      this.scrollCheckFrame = undefined;
      if (!this.hostElement.nativeElement.isConnected) {
        return;
      }
      if (Math.abs(window.scrollY - target) <= 2) {
        return;
      }
      // Scroll anchoring can drift the position while the virtual window swaps
      // rows. Re-apply once and never chase it in a loop.
      this.scrollToY(target);
      this.updateViewport();
    });
  }

  // Bootstrap's reboot sets scroll-behavior: smooth on :root, which would
  // animate a two-argument scrollTo across the whole virtual list. Restores and
  // seeks must jump rather than animate.
  private scrollToY(top: number): void {
    window.scrollTo({ left: 0, top, behavior: 'instant' });
  }
}
