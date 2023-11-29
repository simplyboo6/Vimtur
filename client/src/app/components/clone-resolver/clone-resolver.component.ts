import { Component, OnInit, OnDestroy } from '@angular/core';
import { MediaService } from 'services/media.service';
import { AlertService } from 'services/alert.service';
import { CollectionService } from 'services/collection.service';
import { Media } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { getTitle, getSubtitle } from 'app/shared/media-formatting';

interface CloneMedia extends Media {
  isClone?: boolean;
}

@Component({
  selector: 'app-clone-resolver',
  templateUrl: './clone-resolver.component.html',
  styleUrls: ['./clone-resolver.component.scss'],
})
export class CloneResolverComponent implements OnInit, OnDestroy {
  public readonly getTitle = getTitle;
  public readonly getSubtitle = getSubtitle;
  public media?: Media;
  public clones?: CloneMedia[];
  public collectionService: CollectionService;

  private subscriptions: Subscription[] = [];
  private mediaService: MediaService;
  private alertService: AlertService;

  public constructor(mediaService: MediaService, alertService: AlertService, collectionService: CollectionService) {
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

  public autoResolve() {
    if (!this.clones || !this.media) {
      return;
    }

    // Merge them and organise them by resolution greater to smallest
    const all = [...this.clones, this.media].sort((a, b) => {
      if (!b.metadata || !a.metadata) {
        return 0;
      }
      return b.metadata.width * b.metadata.height - a.metadata.width * a.metadata.height;
    });
    console.debug('Autoresolve: highest resolution', all[0]);

    const tags: string[] = [];
    const actors: string[] = [];

    const artist = all.map(m => m.metadata && m.metadata.artist).find(a => Boolean(a));
    console.debug('Autoresolve: artist', artist);

    const album = all.map(m => m.metadata && m.metadata.album).find(a => Boolean(a));
    console.debug('Autoresolve: album', album);

    const title = all.map(m => m.metadata && m.metadata.title).find(t => Boolean(t));
    console.debug('Autoresolve: title', title);

    const ratingList = all
      .map(m => m.rating)
      .filter(r => Boolean(r))
      .sort((a, b) => (b || 0) - (a || 0));
    const rating = ratingList[0];
    console.debug('Autoresolve: rating', rating);

    for (const media of all) {
      tags.push(...media.tags);
      actors.push(...media.actors);
    }
    const uniqueTags = Array.from(new Set(tags));
    console.debug('Autoresolve: uniqueTags', uniqueTags);

    const uniqueActors = Array.from(new Set(actors));
    console.debug('Autoresolve: uniqueActors', uniqueActors);

    // Apply all the merged metadata to the primary image
    if (artist || album || title) {
      this.mediaService.saveMedia(all[0].hash, {
        metadata: { artist, album, title },
      });
    }

    if (rating !== undefined) {
      this.mediaService.saveMedia(all[0].hash, { rating });
    }

    for (const tag of uniqueTags) {
      this.mediaService.addTagRaw(all[0], tag);
    }

    for (const actor of uniqueActors) {
      this.mediaService.addActorRaw(all[0], actor);
    }

    // Resolve clones for it (this will also skip to it + 1.
    this.mediaService.resolveClones(all[0].hash, {
      aliases: all.splice(1).map(m => m.hash),
      unrelated: [],
    });
  }

  public anyClonesSelected(clones?: CloneMedia[]): boolean {
    if (!clones) {
      return false;
    }
    return Boolean(clones.find(m => m.isClone));
  }

  public resolveSelected() {
    if (!this.clones || !this.media) {
      return;
    }
    this.mediaService.resolveClones(this.media.hash, {
      aliases: this.clones.filter(m => m.isClone).map(m => m.hash),
      unrelated: this.clones.filter(m => !m.isClone).map(m => m.hash),
    });
  }

  public resolveAll() {
    if (!this.clones || !this.media) {
      return;
    }
    this.mediaService.resolveClones(this.media.hash, {
      aliases: this.clones.map(m => m.hash),
      unrelated: [],
    });
  }

  public resolveNone() {
    if (!this.clones || !this.media) {
      return;
    }
    this.mediaService.resolveClones(this.media.hash, {
      aliases: [],
      unrelated: this.clones.map(m => m.hash),
    });
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

  public getHoverText(media: Media): string {
    const tags = media.tags && media.tags.length ? media.tags.join(', ') : 'None';
    const actors = media.actors && media.actors.length ? media.actors.join(', ') : 'None';
    return `Tags: ${tags}\nPeople: ${actors}\nPath: ${media.path}`;
  }
}
