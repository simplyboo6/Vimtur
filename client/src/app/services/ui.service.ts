import { Injectable, EventEmitter } from '@angular/core';
import { ReplaySubject } from 'rxjs';

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

  allTags: Record<string, boolean>;
  anyTags: Record<string, boolean>;
  noneTags: Record<string, boolean>;
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
      allTags: {},
      anyTags: {},
      noneTags: {},
    };
    return this.searchModel;
  }
}
