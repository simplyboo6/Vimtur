import { Injectable, EventEmitter } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { ArrayFilter } from '@vimtur/common';
import { ListItem } from 'app/shared/types';

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
}
