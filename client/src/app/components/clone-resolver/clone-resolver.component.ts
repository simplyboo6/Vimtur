import { Component, OnInit, OnDestroy } from '@angular/core';
import { MediaService } from 'services/media.service';
import { AlertService } from 'services/alert.service';
import { CollectionService } from 'services/collection.service';
import { Media } from '@vimtur/common';
import { Subscription } from 'rxjs';

interface CloneMedia extends Media {
  isClone?: boolean;
}

@Component({
  selector: 'app-clone-resolver',
  templateUrl: './clone-resolver.component.html',
  styleUrls: ['./clone-resolver.component.scss'],
})
export class CloneResolverComponent implements OnInit, OnDestroy {
  public media?: Media;
  public clones?: CloneMedia[];
  public collectionService: CollectionService;

  private subscriptions: Subscription[] = [];
  private mediaService: MediaService;
  private alertService: AlertService;

  public constructor(
    mediaService: MediaService,
    alertService: AlertService,
    collectionService: CollectionService,
  ) {
    this.mediaService = mediaService;
    this.alertService = alertService;
    this.collectionService = collectionService;
  }

  public ngOnInit() {
    this.media = undefined;
    this.clones = undefined;

    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        console.log('got media', media);
        this.media = media;
        this.loadClones();
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];

    this.media = undefined;
    this.clones = undefined;
  }

  public anyClonesSelected(clones?: CloneMedia[]): boolean {
    if (!clones) {
      return false;
    }
    return Boolean(clones.find(m => m.isClone));
  }

  private loadClones() {
    if (!this.media || !this.media.clones || this.media.clones.length === 0) {
      return;
    }
    this.clones = undefined;
    console.log('loading clones', this.media.clones);
    this.mediaService.loadMedia(this.media.clones).subscribe(
      clones => (this.clones = clones),
      err => {
        this.alertService.show({ type: 'danger', message: 'Failed to load clones' });
        console.error('Failed to load clones', err);
      },
    );
  }

  private padTime(length: number): string {
    return length < 10 ? `0${length}` : `${length}`;
  }

  private formatLength(length: number): string {
    const hours = Math.floor(length / 3600);
    length -= hours * 3600;
    const minutes = Math.floor(length / 60);
    length -= minutes * 60;
    const seconds = Math.floor(length);
    return `${this.padTime(hours)}:${this.padTime(minutes)}:${this.padTime(seconds)}`;
  }

  public getTitle(media: Media): string {
    const titles: string[] = [];
    if (media.metadata.album) {
      titles.push(media.metadata.album);
    }
    if (media.metadata.title) {
      titles.push(media.metadata.title);
    }
    const title = titles.join(' - ');
    return title || media.path.split('/').slice(-1)[0];
  }

  public getSubtitle(media: Media): string {
    return `${media.tags.length} tags | ${media.actors.length} people | ${media.metadata.width}x${media.metadata.height}`;
  }

  public getHoverText(media: Media): string {
    const tags = media.tags && media.tags.length ? media.tags.join(', ') : 'None';
    const actors = media.actors && media.actors.length ? media.actors.join(', ') : 'None';
    return `Tags: ${tags}\nPeople: ${actors}\nPath: ${media.path}`;
  }
}
