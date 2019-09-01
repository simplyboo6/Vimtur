import { Component, Input, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { Media } from '@vimtur/common';
import { ConfigService } from 'services/config.service';
import { MediaService } from 'services/media.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { Subscription } from 'rxjs';

const DEFAULT_COLUMN_COUNT = 1;

@Component({
  selector: 'app-tag-panel',
  templateUrl: './tag-panel.component.html',
  styleUrls: ['./tag-panel.component.scss'],
})
export class TagPanelComponent implements OnInit, OnDestroy {
  public columnCount = DEFAULT_COLUMN_COUNT;
  public tagsModel: Record<string, boolean> = {};
  public ratingModel?: number;
  public actorsModel?: string[];
  public media?: Media;
  public tags?: string[];
  public actors?: string[];
  public suggestedActors: string[] = [];
  public visible = false;
  public mediaService: MediaService;

  private configService: ConfigService;
  private tagService: TagService;
  private actorService: ActorService;
  private subscriptions: Subscription[] = [];

  public constructor(
    configService: ConfigService,
    mediaService: MediaService,
    tagService: TagService,
    actorService: ActorService,
  ) {
    this.configService = configService;
    this.mediaService = mediaService;
    this.tagService = tagService;
    this.actorService = actorService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        const count = config.user.tagColumnCount;
        if (count) {
          this.columnCount = count;
        }
      }),
    );

    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        this.media = media;
        this.tagsModel = undefined;
        this.actorsModel = undefined;
        this.ratingModel = undefined;

        if (this.media) {
          this.tagsModel = {};
          for (const tag of media.tags) {
            this.tagsModel[tag] = true;
          }
          this.ratingModel = media.rating;
          // Copy it since it'll be modified.
          this.actorsModel = media.actors.map(actor => actor);
        }
      }),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(tags => {
        this.tags = tags;
      }),
    );

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => {
        this.actors = actors;
      }),
    );
  }

  public ngOnDestroy() {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public filterActors(event: any) {
    if (!this.actors) {
      return;
    }
    if (!event.query) {
      this.suggestedActors = this.actors;
    } else {
      this.suggestedActors = this.actors
        .filter(actor => actor.toLowerCase().includes(event.query.toLowerCase()))
        .sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(event.query.toLowerCase());
          const bStarts = b.toLowerCase().startsWith(event.query.toLowerCase());

          if (aStarts === bStarts) {
            return 0;
          }
          return aStarts && !bStarts ? -1 : 1;
        });
    }
  }

  public updateTag(tag: string) {
    const state = !!this.tagsModel[tag];
    if (state) {
      this.mediaService.addTag(tag);
    } else {
      this.mediaService.removeTag(tag);
    }
  }

  public getColumnIndexes(): number[] {
    if (!this.columnCount) {
      return [];
    }
    const indexes: number[] = [];
    for (let i = 0; i < this.columnCount; i++) {
      indexes.push(i);
    }
    return indexes;
  }

  public getColumnTags(index: number): string[] {
    if (!this.tags || !this.columnCount) {
      return [];
    }
    const tagsPerColumn = Math.ceil(this.tags.length / this.columnCount);

    return this.tags.filter((tag, i) => {
      return i >= index * tagsPerColumn && i < (index + 1) * tagsPerColumn;
    });
  }
}
