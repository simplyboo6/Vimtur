import { Component, OnInit, OnDestroy } from '@angular/core';
import { Media } from '@vimtur/common';
import { UiService } from 'services/ui.service';
import { GalleryService, Page } from 'services/gallery.service';
import { CollectionService } from 'services/collection.service';
import { MediaService } from 'services/media.service';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  public tagsOpen = false;
  public collectionService: CollectionService;
  public searchText?: string;
  public isExpanded = false;
  public page: Page = { current: 0, max: 0 };

  private route: ActivatedRoute;
  private uiService: UiService;
  private mediaService: MediaService;
  private galleryService: GalleryService;
  private subscriptions: Subscription[] = [];

  public constructor(
    collectionService: CollectionService,
    uiService: UiService,
    route: ActivatedRoute,
    mediaService: MediaService,
    galleryService: GalleryService,
  ) {
    this.uiService = uiService;
    this.collectionService = collectionService;
    this.mediaService = mediaService;
    this.route = route;
    this.galleryService = galleryService;
  }

  public ngOnInit() {
    this.updateTagPanelState();

    this.subscriptions.push(this.galleryService.page.subscribe(page => (this.page = page)));
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public viewFolder() {
    if (this.mediaService.media) {
      this.uiService.resetSearch();
      this.uiService.searchModel.dir = this.mediaService.media.dir;
      this.uiService.searchModel.sortBy = 'path';
      this.collectionService.search(this.uiService.createSearch(), { preserve: true });
    }
  }

  public search() {
    if (!this.searchText) {
      return;
    }
    this.uiService.resetSearch();
    this.uiService.searchModel.keywords = this.searchText;
    this.collectionService.search(this.uiService.createSearch());

    this.isExpanded = false;
  }

  public isActive(route: string) {
    return this.getRoute().startsWith(route);
  }

  public getRoute(): string {
    return (this.route.snapshot as any)._routerState.url as string;
  }

  public updateTagPanelState() {
    this.uiService.setTagPanelState(this.tagsOpen);
  }

  public previous() {
    switch (this.getRoute()) {
      case '/viewer': // Fallthrough
      case '/metadata': // Fallthough
      case '/clone-resolver':
        this.collectionService.offset(-1);
        break;
      case '/gallery':
        this.galleryService.offset(-1);
        break;
      default:
        break;
    }
  }

  public next() {
    switch (this.getRoute()) {
      case '/viewer': // Fallthrough
      case '/metadata': // Fallthough
      case '/clone-resolver':
        this.collectionService.offset(1);
        break;
      case '/gallery':
        this.galleryService.offset(1);
        break;
      default:
        break;
    }
  }
}
