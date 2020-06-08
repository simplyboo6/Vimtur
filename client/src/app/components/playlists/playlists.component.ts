import { Component, OnInit, OnDestroy, AfterViewChecked, NgZone } from '@angular/core';
import { ConfirmationService } from 'services/confirmation.service';
import { Playlist, Media } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { PlaylistService } from 'app/services/playlist.service';
import { MediaService } from 'app/services/media.service';
import { UiService } from 'app/services/ui.service';
import { CollectionService } from 'app/services/collection.service';
import { Subscription, Observable } from 'rxjs';
import { ListItem } from 'app/shared/types';
import { getTitle, getSubtitle } from 'app/shared/media-formatting';

export interface PreviewPlaylist extends Playlist {
  media?: Media;
}

export interface MediaVisibility extends Media {
  visible?: boolean;
}

@Component({
  selector: 'app-playlists',
  templateUrl: './playlists.component.html',
  styleUrls: ['./playlists.component.scss'],
})
export class PlaylistsComponent implements OnInit, OnDestroy, AfterViewChecked {
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getTitle;
  public playlists?: PreviewPlaylist[];
  public currentPlaylist?: PreviewPlaylist;
  public currentMedia?: MediaVisibility[];
  public addPlaylistModel?: string;

  private confirmationService: ConfirmationService;
  private alertService: AlertService;
  private mediaService: MediaService;
  private uiService: UiService;
  private collectionService: CollectionService;
  private playlistService: PlaylistService;
  private zone: NgZone;
  private subscriptions: Subscription[] = [];
  private intersectionObserver: IntersectionObserver;
  private observerSetupRequired = true;

  public constructor(
    confirmationService: ConfirmationService,
    alertService: AlertService,
    playlistService: PlaylistService,
    mediaService: MediaService,
    uiService: UiService,
    collectionService: CollectionService,
    zone: NgZone,
  ) {
    this.confirmationService = confirmationService;
    this.alertService = alertService;
    this.playlistService = playlistService;
    this.mediaService = mediaService;
    this.uiService = uiService;
    this.collectionService = collectionService;
    this.zone = zone;

    const options = {
      rootMargin: '0px',
      threshold: 1.0,
    };

    this.intersectionObserver = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => this.updateVisibility(entries),
      options,
    );
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.playlistService.getPlaylists().subscribe(playlists => {
        this.playlists = playlists.map(playlist => {
          const augmented: PreviewPlaylist = { ...playlist };
          if (!augmented.thumbnail) {
            return augmented;
          }

          this.mediaService.getMedia(augmented.thumbnail).subscribe(
            media => {
              augmented.media = media;
            },
            err => {
              console.warn('Failed to load media for thumbnail', augmented.thumbnail, err);
            },
          );

          return augmented;
        });
        this.addPlaylistModel = undefined;
      }),
    );

    // Can't error. Never emitted.
    this.subscriptions.push(
      this.playlistService.getCurrentPlaylist().subscribe(playlist => {
        this.currentPlaylist = playlist;
      }),
    );

    this.subscriptions.push(
      this.playlistService.getCurrentMedia().subscribe(media => {
        this.intersectionObserver.disconnect();
        this.observerSetupRequired = true;
        this.currentMedia = media;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    this.intersectionObserver.disconnect();
  }

  public ngAfterViewChecked(): void {
    if (!this.observerSetupRequired || !this.currentMedia) {
      return;
    }

    for (const media of this.currentMedia) {
      const element = document.getElementById(`media-${media.hash}`);
      if (!element) {
        break;
      }
      (element as any).media = media;

      this.intersectionObserver.observe(element);
      this.observerSetupRequired = false;
    }
  }

  private updateVisibility(entries: IntersectionObserverEntry[]): void {
    this.zone.run(() => {
      if (!this.currentMedia) {
        return;
      }

      for (const entry of entries) {
        const media: MediaVisibility = (entry.target as any).media;
        if (!media) {
          continue;
        }

        media.visible = entry.isIntersecting;
      }
    });
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

  public setPlaylist(playlist: Playlist): void {
    if (playlist.size === 0) {
      return;
    }

    this.uiService.resetSearch();
    this.uiService.searchModel.playlist = playlist.id;

    this.collectionService.search(this.uiService.createSearch(), { noRedirect: true });
  }

  public getMediaActions(playlist: Playlist, media: Media): ListItem<Media>[] {
    const order = this.getOrder(playlist, media);
    return [
      { itemName: 'Remove From Playlist', id: media },
      ...(order > 0 ? [{ itemName: 'Move Up', id: media }] : []),
      ...(order < playlist.size - 1 ? [{ itemName: 'Move Down', id: media }] : []),
    ];
  }

  public onMediaAction(action: ListItem<Media>): void {
    if (!this.currentPlaylist) {
      return;
    }

    switch (action.itemName) {
      case 'Remove From Playlist':
        this.playlistService.removeMediaFromPlaylist(this.currentPlaylist, action.id);
        break;
      default:
        break;
    }
  }

  public getActions(playlist: Playlist): ListItem<Playlist>[] {
    return [
      { itemName: 'Add Media', id: playlist },
      { itemName: 'Delete', id: playlist },
    ];
  }

  public onAction(action: ListItem<Playlist>): void {
    switch (action.itemName) {
      case 'Add Media':
        this.playlistService.addAllCurrentToPlaylist(action.id);
        break;
      case 'Delete':
        this.deletePlaylist(action.id);
        break;
      default:
        break;
    }
  }

  public addPlaylist() {
    console.debug('addPlaylist', this.addPlaylistModel);
    this.playlistService.addPlaylist({ name: this.addPlaylistModel });
  }

  public deletePlaylist(playlist: Playlist) {
    this.confirmationService
      .confirm(`Are you sure you want to delete '${playlist.name}'?`)
      .then(result => {
        if (result) {
          console.log('deletePlaylist', playlist);
          this.playlistService.deletePlaylist(playlist.id);
        }
      })
      .catch(err => console.warn('Playlist deletion confirmation error', err));
  }
}
