import { Component, OnInit, HostListener } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CollectionService } from 'services/collection.service';
import { ConfigService } from 'services/config.service';
import { GalleryService } from 'services/gallery.service';
import { UiService } from 'services/ui.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  protected readonly collectionService: CollectionService;
  private route: ActivatedRoute;
  private galleryService: GalleryService;
  private configService: ConfigService;
  private uiService: UiService;

  public constructor(
    collectionService: CollectionService,
    galleryService: GalleryService,
    configService: ConfigService,
    uiService: UiService,
    route: ActivatedRoute,
  ) {
    this.collectionService = collectionService;
    this.galleryService = galleryService;
    this.configService = configService;
    this.uiService = uiService;
    this.route = route;
  }

  public ngOnInit() {
    this.configService.getConfiguration().subscribe(config => {
      const options = config.user.initialLoadLimit && config.user.initialLoadLimit > 0 ? { sample: config.user.initialLoadLimit } : {};
      this.collectionService.search(options, { shuffle: true, init: true });
    });
  }

  @HostListener('window:keyup', ['$event'])
  public keyEvent(event: KeyboardEvent) {
    switch (this.getRoute()) {
      case '/viewer': // Fallthrough
      case '/metadata': // Fallthrough
      case '/clone-resolver': {
        switch (event.code) {
          case 'ArrowLeft':
            if (event.ctrlKey) {
              this.uiService.offsetDirectory(-1);
            } else {
              this.collectionService.offset(-1);
            }
            break;
          case 'ArrowRight':
            if (event.ctrlKey) {
              this.uiService.offsetDirectory(1);
            } else {
              this.collectionService.offset(1);
            }
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
