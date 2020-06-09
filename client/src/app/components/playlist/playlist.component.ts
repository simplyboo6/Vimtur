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
    if (!this.media) {
      return;
    }

    // TODO Update playlist order entry in media

    moveItemInArray(this.media, previousIndex, currentIndex);

    if (!this.collectionService.isShuffled()) {
      this.collectionService.updateOrder(previousIndex, currentIndex);
      // TODO Update order backend
    }
  }

  public getOrder(playlist: Playlist, media: Media): number {
    if (!media.playlists) {
      return NaN;
    }

    const mediaPlaylist = media.playlists.find(p => p.id === playlist.id);
    if (!mediaPlaylist) {
      return NaN;
    }

    return mediaPlaylist.order;
  }

  public unsetPlaylist(): void {
    this.uiService.searchModel.playlist = undefined;
    this.collectionService.search(this.uiService.createSearch(), { noRedirect: true });
  }

  public getMediaActions(playlist: Playlist, media?: Media): ListItem<Media>[] | undefined {
    if (!media) {
      return undefined;
    }

    const order = this.getOrder(playlist, media);
    return [
      { itemName: 'Remove From Playlist', id: media },
      ...(order > 0 ? [{ itemName: 'Move Up', id: media }] : []),
      ...(order < playlist.size - 1 ? [{ itemName: 'Move Down', id: media }] : []),
    ];
  }

  public onMediaAction(action: ListItem<Media>): void {
    if (!this.playlist || !this.media) {
      return;
    }

    switch (action.itemName) {
      case 'Remove From Playlist':
        /*this.playlistService.removeMediaFromPlaylist(this.currentPlaylist, action.id);
        if (this.currentMedia && this.currentPlaylist) {
          this.currentPlaylist.size = this.currentPlaylist.size - 1;

          const index = this.currentMedia.findIndex(m => m.hash === action.id.hash);
          if (index >= 0) {
            this.currentMedia.splice(index, 1);
            for (let i = index; i < this.currentMedia.length; i++) {
              const lists = this.currentMedia[i].playlists;
              if (!lists) {
                continue;
              }
              const list = lists.find(l => l.id === this.currentPlaylist.id);
              if (list) {
                list.order = list.order - 1;
              }
            }
          }
          this.collectionService.removeFromSet([ action.id.hash ]);
        }*/
        break;
      // TODO Move up and down
      default:
        break;
    }
  }
}
