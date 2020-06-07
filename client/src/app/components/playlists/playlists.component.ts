import { Component, OnInit, OnDestroy } from '@angular/core';
import { ConfirmationService } from 'services/confirmation.service';
import { Playlist } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { PlaylistService } from 'app/services/playlist.service';
import { Subscription, Observable } from 'rxjs';
import { ListItem } from 'app/shared/types';

@Component({
  selector: 'app-playlists',
  templateUrl: './playlists.component.html',
  styleUrls: ['./playlists.component.scss'],
})
export class PlaylistsComponent implements OnInit, OnDestroy {
  private confirmationService: ConfirmationService;
  private alertService: AlertService;
  private playlistService: PlaylistService;

  private subscriptions: Subscription[] = [];

  public playlists?: Playlist[];

  public addPlaylistModel?: string;

  public constructor(
    confirmationService: ConfirmationService,
    alertService: AlertService,
    playlistService: PlaylistService,
  ) {
    this.confirmationService = confirmationService;
    this.alertService = alertService;
    this.playlistService = playlistService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.playlistService.getPlaylists().subscribe(playlists => {
        this.playlists = playlists;
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
