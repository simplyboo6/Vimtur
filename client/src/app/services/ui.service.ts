import { Injectable } from '@angular/core';
import { ReplaySubject, BehaviorSubject } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { ArrayFilter, SubsetConstraints } from '@vimtur/common';
import { CollectionService } from './collection.service';
import { MediaService } from './media.service';
import { AlertService } from './alert.service';

export interface SearchArrayFilter {
  equalsAny: string[];
  equalsAll: string[];
  equalsNone: string[];
}

export interface SearchStringFilter {
  like: string;
  notLike: string;
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

  lengthMin?: number;
  lengthMax?: number;

  tags: SearchArrayFilter;
  actors: SearchArrayFilter;

  artist: SearchStringFilter;
  album: SearchStringFilter;
  title: SearchStringFilter;
  path: SearchStringFilter;
  dir: SearchStringFilter;

  playlist?: string;
}

export interface ArrayFilterField {
  field: 'tags' | 'actors';
  name: string;
}

export interface StringFilterField {
  field: 'artist' | 'album' | 'title' | 'path' | 'dir';
  name: string;
}

function toArrayFilter(filter: SearchArrayFilter): ArrayFilter | undefined {
  const output: ArrayFilter = {
    equalsAny: filter.equalsAny,
    equalsAll: filter.equalsAll,
    equalsNone: filter.equalsNone,
  };

  if (output.equalsAny?.length === 0) {
    delete output.equalsAny;
  }

  if (output.equalsAll?.length === 0) {
    delete output.equalsAll;
  }

  if (output.equalsNone?.length === 0) {
    delete output.equalsNone;
  }

  if (!output.equalsAny && !output.equalsAll && !output.equalsNone) {
    return undefined;
  }

  return output;
}

function createBlankArrayFilter(): SearchArrayFilter {
  return {
    equalsAny: [],
    equalsAll: [],
    equalsNone: [],
  };
}

function createBlankStringFilter(): SearchStringFilter {
  return {
    like: '',
    notLike: '',
  };
}

@Injectable({
  providedIn: 'root',
})
export class UiService {
  private tagPanelState: ReplaySubject<boolean> = new ReplaySubject(1);
  private readonly collectionService: CollectionService;
  private readonly mediaService: MediaService;
  private readonly alertService: AlertService;
  // This is in here to allow the search parameters to persist after leaving the search page.
  public readonly searchModel = new BehaviorSubject<SearchModel>(this.createSearchModel());

  public readonly arrayFields: ArrayFilterField[] = [
    { field: 'tags', name: 'Tags' },
    { field: 'actors', name: 'Actors' },
  ];

  public readonly stringFields: StringFilterField[] = [
    { field: 'artist', name: 'Artist' },
    { field: 'album', name: 'Album' },
    { field: 'title', name: 'Title' },
    { field: 'path', name: 'Path' },
    { field: 'dir', name: 'Dir' },
  ];

  public constructor(collectionService: CollectionService, mediaService: MediaService, alertService: AlertService) {
    this.collectionService = collectionService;
    this.mediaService = mediaService;
    this.alertService = alertService;
  }

  public getTagPanelState(): ReplaySubject<boolean> {
    return this.tagPanelState;
  }

  public setTagPanelState(state: boolean) {
    this.tagPanelState.next(state);
  }

  public resetSearch(): void {
    this.searchModel.next(this.createSearchModel());
  }

