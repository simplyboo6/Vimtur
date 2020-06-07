import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable } from 'rxjs';
import { Playlist, PlaylistCreate, PlaylistUpdate } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { UiService } from 'app/services/ui.service';
import { ConfirmationService } from 'services/confirmation.service';
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
  private playlistsReplay: ReplaySubject<Playlist[]> = new ReplaySubject(1);

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    uiService: UiService,
    confirmationService: ConfirmationService,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.uiService = uiService;
    this.confirmationService = confirmationService;

    this.updatePlaylists();
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
}
