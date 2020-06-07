import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable } from 'rxjs';
import { Playlist, PlaylistCreate } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';

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
  private playlistsReplay: ReplaySubject<Playlist[]> = new ReplaySubject(1);

  public constructor(httpClient: HttpClient, alertService: AlertService) {
    this.httpClient = httpClient;
    this.alertService = alertService;

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
          type: 'info',
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

  public deletePlaylist(id: string) {
    this.httpClient.delete<string[]>(`/api/playlists/${id}`).subscribe(
      res => {
        this.alertService.show({ type: 'info', message: `Deleted playlist`, autoClose: 3000 });
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
}
