import { HttpClient, HttpResponse, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, ReplaySubject, forkJoin } from 'rxjs';
import { Media, UpdateMetadata, UpdateMedia } from '@vimtur/common';
import { AlertService } from 'app/services/alert.service';
import { CollectionService } from 'app/services/collection.service';
import { TagService } from 'app/services/tag.service';
import { ActorService } from 'app/services/actor.service';
import { QualityService } from 'app/services/quality.service';

interface TagListItem {
  display: string;
  value: string;
}

const HTTP_OPTIONS = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
  }),
};

// TODO When the saving's done in here use the loading modal.
@Injectable({
  providedIn: 'root',
})
export class MediaService {
  private httpClient: HttpClient;
  private alertService: AlertService;
  private tagService: TagService;
  private actorService: ActorService;
  private qualityService: QualityService;
  private mediaReplay: ReplaySubject<Media> = new ReplaySubject(1);

  public media?: Media;

  public constructor(
    httpClient: HttpClient,
    alertService: AlertService,
    collectionService: CollectionService,
    tagService: TagService,
    actorService: ActorService,
    qualityService: QualityService,
  ) {
    this.httpClient = httpClient;
    this.alertService = alertService;
    this.tagService = tagService;
    this.actorService = actorService;
    this.qualityService = qualityService;

    collectionService.getMetadata().subscribe(metadata => {
      this.setCurrent(
        metadata && metadata.collection ? metadata.collection[metadata.index] : undefined,
      );
    });
  }

  public loadMedia(hashes: string[]): Observable<Media[]> {
    return forkJoin(
      hashes.map(hash => {
        return this.httpClient.get<Media>(`/api/images/${hash}`);
      }),
    );
  }

  private setCurrent(hash?: string) {
    if (!hash) {
      this.mediaReplay.next(undefined);
      this.qualityService.qualityLevels.next();
      this.qualityService.currentLevel.next();
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

  public addActor(value: string | TagListItem) {
    if (!this.actorService.actors) {
      this.alertService.show({
        type: 'danger',
        message: `Cowardly refusing to save media actors without knowing which exist`,
      });
      return;
    }

    const name = this.getValue(value);
    if (!this.media) {
      return;
    }
    if (!this.media.actors.includes(name)) {
      if (!this.actorService.actors.includes(name)) {
        this.actorService.addActor(name);
      }
      this.media.actors.push(name);
      this.mediaReplay.next(this.media);
      console.log('addActor', this.media.hash, name);
      this.saveMedia(this.media.hash, { actors: this.media.actors.slice(0) });
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
      console.log('removeActor', this.media.hash, name);
      this.saveMedia(this.media.hash, { actors: this.media.actors.slice(0) });
    }
  }

  public setRating(rating: number) {
    if (rating !== this.media.rating) {
      this.media.rating = rating;
      this.mediaReplay.next(this.media);
      console.log('setRating', this.media.hash, rating);
      this.saveMedia(this.media.hash, { rating });
    }
  }

  public addTag(value: string | TagListItem) {
    if (!this.tagService.tags) {
      this.alertService.show({
        type: 'danger',
        message: `Cowardly refusing to save media tags without knowing which exist`,
      });
      return;
    }

    const name = this.getValue(value);
    if (!this.media) {
      return;
    }
    if (!this.media.tags.includes(name)) {
      if (!this.tagService.tags.includes(name)) {
        this.tagService.addTag(name);
      }

      this.media.tags.push(name);
      this.mediaReplay.next(this.media);
      console.log('addTag', this.media.hash, name);
      this.saveMedia(this.media.hash, { tags: this.media.tags.slice(0) });
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
      console.log('removeTag', this.media.hash, name);
      this.saveMedia(this.media.hash, { tags: this.media.tags.slice(0) });
    }
  }

  public getMedia(): ReplaySubject<Media> {
    return this.mediaReplay;
  }

  private saveMedia(hash: string, update: UpdateMedia) {
    this.httpClient.post<Media>(`/api/images/${hash}`, update, HTTP_OPTIONS).subscribe(
      (media: Media) => {
        this.media = media;
        this.mediaReplay.next(this.media);
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
