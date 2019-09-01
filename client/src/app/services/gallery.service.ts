import { Injectable, EventEmitter } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { Media } from '@vimtur/common';
import { MediaService } from './media.service';
import { CollectionService } from './collection.service';

const PAGE_SIZE = 15;

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
  private pageNumber: number;
  private pageCount: number;
  private collection?: string[];
  private active = false;
  private updateRequired = false;

  public constructor(mediaService: MediaService, collectionService: CollectionService) {
    this.mediaService = mediaService;
    this.collectionService = collectionService;

    this.pageNumber = 0;
    this.pageCount = 0;

    this.collectionService.getMetadata().subscribe(metadata => {
      if (metadata.collection) {
        const pageNumber = Math.floor(metadata.index / PAGE_SIZE);
        const pageCount = Math.ceil(metadata.collection.length / PAGE_SIZE);

        this.updateRequired =
          this.updateRequired ||
          (this.pageNumber !== pageNumber ||
            this.pageCount !== pageCount ||
            this.collection !== metadata.collection);

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
    if (this.active && this.updateRequired) {
      this.media.next(undefined);

      if (this.collection) {
        this.page.emit({ current: this.pageNumber || 0, max: this.pageCount || 0 });

        const pageHashes = this.collection.slice(
          this.pageNumber * PAGE_SIZE,
          (this.pageNumber + 1) * PAGE_SIZE,
        );

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
        this.pageNumber = this.collection.length - 1;
      } else if (this.pageNumber >= this.collection.length) {
        this.pageNumber = 0;
      }
    } else {
      this.pageNumber = 0;
    }
    this.updateRequired = true;
    this.update();
  }
}
