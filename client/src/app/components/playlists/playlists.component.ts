import { Component, OnInit, OnDestroy } from '@angular/core';
import { ConfirmationService } from 'services/confirmation.service';
import { Playlist, Media } from '@vimtur/common';
import { PlaylistService } from 'app/services/playlist.service';
import { MediaService } from 'app/services/media.service';
import { UiService } from 'app/services/ui.service';
import { CollectionService } from 'app/services/collection.service';
import { Subscription } from 'rxjs';
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
export class PlaylistsComponent implements OnInit, OnDestroy {
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getSubtitle;
  public playlists?: PreviewPlaylist[];
  public currentPlaylist?: PreviewPlaylist;
  public addPlaylistModel?: string;
  public uiService: UiService;
  public searchPlaylist?: string;

  private confirmationService: ConfirmationService;
  private mediaService: MediaService;
  private collectionService: CollectionService;
  private playlistService: PlaylistService;
  private subscriptions: Subscription[] = [];

  public constructor(
    confirmationService: ConfirmationService,
    playlistService: PlaylistService,
    mediaService: MediaService,
    uiService: UiService,
    collectionService: CollectionService,
  ) {
    this.confirmationService = confirmationService;
    this.playlistService = playlistService;
    this.mediaService = mediaService;
    this.uiService = uiService;
    this.collectionService = collectionService;
    this.searchPlaylist = this.uiService.searchModel.value.playlist;
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
      this.uiService.searchModel.subscribe(searchModel => {
        this.searchPlaylist = searchModel.playlist;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public setPlaylist(playlist: Playlist): void {
    if (playlist.size === 0) {
      return;
    }

    this.uiService.resetSearch();
    const searchModel = this.uiService.createSearchModel();
    searchModel.playlist = playlist.id;

    this.uiService.searchModel.next(searchModel);
    this.collectionService.search(this.uiService.createSearch(searchModel), { noRedirect: true });
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
    if (!this.addPlaylistModel) {
      return;
    }
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
