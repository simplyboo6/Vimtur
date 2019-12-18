import { Component, OnInit, OnDestroy, AfterViewChecked, ViewChild } from '@angular/core';
import { MediaService } from 'services/media.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { AlertService } from 'services/alert.service';
import { Subscription } from 'rxjs';
import { Media, UpdateMedia } from '@vimtur/common';

interface MediaModel extends UpdateMedia {
  tags?: string[];
  actors?: string[];
}

@Component({
  selector: 'app-metadata',
  templateUrl: './metadata.component.html',
  styleUrls: ['./metadata.component.scss'],
})
export class MetadataComponent implements OnInit, OnDestroy, AfterViewChecked {
  public media?: Media;
  public mediaModel?: MediaModel;
  public tags?: string[];
  public actors?: string[];
  public mediaService: MediaService;

  @ViewChild('ratingElement', { static: false }) private ratingElement: any;
  private tagService: TagService;
  private actorService: ActorService;
  private alertService: AlertService;
  private subscriptions: Subscription[] = [];

  public constructor(
    mediaService: MediaService,
    tagService: TagService,
    alertService: AlertService,
    actorService: ActorService,
  ) {
    this.mediaService = mediaService;
    this.tagService = tagService;
    this.alertService = alertService;
    this.actorService = actorService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        this.media = media;
        this.mediaModel = this.media
          ? {
              rating: media.rating,
              tags: media.tags.slice(0),
              actors: media.actors.slice(0),
              metadata: {
                artist: media.metadata.artist || '',
                album: media.metadata.album || '',
                title: media.metadata.title || '',
              },
            }
          : {};
      }),
    );

    this.subscriptions.push(this.tagService.getTags().subscribe(tags => (this.tags = tags)));

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => (this.actors = actors)),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public ngAfterViewChecked() {
    if (this.ratingElement) {
      // This is a ridiculous hack because there's no configurable way
      // to stop ng-bootstraps rating component stealing focus and keypresses.
      this.ratingElement.handleKeyDown = () => {};
    }
  }
}
