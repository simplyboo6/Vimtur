import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable } from 'rxjs';
import { Playlist, PlaylistCreate, PlaylistUpdate, Media } from '@vimtur/common';
import { AlertService } from './alert.service';
import { UiService } from './ui.service';
import { MediaService } from './media.service';
import { ConfirmationService } from './confirmation.service';
import { Alert } from 'app/shared/types';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

@Injectable({
  providedIn: 'root',
})
export class PlaylistService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private uiService: UiService;
  private confirmationService: ConfirmationService;
  private mediaService: MediaService;
  private playlistsReplay = new ReplaySubject<Playlist[]>(1);
  private playlistReplay = new ReplaySubject<Playlist | undefined>(1);
  private media = new ReplaySubject<Media[] | undefined>(1);

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    uiService: UiService,
    confirmationService: ConfirmationService,
    mediaService: MediaService,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.uiService = uiService;
    this.confirmationService = confirmationService;
    this.mediaService = mediaService;

    this.updatePlaylists();
  }

  public getCurrentPlaylist(): Observable<Playlist | undefined> {
    return this.playlistReplay;
  }

  public getCurrentMedia(): Observable<Media[] | undefined> {
    return this.media;
  }

  public setPlaylist(playlistId?: string, collection?: string[]): void {
    if (!playlistId) {
      this.playlistReplay.next(undefined);
      this.media.next(undefined);
      return;
    }

    this.getPlaylist(playlistId).subscribe(
      playlist => {
        this.playlistReplay.next(playlist);
      },
      err => {
        console.warn('Failed to set playlist', err);
        this.alertService.show({
          type: 'warning',
          message: 'Failed to set playlist',
          autoClose: 5000,
        });
      },
    );

    if (collection) {
      this.mediaService.loadMedia(collection).subscribe(media => {
        this.media.next(media);
      });
    }
  }

  public getPlaylist(playlistId: string): Observable<Playlist> {
    return this.httpClient.get<Playlist>(`/api/playlists/${playlistId}`);
  }

  public getPlaylists(): Observable<Playlist[]> {
    return this.playlistsReplay;
  }

  public addPlaylist(request: PlaylistCreate) {
    this.httpClient.post<string[]>(`/api/playlists`, request, HTTP_OPTIONS).subscribe(
      res => {
        this.alertService.show({
          type: 'success',
          message: `Added playlist '${request.name}'`,
          autoClose: 3000,
        });
        this.updatePlaylists();
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message =
          (err && err.error && err.error.message) || `Failed to add playlist '${request.name}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  public updatePlaylist(playlistId: string, update: PlaylistUpdate): void {
    this.httpClient.patch<string[]>(`/api/playlists/${playlistId}`, update, HTTP_OPTIONS).subscribe(
      res => {
        this.alertService.show({
          type: 'success',
          message: `Updated playlist`,
          autoClose: 3000,
        });
        this.updatePlaylists();
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to update playest`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  public deletePlaylist(id: string) {
    this.httpClient.delete<string[]>(`/api/playlists/${id}`).subscribe(
      res => {
        this.alertService.show({ type: 'success', message: `Deleted playlist`, autoClose: 3000 });
        this.updatePlaylists();
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message =
          (err && err.error && err.error.message) || `Failed to delete playlist '${id}'`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  public addAllCurrentToPlaylist(playlist: Playlist): void {
    const subset = this.uiService.createSearch();

    this.confirmationService
      .confirm(`Are you sure you want to add all current search results to ${playlist.name}?`)
      .then(result => {
        if (result) {
          const alert: Alert = { type: 'info', message: `Adding all to ${playlist.name}...` };
          this.alertService.show(alert);
          console.log('addAllCurrentToPlaylist', subset, playlist);

          this.httpClient
            .put<string[]>(`/api/images/subset/playlists/${playlist.id}`, subset, HTTP_OPTIONS)
            .subscribe(
              res => {
                this.alertService.dismiss(alert);
                this.alertService.show({
                  type: 'success',
                  message: `Added current set to ${playlist.name}`,
                  autoClose: 3000,
                });
                this.updatePlaylists();
              },
              (err: HttpErrorResponse) => {
                console.error(err);
                this.alertService.dismiss(alert);
                const message =
                  (err && err.error && err.error.message) || `Failed to add all to playlist`;
                this.alertService.show({ type: 'warning', message, autoClose: 5000 });
              },
            );
        }
      })
      .catch(err => console.warn('Playlist add all confirmation error', err));
  }

  public removeMediaFromPlaylist(playlist: Playlist, media: Media): void {
    this.httpClient
      .delete<string[]>(`/api/images/${media.hash}/playlists/${playlist.id}`)
      .subscribe(
        res => {
          this.alertService.show({
            type: 'success',
            message: `Removed from playlist`,
            autoClose: 3000,
          });
          this.updatePlaylists();
        },
        (err: HttpErrorResponse) => {
          console.error(err);
          const message =
            (err && err.error && err.error.message) || `Failed to remove from playlist`;
          this.alertService.show({ type: 'warning', message, autoClose: 5000 });
        },
      );
  }

  private updatePlaylists(): void {
    this.httpClient.get<Playlist[]>(`/api/playlists`).subscribe(
      playlists => {
        this.playlistsReplay.next(playlists.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({ type: 'danger', message: 'Failed to fetch playlists' });
      },
    );
  }
}
