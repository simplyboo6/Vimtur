import { Component, OnInit, OnDestroy } from '@angular/core';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { UiService } from 'services/ui.service';
import { GalleryService, Page } from 'services/gallery.service';
import { CollectionService } from 'services/collection.service';
import { MediaService } from 'services/media.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, Observable, combineLatest } from 'rxjs';
import { map, filter, startWith } from 'rxjs/operators';
import {
  faArrowLeft,
  faArrowRight,
  faTags,
  faBackward,
  faForward,
  faShuffle,
  faTrash,
  faFolderOpen,
  faDiamondTurnRight,
  IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

interface NavItemButton {
  type: 'button';
  click: () => void;
  title: string;
  icon: IconDefinition;
  visible: Observable<boolean>;
}

interface NavItemPaginator {
  type: 'paginator';
  page: Observable<Page>;
  visible: Observable<boolean>;
}

type NavItem = NavItemButton | NavItemPaginator;

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  protected tagsOpen = false;
  protected collectionService: CollectionService;
  protected searchText?: string;
  protected isExpanded = false;
  protected navItems: NavItem[];
  protected readonly faTags = faTags;
  protected showToggleTags: Observable<boolean>;
  protected currentRoute?: string;

  private uiService: UiService;
  private mediaService: MediaService;
  private galleryService: GalleryService;
  private subscriptions: Subscription[] = [];
  private breakpointObserver: BreakpointObserver;
  private routeObservable: Observable<string>;

  public constructor(
    collectionService: CollectionService,
    uiService: UiService,
    mediaService: MediaService,
    galleryService: GalleryService,
    breakpointObserver: BreakpointObserver,
    router: Router,
  ) {
    this.uiService = uiService;
    this.collectionService = collectionService;
    this.mediaService = mediaService;
    this.galleryService = galleryService;
    this.breakpointObserver = breakpointObserver;

    this.routeObservable = router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      startWith(router),
      map(event => {
        if (event instanceof NavigationEnd) {
          return event.urlAfterRedirects || event.url;
        }
        return (event as Router).url;
      }),
    );

    const isBigScreenObservable = this.breakpointObserver.observe(Breakpoints.XSmall).pipe(map(result => !result.matches));
    const singularUrls = ['/viewer', '/metadata', '/clone-resolve'];
    const isSingularObservable = this.routeObservable.pipe(map(url => singularUrls.includes(url)));
    const galleryUrl = '/gallery';
    const isGalleryObservable = this.routeObservable.pipe(map(url => url === galleryUrl));
    const navEnabledObservable = combineLatest([isSingularObservable, isGalleryObservable]).pipe(map(([isSingular, isGallery]) => isSingular || isGallery));

    this.showToggleTags = combineLatest([isBigScreenObservable, this.routeObservable]).pipe(map(([isBigScreen, url]) => isBigScreen && url === '/viewer'));

    this.navItems = [
      {
        type: 'button',
        title: 'Previous Directory',
        icon: faBackward,
        click: () => uiService.offsetDirectory(-1),
        visible: combineLatest([isBigScreenObservable, isSingularObservable]).pipe(
          map(([isBigScreen, isSingular]) => {
            return isBigScreen && isSingular;
          }),
        ),
      },
      {
        type: 'button',
        title: 'Previous',
        icon: faArrowLeft,
        click: () => {
          if (this.currentRoute) {
            if (singularUrls.includes(this.currentRoute)) {
              this.collectionService.offset(-1);
            } else if (galleryUrl === this.currentRoute) {
              this.galleryService.offset(-1);
            }
          }
        },
        visible: navEnabledObservable,
      },
      {
        type: 'button',
        title: 'Shuffle',
        icon: faShuffle,
        click: () => this.collectionService.shuffle(),
        visible: isGalleryObservable,
      },
      {
        type: 'button',
        title: 'Delete',
        icon: faTrash,
        click: () => this.collectionService.deleteCurrent(),
        visible: isSingularObservable,
      },
      {
        type: 'button',
        title: 'View Folder',
        icon: faFolderOpen,
        click: () => {
          if (this.mediaService.media) {
            const searchModel = this.uiService.createSearchModel();
            searchModel.dir.like = this.mediaService.media.dir;
            searchModel.sortBy = 'path';
            this.uiService.searchModel.next(searchModel);
            this.collectionService.search(this.uiService.createSearch(searchModel), { preserve: true });
          }
        },
        visible: isSingularObservable,
      },
      {
        type: 'paginator',
        page: this.galleryService.page,
        visible: isGalleryObservable,
      },
      {
        type: 'button',
        title: 'Goto',
        icon: faDiamondTurnRight,
        click: () => this.collectionService.goto(this.currentRoute === galleryUrl),
        visible: navEnabledObservable,
      },
      {
        type: 'button',
        title: 'Next',
        icon: faArrowRight,
        click: () => {
          if (this.currentRoute) {
            if (singularUrls.includes(this.currentRoute)) {
              this.collectionService.offset(1);
            } else if (galleryUrl === this.currentRoute) {
              this.galleryService.offset(1);
            }
          }
        },
        visible: navEnabledObservable,
      },
      {
        type: 'button',
        title: 'Next Directory',
        icon: faForward,
        click: () => uiService.offsetDirectory(1),
        visible: combineLatest([isBigScreenObservable, isSingularObservable]).pipe(
          map(([isBigScreen, isSingular]) => {
            return isBigScreen && isSingular;
          }),
        ),
      },
    ];
  }

  public ngOnInit() {
    this.updateTagPanelState();

    this.subscriptions.push(
      this.uiService.searchModel.subscribe(searchModel => {
        this.searchText = searchModel.keywords;
      }),
    );

    this.subscriptions.push(this.routeObservable.subscribe(route => (this.currentRoute = route)));
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public viewFolder() {
    if (this.mediaService.media) {
      const searchModel = this.uiService.createSearchModel();
      searchModel.dir.like = this.mediaService.media.dir;
      searchModel.sortBy = 'path';
      this.uiService.searchModel.next(searchModel);
      this.collectionService.search(this.uiService.createSearch(searchModel), { preserve: true });
    }
  }

  // Stop events from bubbling up from the text entry.
  public stopPropagation(event: any): void {
    event.stopPropagation();
  }

  public search() {
    if (!this.searchText) {
      return;
    }
    const searchModel = this.uiService.createSearchModel();
    searchModel.keywords = this.searchText;
    this.uiService.searchModel.next(searchModel);
    this.collectionService.search(this.uiService.createSearch(searchModel));

    this.isExpanded = false;
  }

  public toggleTagsOpen(): void {
    this.tagsOpen = !this.tagsOpen;
    this.updateTagPanelState();
  }

  public updateTagPanelState() {
    this.uiService.setTagPanelState(this.tagsOpen);
  }

  public trackNavItem(_: number, navItem: NavItem): string {
    switch (navItem.type) {
      case 'button':
        return `button-${navItem.title}`;
      case 'paginator':
        // Only one.
        return 'paginator';
    }
  }
}
