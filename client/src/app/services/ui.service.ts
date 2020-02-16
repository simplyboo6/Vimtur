import { Injectable, EventEmitter } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { ArrayFilter, SubsetConstraints } from '@vimtur/common';
import { ListItem, fromListItems } from 'app/shared/types';

export interface FilterField {
  field: string;
  name: string;
}

export interface SearchArrayFilter {
  equalsAny: ListItem[];
  equalsAll: ListItem[];
  equalsNone: ListItem[];
}

export interface SearchModel {
  keywords?: string;
  minimumResolution?: string;
  ratingMin?: number;
  ratingMax?: number;
  tagged?: boolean;
  untagged?: boolean;
  hasClones?: boolean;
  sortBy?: string;

  typeVideo?: boolean;
  typeGif?: boolean;
  typeStill?: boolean;

  tags: SearchArrayFilter;
  actors: SearchArrayFilter;

  artist?: string;
  album?: string;
  title?: string;
  path?: string;
}

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

function createBlankFilter(): SearchArrayFilter {
  return {
    equalsAny: [],
    equalsAll: [],
    equalsNone: [],
  };
}

@Injectable({
  providedIn: 'root',
})
export class UiService {
  private tagPanelState: ReplaySubject<boolean> = new ReplaySubject(1);
  // This is in here to allow the search parameters to persist after leaving the search page.
  public searchModel: SearchModel = this.resetSearch();

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

  public getTagPanelState(): ReplaySubject<boolean> {
    return this.tagPanelState;
  }

  public setTagPanelState(state: boolean) {
    this.tagPanelState.next(state);
  }

  public resetSearch(): SearchModel {
    this.searchModel = {
      tags: createBlankFilter(),
      actors: createBlankFilter(),
    };
    return this.searchModel;
  }

  public createSearch(): SubsetConstraints {
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

    if (this.searchModel.tagged) {
      constraints.tags = Object.assign(constraints.tags || {}, { exists: true });
    }
    if (this.searchModel.untagged) {
      constraints.tags = Object.assign(constraints.tags || {}, { exists: false });
    }

    for (const field of this.stringFields) {
      if (this.searchModel[field.field]) {
        constraints[field.field] = { likeAll: [this.searchModel[field.field]] };
      }
    }

    if (this.searchModel.hasClones) {
      constraints.hasClones = this.searchModel.hasClones;
    }

    return constraints;
  }
}
