import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { Playlist } from '@vimtur/common';
import { PlaylistService } from 'app/services/playlist.service';
import { MediaService, LazyMedia } from 'app/services/media.service';
import { UiService } from 'app/services/ui.service';
import { CollectionService } from 'app/services/collection.service';
import { Subscription } from 'rxjs';
import { ListItem } from 'app/shared/types';
import { getTitle, getSubtitle } from 'app/shared/media-formatting';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

export const MAX_LOADED = 20;

interface MediaTitle {
  title: string;
  subtitle: string;
}

@Component({
  selector: 'app-playlist',
  templateUrl: './playlist.component.html',
  styleUrls: ['./playlist.component.scss'],
})
export class PlaylistComponent implements OnInit, OnDestroy {
  @Input() public playlist?: Playlist;
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getTitle;
  public actions?: ListItem<LazyMedia>[][];
  public titles?: Array<MediaTitle | undefined>;
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
      this.collectionService.getMetadata().subscribe(metadata => {
        // Ignore changes in order
        if (this.media) {
          if (metadata?.order) {
            return;
          }

          if (metadata?.removed) {
            for (const hash of metadata.removed) {
              const index = this.media.findIndex(lazyMedia => lazyMedia.hash === hash);
              if (index >= 0) {
                this.media.splice(index, 1);
                this.actions?.splice(index, 1);
                this.titles?.splice(index, 1);
              }
            }
          }
        }

        if (metadata && metadata?.collection) {
          if (this.media) {
            for (const lazyMedia of this.media) {
              if (lazyMedia.subscription) {
                lazyMedia.subscription.unsubscribe();
              }
            }
          }
          this.media = this.mediaService.lazyLoadMedia(metadata.collection);
          this.updateMediaActions();
          this.titles = this.media.map(() => undefined);
        }
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
      if (lazyMedia.media || lazyMedia.subscription) {
        return;
      }

      if (this.media) {
        const loaded = this.media.filter(media => media.loadedAt !== undefined);
        if (loaded.length > MAX_LOADED) {
          loaded.sort((a, b) => (a.loadedAt || 0) - (b.loadedAt || 0));

          for (let i = 0; i < loaded.length - MAX_LOADED; i++) {
            console.debug('unloading', loaded[i]);
            if (loaded[i].subscription) {
              loaded[i].subscription?.unsubscribe();
              loaded[i].subscription = undefined;
            }
            loaded[i].media = undefined;
            loaded[i].loadedAt = undefined;
          }
        }
      }

      lazyMedia.subscription = lazyMedia.getter().subscribe(media => {
        lazyMedia.media = media;
        lazyMedia.loadedAt = Date.now();
        const index = this.media?.findIndex(m => m === lazyMedia) || -1;
        if (index >= 0 && this.titles) {
          this.titles[index] = {
            title: getTitle(media),
            subtitle: getSubtitle(media),
          };
        }
      });
    }
  }

  public dragAndDrop(event: CdkDragDrop<Playlist>) {
    this.updateIndex(event.previousIndex, event.currentIndex);
  }

  private updateIndex(previousIndex: number, currentIndex: number): void {
    if (!this.media || !this.playlist) {
      return;
    }

    this.mediaService.updateOrderInPlaylist(
      this.media[previousIndex].hash,
      this.playlist.id,
      currentIndex,
    );

    this.updateMediaActions();

    moveItemInArray(this.media, previousIndex, currentIndex);
    if (this.actions) {
      moveItemInArray(this.actions, previousIndex, currentIndex);
    }
    if (this.titles) {
      moveItemInArray(this.titles, previousIndex, currentIndex);
    }

    if (!this.collectionService.isShuffled()) {
      this.collectionService.updateOrder(previousIndex, currentIndex);
    }
  }

  public unsetPlaylist(): void {
    this.uiService.searchModel.playlist = undefined;
    this.collectionService.search(this.uiService.createSearch(), { noRedirect: true });
  }

  public updateMediaActions(): void {
    this.actions = undefined;
    if (!this.media) {
      return;
    }

    this.actions = [];
    for (let i = 0; i < this.media.length; i++) {
      const media = this.media[i];
      const order = i;
      this.actions.push([
        { itemName: 'Remove From Playlist', id: media },
        { itemName: 'Set As Thumbnail', id: media },
        ...(order > 0 ? [{ itemName: 'Move Up', id: media }] : []),
        ...(order < this.media.length - 1 ? [{ itemName: 'Move Down', id: media }] : []),
      ]);
    }
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
          this.actions?.splice(index, 1);
          this.titles?.splice(index, 1);
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
      case 'Set As Thumbnail': {
        this.playlistService.updatePlaylist(this.playlist.id, { thumbnail: action.id.hash });
        break;
      }
      default:
        break;
    }
  }
}
