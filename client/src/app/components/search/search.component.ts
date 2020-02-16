import { Component, OnInit, OnDestroy } from '@angular/core';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { CollectionService } from 'services/collection.service';
import { UiService, SearchModel, SearchArrayFilter } from 'services/ui.service';
import { Subscription } from 'rxjs';
import { SubsetConstraints, ArrayFilter } from '@vimtur/common';
import { ListItem, toListItems, fromListItems } from 'app/shared/types';

function toArrayFilter(filter: SearchArrayFilter): ArrayFilter | undefined {
  const output: ArrayFilter = {
    equalsAny: fromListItems(filter.equalsAny),
    equalsAll: fromListItems(filter.equalsAll),
    equalsNone: fromListItems(filter.equalsNone),
  };

  if (!output.equalsAny && !output.equalsAll && !output.equalsNone) {
    return undefined;
  }

  return output;
}

interface FilterField {
  field: string;
  name: string;
}

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

  public tags?: ListItem[];
  public actors?: ListItem[];
  public searchModel: SearchModel;

  public readonly arrayFields: FilterField[] = [
    { field: 'tags', name: 'Tags' },
    { field: 'actors', name: 'Actors' },
  ];

  public readonly stringFields: FilterField[] = [
    { field: 'artist', name: 'Artist' },
    { field: 'album', name: 'Album' },
    { field: 'title', name: 'Title' },
    { field: 'path', name: 'Path' },
  ];

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

    constraints.tags = {};

    if (this.searchModel.tagged) {
      constraints.tags.exists = true;
    }
    if (this.searchModel.untagged) {
      constraints.tags.exists = false;
    }

    if (
      this.searchModel.sortBy === 'hashDate' ||
      this.searchModel.sortBy === 'recommended' ||
      this.searchModel.sortBy === 'rating'
    ) {
      constraints.sortBy = this.searchModel.sortBy;
    }

    const types: string[] = [
      ...(this.searchModel.typeVideo ? ['video'] : []),
      ...(this.searchModel.typeGif ? ['gif'] : []),
      ...(this.searchModel.typeStill ? ['still'] : []),
    ];
    if (types.length) {
      constraints.type = { equalsAny: types };
    }

    for (const field of this.arrayFields) {
      constraints[field.field] = toArrayFilter(this.searchModel[field.field]);
    }

    for (const field of this.stringFields) {
      if (this.searchModel[field.field]) {
        constraints[field.field] = { likeAll: [this.searchModel[field.field]] };
      }
    }

    if (this.searchModel.hasClones) {
      constraints.hasClones = this.searchModel.hasClones;
    }

    console.debug('search', constraints);
    this.collectionService.search(constraints);
  }
}
