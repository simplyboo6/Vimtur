import { Component, OnInit, OnDestroy } from '@angular/core';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { CollectionService } from 'services/collection.service';
import { UiService, SearchModel } from 'services/ui.service';
import { Subscription } from 'rxjs';
import { SubsetConstraints } from '@vimtur/common';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.scss'],
})
export class SearchComponent implements OnInit, OnDestroy {
  private tagService: TagService;
  private actorService: ActorService;
  private collectionService: CollectionService;
  private uiService: UiService;

  private subscriptions: Subscription[] = [];

  public tags?: string[];
  public actors?: string[];
  public searchModel: SearchModel;

  public constructor(
    tagService: TagService,
    actorService: ActorService,
    collectionService: CollectionService,
    uiService: UiService,
  ) {
    this.tagService = tagService;
    this.actorService = actorService;
    this.collectionService = collectionService;
    this.uiService = uiService;
    this.searchModel = uiService.searchModel;
  }

  public ngOnInit() {
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

  public reset() {
    this.searchModel = this.uiService.resetSearch();
  }

  public search() {
    const constraints: SubsetConstraints = {};
    if (this.searchModel.keywords) {
      constraints.keywordSearch = this.searchModel.keywords;
    }

    if (this.searchModel.minimumResolution) {
      constraints.quality = {
        min: Number(this.searchModel.minimumResolution),
      };
    }

    if (this.searchModel.ratingMin >= 0) {
      constraints.rating = constraints.rating || {};
      constraints.rating.min = this.searchModel.ratingMin;
    }
    if (this.searchModel.ratingMax >= 0) {
      constraints.rating = constraints.rating || {};
      constraints.rating.max = this.searchModel.ratingMax;
    }

    if (this.searchModel.tagged) {
      constraints.any = '*';
    }
    if (this.searchModel.untagged) {
      constraints.none = '*';
    }

    if (this.searchModel.sortBy === 'hashDate' || this.searchModel.sortBy === 'recommended') {
      constraints.sortBy = this.searchModel.sortBy;
    }

    const types: string[] = [
      ...(this.searchModel.typeVideo ? ['video'] : []),
      ...(this.searchModel.typeGif ? ['gif'] : []),
      ...(this.searchModel.typeStill ? ['still'] : []),
    ];
    if (types.length) {
      constraints.type = types;
    }

    const allTags = this.tagsToList(this.searchModel.allTags);
    if (allTags.length) {
      constraints.all = allTags;
    }
    const anyTags = this.tagsToList(this.searchModel.anyTags);
    if (anyTags.length) {
      constraints.any = anyTags;
    }
    const noneTags = this.tagsToList(this.searchModel.noneTags);
    if (noneTags.length) {
      constraints.none = noneTags;
    }
    constraints.hasClones = this.searchModel.hasClones;

    console.debug('search', constraints);
    this.collectionService.search(constraints);
  }

  private tagsToList(tagMap: Record<string, boolean>) {
    const tags: string[] = [];
    for (const key of Object.keys(tagMap)) {
      if (tagMap[key]) {
        tags.push(key);
      }
    }
    return tags;
  }
}
