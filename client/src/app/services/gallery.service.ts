import { Injectable, EventEmitter } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { Media } from '@vimtur/common';
import { MediaService } from './media.service';
import { CollectionService } from './collection.service';
import { ConfigService } from './config.service';

export interface Page {
  current: number;
  max: number;
}

@Injectable({
  providedIn: 'root',
})
export class GalleryService {
  public readonly page: EventEmitter<Page> = new EventEmitter();

  public readonly media: ReplaySubject<Media[] | undefined> = new ReplaySubject(1);

  private mediaService: MediaService;
  private collectionService: CollectionService;
  private configService: ConfigService;
  private pageNumber: number;
  private pageCount: number;
  private collection?: string[];
  private active = false;
  private updateRequired = false;

  public constructor(
    mediaService: MediaService,
    collectionService: CollectionService,
    configService: ConfigService,
  ) {
    this.mediaService = mediaService;
    this.collectionService = collectionService;
    this.configService = configService;

    this.pageNumber = 0;
    this.pageCount = 0;

    this.collectionService.getMetadata().subscribe(metadata => {
      if (!this.configService.config) {
        console.warn('Cannot calculate pagination before config loaded');
        return;
      }
      const pageSize = this.configService.config.user.galleryImageCount;

      if (metadata.collection) {
        const pageNumber = Math.floor(pageSize ? metadata.index / pageSize : 0);
        const pageCount = Math.ceil(pageSize ? metadata.collection.length / pageSize : 1);

        this.updateRequired =
          this.updateRequired ||
          this.pageNumber !== pageNumber ||
          this.pageCount !== pageCount ||
          this.collection !== metadata.collection;

        this.collection = metadata.collection;
        this.pageNumber = pageNumber;
        this.pageCount = pageCount;
      } else {
        this.collection = undefined;
        this.media.next(undefined);
      }

      this.update();
    });
  }

  public start() {
    this.active = true;
    this.update();
  }

  public end() {
    this.active = false;
  }

  public update() {
    if (!this.configService.config) {
      console.warn('Cannot update gallery without configuration loaded');
      return;
    }
    const pageSize = this.configService.config.user.galleryImageCount;

    if (this.active && this.updateRequired) {
      this.media.next(undefined);

      if (this.collection) {
        this.page.emit({ current: this.pageNumber || 0, max: this.pageCount || 0 });

        const pageHashes = pageSize
          ? this.collection.slice(this.pageNumber * pageSize, (this.pageNumber + 1) * pageSize)
          : this.collection;

        this.mediaService.loadMedia(pageHashes).subscribe(pageMedia => {
          this.media.next(pageMedia);
        });
        this.updateRequired = false;
      }
    }
  }

  public offset(offset: number) {
    if (this.collection) {
      this.pageNumber += offset;
      if (this.pageNumber < 0) {
        this.pageNumber = this.pageCount - 1;
      } else if (this.pageNumber >= this.pageCount) {
        this.pageNumber = 0;
      }
    } else {
      this.pageNumber = 0;
    }
    this.updateRequired = true;
    this.update();
  }
}
