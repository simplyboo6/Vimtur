import { Component, OnInit, OnDestroy } from '@angular/core';
import { GalleryService } from 'services/gallery.service';
import { CollectionService } from 'services/collection.service';
import { Media } from '@vimtur/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.scss'],
})
export class GalleryComponent implements OnInit, OnDestroy {
  public media?: Media[] = [];
  public collectionService: CollectionService;

  private subscriptions: Subscription[] = [];
  private galleryService: GalleryService;

  public constructor(galleryService: GalleryService, collectionService: CollectionService) {
    this.galleryService = galleryService;
    this.collectionService = collectionService;
  }

  public ngOnInit() {
    this.media = undefined;

    this.subscriptions.push(
      this.galleryService.media.subscribe(media => {
        this.media = media;
      }),
    );
    this.galleryService.start();
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    this.galleryService.end();
    this.media = undefined;
  }

  private padTime(length: number): string {
    return length < 10 ? `0${length}` : `${length}`;
  }

  private formatLength(length: number): string {
    const hours = Math.floor(length / 3600);
    length -= hours * 3600;
    const minutes = Math.floor(length / 60);
    length -= minutes * 60;
    const seconds = Math.floor(length);
    return `${this.padTime(hours)}:${this.padTime(minutes)}:${this.padTime(seconds)}`;
  }

  public getTitle(media: Media): string {
    const titles: string[] = [];
    if (media.metadata.album) {
      titles.push(media.metadata.album);
    }
    if (media.metadata.title) {
      titles.push(media.metadata.title);
    }
    const title = titles.join(' - ');
    return title || media.path.split('/').slice(-1)[0];
  }

  public getSubtitle(media: Media): string {
    switch (media.type) {
      case 'video':
        return `Video | ${this.formatLength(media.metadata.length)} | ${media.metadata.width}x${
          media.metadata.height
        }`;
      case 'still':
        return `Still | ${media.metadata.width}x${media.metadata.height}`;
      case 'gif':
        return `Gif | ${media.metadata.width}x${media.metadata.height}`;
      default:
        return '';
    }
  }
}
