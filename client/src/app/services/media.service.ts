import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, Subscription, forkJoin } from 'rxjs';
import { take, map } from 'rxjs/operators';
import { Media, UpdateMetadata, UpdateMedia, SubsetConstraints, MediaResolution, MediaPlaylist } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { TagService } from 'app/services/tag.service';
import { ActorService } from 'app/services/actor.service';
import { CollectionService } from 'app/services/collection.service';
import { Alert } from 'app/shared/types';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ConfirmBulkUpdateComponent } from 'app/components/confirm-bulk-update/confirm-bulk-update.component';

interface TagListItem {
  display: string;
  value: string;
}

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

export interface LazyMedia {
  getter: () => Observable<Media>;
  loadedAt?: number;
  subscription?: Subscription;
  media?: Media;
  hash: string;
}

// TODO When the saving's done in here use the loading modal.
@Injectable({
  providedIn: 'root',
})
export class MediaService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private tagService: TagService;
  private actorService: ActorService;
  private modalService: NgbModal;
  private collectionService: CollectionService;
  private mediaReplay = new BehaviorSubject<Media | undefined>(undefined);

  public media?: Media;

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    tagService: TagService,
    actorService: ActorService,
    modalService: NgbModal,
    collectionService: CollectionService,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.tagService = tagService;
    this.actorService = actorService;
    this.modalService = modalService;
    this.collectionService = collectionService;

    collectionService.getMetadata().subscribe(metadata => {
      this.setCurrent(metadata && metadata.collection ? metadata.collection[metadata.index] : undefined);
    });
  }

  public resolveClones(hash: string, request: MediaResolution) {
    const alert: Alert = {
      type: 'info',
      message: 'Resolving clones...',
    };

    this.alertService.show(alert);

    this.httpClient.post<number>(`/api/images/${hash}/resolve`, request, HTTP_OPTIONS).subscribe(
      () => {
        this.alertService.dismiss(alert);

        if (this.media && this.media.hash === hash) {
          this.media = {
            ...this.media,
            clones: [],
          };
          this.setCurrent(this.media);
        }
        this.collectionService.removeFromSet(request.aliases);
        this.collectionService.goto(hash);
        this.collectionService.offset(1);
      },
      (err: HttpErrorResponse) => {
        this.alertService.dismiss(alert);
        console.error('failed to resolve clones', request, err);
        this.alertService.show({ type: 'danger', message: 'Failed to resolve clones' });
      },
    );
  }

  public lazyLoadMedia(hashes: string[]): LazyMedia[] {
    return hashes.map(hash => ({
      getter: () =>
        this.getMedia(hash).pipe(
          map(maybeMedia => {
            if (!maybeMedia) {
              throw new Error(`Media not found: ${hash}`);
            }
            return maybeMedia;
          }),
        ),
      hash,
    }));
  }

  public loadMedia(hashes: string[]): Observable<Media[]> {
    if (hashes.length > 20) {
      console.warn('Not recommended to load that many media at once');
    }
    return forkJoin(
      hashes.map(hash =>
        this.getMedia(hash).pipe(
          map(maybeMedia => {
            if (!maybeMedia) {
              throw new Error(`Media not found: ${hash}`);
            }
            return maybeMedia;
          }),
        ),
      ),
    );
  }

  public setCurrent(hash?: string | Media) {
    if (hash && typeof hash !== 'string') {
      this.mediaReplay.next(hash);
      return;
    }

    if (!hash) {
      this.mediaReplay.next(undefined);
    } else {
      this.httpClient.get<Media>(`/api/images/${hash}`).subscribe(
        res => {
          this.media = res;
          this.mediaReplay.next(res);
        },
        (err: HttpErrorResponse) => {
          console.error(err);
          this.alertService.show({ type: 'danger', message: 'Failed to fetch media information' });
        },
      );
    }
  }

  public saveMetadata(metadata: UpdateMetadata) {
    if (!this.media) {
      return;
    }

    console.log('saveMetadata', this.media.hash, metadata);
    this.saveMedia(this.media.hash, { metadata });
  }

  public updateOrderInPlaylist(hash: string, playlistId: string, newLocation: number): void {
    this.httpClient.patch(`/api/images/${hash}/playlists/${playlistId}`, { order: newLocation }, HTTP_OPTIONS).subscribe(
      () => console.debug('location updated', hash, playlistId, newLocation),
      err => {
        console.error('failed to update location', hash, playlistId, newLocation, err);
        this.alertService.show({
          type: 'danger',
          message: `Failed to update media order in playlist`,
        });
      },
    );
  }

  public addActor(value: string | TagListItem) {
    if (!this.media) {
      return;
    }

    this.addActorRaw(this.media, value);
    this.mediaReplay.next(this.media);
  }

  public addPlaylist(hash: string, playlist: MediaPlaylist): void {
    if (!this.media) {
      return;
    }
    if (this.media.hash !== hash) {
      return;
    }

    if (!this.media.playlists) {
      this.media.playlists = [];
    }

    const exists = this.media.playlists.find(pl => pl.id === playlist.id);
    if (!exists) {
      this.media.playlists.push(playlist);
    }
  }

  public removePlaylist(hash: string, id: string): void {
    if (!this.media || !this.media.playlists) {
      return;
    }
    if (this.media.hash !== hash) {
      return;
    }

    const index = this.media.playlists.findIndex(pl => pl.id === id);
    if (index >= 0) {
      this.media.playlists.splice(index, 1);
    }
  }

  public addActorRaw(media: Media, value: string | TagListItem) {
    if (!this.actorService.actors) {
      this.alertService.show({
        type: 'danger',
        message: `Cowardly refusing to save media actors without knowing which exist`,
      });
      return;
    }

    const name = this.getValue(value);

    if (!media.actors.includes(name)) {
      if (!this.actorService.actors.includes(name)) {
        this.actorService.addActor(name);
      }
      // Replace the actors object to trigger change detection.
      media.actors = [...media.actors, name];
      this.mediaReplay.next(this.media);

      const hash = media.hash;
      console.log('addActor', hash, name);
      this.httpClient.post(`/api/images/${hash}/actors`, { name }, HTTP_OPTIONS).subscribe(
        () => console.debug('actor added', hash, name),
        err => {
          console.error('failed to add actor', hash, name, err);
          this.alertService.show({
            type: 'danger',
            message: `Failed to add actor: ${hash}: ${name}`,
          });
        },
      );
    }
  }

  public removeActor(value: string | TagListItem) {
    const name = this.getValue(value);
    if (!this.media) {
      return;
    }
    const index = this.media.actors.indexOf(name);
    if (index >= 0) {
      this.media.actors.splice(index, 1);
      this.mediaReplay.next(this.media);

      const hash = this.media.hash;
      console.log('removeActor', this.media.hash, name);
      this.httpClient.delete(`/api/images/${hash}/actors/${name}`).subscribe(
        () => console.debug('actor removed', hash, name),
        err => {
          console.error('failed to remove actor', hash, name, err);
          this.alertService.show({
            type: 'danger',
            message: `Failed to remove actor: ${hash}: ${name}`,
          });
        },
      );
    }
  }

  public setRating(rating: number) {
    if (this.media && rating !== this.media.rating) {
      this.media.rating = rating;
      this.mediaReplay.next(this.media);
      console.log('setRating', this.media.hash, rating);
      this.saveMedia(this.media.hash, { rating });
    }
  }

  public addTag(value: string | TagListItem) {
    if (!this.media) {
      return;
    }

    this.addTagRaw(this.media, value);
    this.mediaReplay.next(this.media);
  }

  public addTagRaw(media: Media, value: string | TagListItem) {
    if (!this.tagService.tags) {
      this.alertService.show({
        type: 'danger',
        message: `Cowardly refusing to save media tags without knowing which exist`,
      });
      return;
    }

    const name = this.getValue(value);

    if (!media.tags.includes(name)) {
      if (!this.tagService.tags.includes(name)) {
        this.tagService.addTag(name);
      }

      media.tags.push(name);

      const hash = media.hash;
      console.log('addTag', hash, name);
      this.httpClient.post(`/api/images/${hash}/tags`, { name }, HTTP_OPTIONS).subscribe(
        () => console.debug('tag added', hash, name),
        err => {
          console.error('failed to add tag', hash, name, err);
          this.alertService.show({
            type: 'danger',
            message: `Failed to add tag: ${hash}: ${name}`,
          });
        },
      );
    }
  }

  public removeTag(value: string | TagListItem) {
    const name = this.getValue(value);
    if (!this.media) {
      return;
    }
    const index = this.media.tags.indexOf(name);
    if (index >= 0) {
      this.media.tags.splice(index, 1);
      this.mediaReplay.next(this.media);

      const hash = this.media.hash;
      console.log('removeTag', hash, name);
      this.httpClient.delete(`/api/images/${hash}/tags/${name}`).subscribe(
        () => console.debug('tag removed', hash, name),
        err => {
          console.error('failed to remove tag', hash, name, err);
          this.alertService.show({
            type: 'danger',
            message: `Failed to remove tag: ${hash}: ${name}`,
          });
        },
      );
    }
  }

  public getMedia(hash?: string): Observable<Media | undefined> {
    if (!hash) {
      return this.mediaReplay;
    }

    return this.httpClient.get<Media>(`/api/images/${hash}`).pipe(take(1));
  }

  public saveBulk(constraints: SubsetConstraints, update: UpdateMedia) {
    console.log('saveBulk', constraints, update);
    const modalRef = this.modalService.open(ConfirmBulkUpdateComponent, {
      centered: true,
    });
    (modalRef.componentInstance as ConfirmBulkUpdateComponent).constraints = constraints;
    (modalRef.componentInstance as ConfirmBulkUpdateComponent).modal = modalRef;
    modalRef.result
      .then(result => {
        if (result) {
          this.saveBulkRaw(constraints, update);
        }
      })
      .catch(() => {
        // Ignore the error. Thrown on cancel/deny
      });
  }

  private saveBulkRaw(constraints: SubsetConstraints, update: UpdateMedia) {
    const alert: Alert = {
      type: 'info',
      message: 'Applying bulk update... (This may take a while)',
    };

    this.alertService.show(alert);
    this.httpClient.patch<number>(`/api/images/bulk-update`, { constraints, update }, HTTP_OPTIONS).subscribe(
      (count: number) => {
        this.alertService.dismiss(alert);
        this.alertService.show({
          type: 'success',
          autoClose: 5000,
          message: `Applied update to ${count} media`,
        });
        if (!this.media) {
          console.warn('Failed to apply to loaded media, media not set');
          return;
        }
        if (update.metadata) {
          this.media.metadata = Object.assign(this.media.metadata || {}, update.metadata) as any;
        }
        const metadata = this.media.metadata;
        Object.assign(this.media, update);
        this.media.metadata = metadata;
        this.mediaReplay.next(this.media);
      },
      (err: HttpErrorResponse) => {
        this.alertService.dismiss(alert);
        console.error('bulk update failed', constraints, update, err);
        this.alertService.show({ type: 'danger', message: 'Failed to apply bulk update' });
      },
    );
  }

  public saveMedia(hash: string, update: UpdateMedia) {
    this.httpClient.patch<Media>(`/api/images/${hash}`, update, HTTP_OPTIONS).subscribe(
      (media: Media) => {
        if (this.media && this.media.hash === hash) {
          this.media = media;
          this.mediaReplay.next(this.media);
        }
        console.debug('media saved', hash, update);
      },
      (err: HttpErrorResponse) => {
        console.error('media update failed', hash, update, err);
        this.alertService.show({ type: 'danger', message: `Failed to save media: ${hash}` });
      },
    );
  }

  private getValue(value: string | TagListItem): string {
    if (typeof value === 'object') {
      return (value as TagListItem).value;
    } else {
      return value as string;
    }
  }
}
