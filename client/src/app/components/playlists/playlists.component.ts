import { Component, OnInit, OnDestroy } from '@angular/core';
import { ConfirmationService } from 'services/confirmation.service';
import { Playlist, Media } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { PlaylistService } from 'app/services/playlist.service';
import { MediaService } from 'app/services/media.service';
import { Subscription, Observable } from 'rxjs';
import { ListItem } from 'app/shared/types';

export interface PreviewPlaylist extends Playlist {
  media?: Media;
}

@Component({
  selector: 'app-playlists',
  templateUrl: './playlists.component.html',
  styleUrls: ['./playlists.component.scss'],
})
export class PlaylistsComponent implements OnInit, OnDestroy {
  private confirmationService: ConfirmationService;
  private alertService: AlertService;
  private playlistService: PlaylistService;
  private mediaService: MediaService;

  private subscriptions: Subscription[] = [];

  public playlists?: PreviewPlaylist[];

  public addPlaylistModel?: string;

  public constructor(
    confirmationService: ConfirmationService,
    alertService: AlertService,
    playlistService: PlaylistService,
    mediaService: MediaService,
  ) {
    this.confirmationService = confirmationService;
    this.alertService = alertService;
    this.playlistService = playlistService;
    this.mediaService = mediaService;
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
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
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
