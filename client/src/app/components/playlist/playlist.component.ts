import { Component, OnInit, OnDestroy, NgZone, Input } from '@angular/core';
import { ConfirmationService } from 'services/confirmation.service';
import { Playlist, Media } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { PlaylistService } from 'app/services/playlist.service';
import { MediaService, LazyMedia } from 'app/services/media.service';
import { UiService } from 'app/services/ui.service';
import { CollectionService } from 'app/services/collection.service';
import { Subscription, Observable } from 'rxjs';
import { ListItem } from 'app/shared/types';
import { getTitle, getSubtitle } from 'app/shared/media-formatting';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

export const MAX_LOADED = 20;

@Component({
  selector: 'app-playlist',
  templateUrl: './playlist.component.html',
  styleUrls: ['./playlist.component.scss'],
})
export class PlaylistComponent implements OnInit, OnDestroy {
  @Input() public playlist?: Playlist;
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getTitle;

  public media?: LazyMedia[];

  private mediaService: MediaService;
  private collectionService: CollectionService;
  private playlistService: PlaylistService;
  private uiService: UiService;
  private subscriptions: Subscription[] = [];

  public constructor(
    playlistService: PlaylistService,
    mediaService: MediaService,
    collectionService: CollectionService,
    uiService: UiService,
  ) {
    this.playlistService = playlistService;
    this.mediaService = mediaService;
    this.collectionService = collectionService;
    this.uiService = uiService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.playlistService.getCurrentMedia().subscribe(media => {
        if (this.media) {
          // TODO This may slowly increase in cache size when navigating back
          // and forth between pages. Expect this to be negligible. Investigate.
          if (media === this.media) {
            return;
          }
          for (const lazyMedia of this.media) {
            if (lazyMedia.subscription) {
              lazyMedia.subscription.unsubscribe();
            }
          }
        }

        this.media = media;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public updateVisibility(lazyMedia: LazyMedia, visible: boolean): void {
    if (visible) {
      if (this.media) {
        const loaded = this.media.filter(media => media.loadedAt !== undefined);
        if (loaded.length > MAX_LOADED) {
          loaded.sort((a, b) => a.loadedAt - b.loadedAt);
          console.log(loaded);

          for (let i = 0; i < loaded.length - MAX_LOADED; i++) {
            if (loaded[i].subscription) {
              loaded[i].subscription.unsubscribe();
              loaded[i].subscription = undefined;
            }
            loaded[i].media = undefined;
            loaded[i].loadedAt = undefined;
          }
        }
      }

      if (lazyMedia.media || lazyMedia.subscription) {
        return;
      }

      lazyMedia.subscription = lazyMedia
        .getter()
        .subscribe(media => ((lazyMedia.media = media), (lazyMedia.loadedAt = Date.now())));
    }
  }

  public dragAndDrop(event: CdkDragDrop<Playlist>) {
    this.updateIndex(event.previousIndex, event.currentIndex);
  }

  private updateIndex(previousIndex: number, currentIndex: number): void {
    if (!this.media || !this.playlist) {
      return;
    }

    // TODO Update playlist order entry in media
    this.mediaService.updateOrderInPlaylist(
      this.media[previousIndex].hash,
      this.playlist.id,
      currentIndex,
    );

    moveItemInArray(this.media, previousIndex, currentIndex);

    if (!this.collectionService.isShuffled()) {
      this.collectionService.updateOrder(previousIndex, currentIndex);
    }
  }

  public getOrder(media: LazyMedia): number {
    if (!this.media) {
      return;
    }

    return this.media.indexOf(media);
  }

  public unsetPlaylist(): void {
    this.uiService.searchModel.playlist = undefined;
    this.collectionService.search(this.uiService.createSearch(), { noRedirect: true });
  }

  public getMediaActions(media: LazyMedia): ListItem<LazyMedia>[] | undefined {
    if (!this.media) {
      return undefined;
    }

    const order = this.getOrder(media);
    return [
      { itemName: 'Remove From Playlist', id: media },
      ...(order > 0 ? [{ itemName: 'Move Up', id: media }] : []),
      ...(order < this.media.length - 1 ? [{ itemName: 'Move Down', id: media }] : []),
    ];
  }

  public onMediaAction(action: ListItem<LazyMedia>): void {
    if (!this.playlist || !this.media) {
      return;
    }

    switch (action.itemName) {
      case 'Remove From Playlist':
        this.playlistService.removeMediaFromPlaylist(this.playlist.id, action.id.hash);
        const index = this.media.indexOf(action.id);
        if (index >= 0) {
          this.media.splice(index, 1);
          this.collectionService.removeFromSet([action.id.hash]);
        }
        break;
      case 'Move Up': {
        const current = this.media.indexOf(action.id);
        if (current > 0) {
          this.updateIndex(current, current - 1);
        }
        break;
      }
      case 'Move Down': {
        const current = this.media.indexOf(action.id);
        if (current < this.media.length - 1) {
          this.updateIndex(current, current + 1);
        }
        break;
      }
      default:
        break;
    }
  }
}
