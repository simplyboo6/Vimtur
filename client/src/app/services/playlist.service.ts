import { HttpClient, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ReplaySubject, Observable } from 'rxjs';
import {
  Playlist,
  PlaylistCreate,
  PlaylistUpdate,
  Media,
  SubsetConstraints,
  MediaPlaylist,
} from '@vimtur/common';
import { AlertService } from './alert.service';
import { UiService } from './ui.service';
import { MediaService, LazyMedia } from './media.service';
import { ConfirmationService } from './confirmation.service';
import { CollectionService } from './collection.service';
import { Alert } from 'app/shared/types';

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};
const PLAYLIST_WARNING_SIZE = 500;

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
  private collectionSize?: number;
  private collectionService: CollectionService;
  private playlistId?: string;

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    uiService: UiService,
    confirmationService: ConfirmationService,
    mediaService: MediaService,
    collectionService: CollectionService,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.uiService = uiService;
    this.confirmationService = confirmationService;
    this.mediaService = mediaService;
    this.collectionService = collectionService;

    collectionService.getMetadata().subscribe(metadata => {
      // Ignore changes in order
      if (metadata.order) {
        return;
      }

      this.collectionSize = undefined;
      if (metadata) {
        this.collectionSize = metadata.collection && metadata.collection.length;
        if (metadata.constraints) {
          this.setPlaylist(metadata.constraints.playlist);
        }
      }
    });

    this.updatePlaylists();
  }

  public getCurrentPlaylist(): Observable<Playlist | undefined> {
    return this.playlistReplay;
  }

  public getPlaylist(playlistId: string): Observable<Playlist> {
    return this.httpClient.get<Playlist>(`/api/playlists/${playlistId}`);
  }

  public getPlaylists(): Observable<Playlist[]> {
    return this.playlistsReplay;
  }

  public addPlaylist(request: PlaylistCreate) {
    const media = this.mediaService.media;

    this.httpClient.post<Playlist>(`/api/playlists`, request, HTTP_OPTIONS).subscribe(
      res => {
        this.alertService.show({
          type: 'success',
          message: `Added playlist '${request.name}'`,
          autoClose: 3000,
        });

        if (request.hashes) {
          for (let i = 0; i < request.hashes.length; i++) {
            this.mediaService.addPlaylist(request.hashes[i], {
              id: res.id,
              order: i,
            });
          }
        }

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
        console.debug('playlist deleted', id);

        if (this.mediaService.media) {
          this.mediaService.removePlaylist(this.mediaService.media.hash, id);
        }

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

  public addAllCurrentToPlaylist(playlist: Playlist, constraints?: SubsetConstraints): void {
    const subset = constraints || this.uiService.createSearch();

    let prompt = `Are you sure you want to add ${
      this.collectionSize === undefined ? 'all' : this.collectionSize
    } current search results to ${playlist.name}?`;
    if (this.collectionSize !== undefined && this.collectionSize > PLAYLIST_WARNING_SIZE) {
      prompt = `${prompt} Playlists longer than ${PLAYLIST_WARNING_SIZE} may be difficult to manage and not perform well.`;
    }

    const media = this.mediaService.media;

    this.confirmationService
      .confirm(prompt)
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
                if (media) {
                  this.mediaService.addPlaylist(media.hash, { id: playlist.id, order: NaN });
                }
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

  public removeMediaFromPlaylist(playlistId: string, hash: string): void {
    this.httpClient.delete<string[]>(`/api/images/${hash}/playlists/${playlistId}`).subscribe(
      res => {
        console.debug('media removed from playlist', playlistId, hash);
        this.mediaService.removePlaylist(hash, playlistId);
        this.updatePlaylists();
        if (playlistId === this.playlistId) {
          this.collectionService.removeFromSet([hash]);
        }
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to remove from playlist`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  public addMediaToPlaylist(playlistId: string, hash: string): void {
    this.httpClient.put<MediaPlaylist>(`/api/images/${hash}/playlists/${playlistId}`, {}).subscribe(
      res => {
        console.debug('media added to playlist', playlistId, hash);
        this.mediaService.addPlaylist(hash, res);
        this.updatePlaylists();
      },
      (err: HttpErrorResponse) => {
        console.error(err);
        const message = (err && err.error && err.error.message) || `Failed to add to playlist`;
        this.alertService.show({ type: 'warning', message, autoClose: 5000 });
      },
    );
  }

  private setPlaylist(playlistId?: string): void {
    if (!playlistId) {
      this.playlistReplay.next(undefined);
      return;
    }
    this.playlistId = playlistId;

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