  public createSearch(searchModel: SearchModel): SubsetConstraints {
    const constraints: SubsetConstraints = {};
    if (searchModel.keywords) {
      constraints.keywordSearch = searchModel.keywords;
    }

    if (searchModel.minimumResolution) {
      constraints.quality = {
        min: Number(searchModel.minimumResolution),
      };
    }

    if (searchModel.ratingMin !== undefined && searchModel.ratingMin >= 0) {
      constraints.rating = constraints.rating || {};
      constraints.rating.min = searchModel.ratingMin;
    }
    if (searchModel.ratingMax !== undefined && searchModel.ratingMax >= 0) {
      constraints.rating = constraints.rating || {};
      constraints.rating.max = searchModel.ratingMax;
    }

    if (
      searchModel.sortBy === 'hashDate' ||
      searchModel.sortBy === 'recommended' ||
      searchModel.sortBy === 'rating' ||
      searchModel.sortBy === 'length' ||
      searchModel.sortBy === 'createdAt' ||
      searchModel.sortBy === 'path'
    ) {
      constraints.sortBy = searchModel.sortBy;
    }

    const types: string[] = [...(searchModel.typeVideo ? ['video'] : []), ...(searchModel.typeGif ? ['gif'] : []), ...(searchModel.typeStill ? ['still'] : [])];
    if (types.length) {
      constraints.type = { equalsAny: types };
    }

    if (searchModel.lengthMin !== undefined) {
      constraints.length = Object.assign(constraints.length || {}, {
        // Convert from minutes to seconds
        min: searchModel.lengthMin * 60,
      });
    }
    if (searchModel.lengthMax !== undefined) {
      constraints.length = Object.assign(constraints.length || {}, {
        // Convert from minutes to seconds
        max: searchModel.lengthMax * 60,
      });
    }

    for (const field of this.arrayFields) {
      const res = toArrayFilter(searchModel[field.field]);
      if (res) {
        constraints[field.field] = res;
      }
    }

    if (searchModel.tagged) {
      constraints.tags = Object.assign(constraints.tags || {}, { exists: true });
    }
    if (searchModel.untagged) {
      constraints.tags = Object.assign(constraints.tags || {}, { exists: false });
    }

    if (searchModel.playlist) {
      constraints.playlist = searchModel.playlist;
      constraints.sortBy = 'order';
    }

    for (const field of this.stringFields) {
      const filter = searchModel[field.field];
      if (filter) {
        if (filter.like) {
          constraints[field.field] = Object.assign(constraints[field.field] || {}, {
            likeAny: [filter.like],
          });
        }
        if (filter.notLike) {
          constraints[field.field] = Object.assign(constraints[field.field] || {}, {
            likeNone: [filter.notLike],
          });
        }
      }
    }

    if (searchModel.hasClones) {
      constraints.hasClones = searchModel.hasClones;
    }

    return constraints;
  }

  public createSearchModel(): SearchModel {
    return {
      tags: createBlankArrayFilter(),
      actors: createBlankArrayFilter(),
      artist: createBlankStringFilter(),
      album: createBlankStringFilter(),
      title: createBlankStringFilter(),
      path: createBlankStringFilter(),
      dir: createBlankStringFilter(),
    };
  }

  public offsetDirectory(offset: -1 | 1, single?: boolean): void {
    let dir: string | undefined = this.searchModel.value.dir.like;
    if (!single && !dir) {
      this.alertService.show({ type: 'danger', message: 'Not currently filtering on a directory' });
      return;
    }
    if (!dir) {
      dir = this.mediaService.media?.dir;
    }
    if (!dir) {
      this.alertService.show({ type: 'danger', message: 'No media available' });
      return;
    }

    const constraints: SubsetConstraints =
      offset > 0
        ? {
            dir: { after: dir },
            sortBy: 'path',
            sortDirection: 'ASC',
            limit: 1,
          }
        : {
            dir: { before: dir },
            sortBy: 'path',
            sortDirection: 'DESC',
            limit: 1,
          };

    this.collectionService.setSearching(true);
    this.collectionService
      .subset(constraints)
      .pipe(
        switchMap(([hash]) => {
          if (!hash) {
            throw new Error('No further directories found');
          }
          return this.mediaService.getMedia(hash).pipe(
            map(maybeMedia => {
              if (!maybeMedia) {
                throw new Error(`Media not found: ${hash}`);
              }
              return maybeMedia;
            }),
          );
        }),
      )
      .subscribe(
        media => {
          const searchModel = this.createSearchModel();
          searchModel.dir.like = media.dir;
          searchModel.sortBy = 'path';
          this.searchModel.next(searchModel);
          this.collectionService.search(this.createSearch(searchModel), { noRedirect: true });
        },
        err => {
          this.collectionService.setSearching(false);
          this.alertService.show({ type: 'danger', message: err.message });
        },
      );
  }
}
