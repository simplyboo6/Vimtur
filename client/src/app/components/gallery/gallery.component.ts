import { Component, OnInit, OnDestroy } from '@angular/core';
import { GalleryService } from 'services/gallery.service';
import { CollectionService } from 'services/collection.service';
import { Media } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { getTitle, getSubtitle } from 'app/shared/media-formatting';

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.scss'],
})
export class GalleryComponent implements OnInit, OnDestroy {
  public media?: Media[] = [];
  public collectionService: CollectionService;
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getSubtitle;

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

  public trackByHash(_: number, media: Media): string {
    return media.hash;
  }
}
