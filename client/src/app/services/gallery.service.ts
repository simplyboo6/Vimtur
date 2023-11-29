import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { Media } from '@vimtur/common';
import { MediaService } from './media.service';
import { ConfigService } from './config.service';
import { CollectionService, CollectionMetadata } from 'app/services/collection.service';

export interface Page {
  current: number;
  max: number;
}

@Injectable({
  providedIn: 'root',
})
export class GalleryService {
  public readonly page: ReplaySubject<Page> = new ReplaySubject(1);

  public readonly media: ReplaySubject<Media[] | undefined> = new ReplaySubject(1);

  private mediaService: MediaService;
  private configService: ConfigService;
  private pageNumber = 0;
  private pageCount = 0;
  private collection?: string[];
  private active = false;
  private updateRequired = false;

  public constructor(mediaService: MediaService, configService: ConfigService, collectionService: CollectionService) {
    this.mediaService = mediaService;
    this.configService = configService;

    collectionService.getMetadata().subscribe(metadata => {
      this.setMetadata(metadata);
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
        this.page.next({ current: this.pageNumber || 0, max: this.pageCount || 0 });

        const pageHashes = pageSize ? this.collection.slice(this.pageNumber * pageSize, (this.pageNumber + 1) * pageSize) : this.collection;

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

  private setMetadata(metadata?: CollectionMetadata): void {
    if (!this.configService.config) {
      console.warn('Cannot calculate pagination before config loaded');
      return;
    }
    const pageSize = this.configService.config.user.galleryImageCount;

    if (metadata && metadata.collection) {
      const pageNumber = Math.floor(pageSize ? metadata.index / pageSize : 0);
      const pageCount = Math.ceil(pageSize ? metadata.collection.length / pageSize : 1);

      this.updateRequired = this.updateRequired || this.pageNumber !== pageNumber || this.pageCount !== pageCount || this.collection !== metadata.collection;

      this.collection = metadata.collection;
      this.pageNumber = pageNumber;
      this.pageCount = pageCount;
    } else {
      this.collection = undefined;
      this.media.next(undefined);
    }

    this.update();
  }
}
