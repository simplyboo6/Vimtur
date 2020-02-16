import { Component, OnInit, OnDestroy, AfterViewChecked, ViewChild } from '@angular/core';
import { MediaService } from 'services/media.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { AlertService } from 'services/alert.service';
import { Subscription } from 'rxjs';
import { Media, UpdateMedia } from '@vimtur/common';
import { ListItem, toListItems } from 'app/shared/types';

interface MediaModel extends UpdateMedia {
  tags?: ListItem[];
  actors?: ListItem[];
}

@Component({
  selector: 'app-metadata',
  templateUrl: './metadata.component.html',
  styleUrls: ['./metadata.component.scss'],
})
export class MetadataComponent implements OnInit, OnDestroy, AfterViewChecked {
  public media?: Media;
  public mediaModel?: MediaModel;
  public tags?: ListItem[];
  public actors?: ListItem[];
  public mediaService: MediaService;
  public tagService: TagService;
  public actorService: ActorService;

  @ViewChild('ratingElement', { static: false }) private ratingElement: any;
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
              tags: toListItems(media.tags),
              actors: toListItems(media.actors),
              metadata: {
                artist: media.metadata.artist || '',
                album: media.metadata.album || '',
                title: media.metadata.title || '',
              },
            }
          : {};
      }),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(tags => (this.tags = toListItems(tags))),
    );

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => (this.actors = toListItems(actors))),
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
