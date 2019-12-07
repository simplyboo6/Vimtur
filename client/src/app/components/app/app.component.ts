import { Component, OnInit, HostListener } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CollectionService } from 'services/collection.service';
import { UiService } from 'services/ui.service';
import { ConfigService } from 'services/config.service';
import { GalleryService } from 'services/gallery.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  private collectionService: CollectionService;
  private uiService: UiService;
  private route: ActivatedRoute;
  private galleryService: GalleryService;
  private configService: ConfigService;

  public constructor(
    collectionService: CollectionService,
    uiService: UiService,
    galleryService: GalleryService,
    configService: ConfigService,
    route: ActivatedRoute,
  ) {
    this.collectionService = collectionService;
    this.uiService = uiService;
    this.galleryService = galleryService;
    this.configService = configService;
    this.route = route;
  }

  public ngOnInit() {
    this.configService.getConfiguration().subscribe(config => {
      const options =
        config.user.initialLoadLimit && config.user.initialLoadLimit > 0
          ? { limit: config.user.initialLoadLimit }
          : {};
      this.collectionService.search({ ...options, type: 'video' }, { shuffle: true, init: true });
    });
  }

  // TODO Make these contextual. So on the gallery it switches pages and delete does nothing.
  @HostListener('window:keyup', ['$event'])
  public keyEvent(event: KeyboardEvent) {
    switch (this.getRoute()) {
      case '/viewer': // Fallthrough
      case '/metadata': {
        switch (event.code) {
          case 'ArrowLeft':
            this.collectionService.offset(-1);
            break;
          case 'ArrowRight':
            this.collectionService.offset(1);
            break;
          case 'Delete':
            this.collectionService.deleteCurrent();
            break;
          default:
            break;
        }
        break;
      }
      case '/gallery': {
        switch (event.code) {
          case 'ArrowLeft':
            this.galleryService.offset(-1);
            break;
          case 'ArrowRight':
            this.galleryService.offset(1);
            break;
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
  }

  public getRoute(): string {
    return (this.route.snapshot as any)._routerState.url as string;
  }
}
