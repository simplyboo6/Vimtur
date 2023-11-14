import { Component, OnInit, OnDestroy } from '@angular/core';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { CollectionService } from 'services/collection.service';
import { UiService, SearchModel, StringFilterField, ArrayFilterField } from 'services/ui.service';
import { PlaylistService } from 'services/playlist.service';
import { Subscription, combineLatest, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Playlist } from '@vimtur/common';
import { ListItem, toListItems } from 'app/shared/types';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.scss'],
})
export class SearchComponent implements OnInit, OnDestroy {
  private readonly tagService: TagService;
  private readonly actorService: ActorService;
  private readonly playlistService: PlaylistService;

  private subscriptions: Subscription[] = [];

  public readonly collectionService: CollectionService;
  public tags?: ListItem[];
  public actors?: ListItem[];
  public playlists?: Playlist[];
  public searchModel: SearchModel;
  public uiService: UiService;

  public constructor(
    tagService: TagService,
    actorService: ActorService,
    collectionService: CollectionService,
    uiService: UiService,
    playlistService: PlaylistService,
  ) {
    this.tagService = tagService;
    this.actorService = actorService;
    this.collectionService = collectionService;
    this.uiService = uiService;
    this.searchModel = uiService.searchModel;
    this.playlistService = playlistService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      timer(0)
        .pipe(
          switchMap(() =>
            combineLatest([
              this.tagService.getTags(),
              this.actorService.getActors(),
              this.playlistService.getPlaylists(),
            ]),
          ),
        )
        .subscribe(([tags, actors, playlists]) => {
          this.tags = toListItems(tags);
          this.actors = toListItems(actors);
          this.playlists = playlists;
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
    const constraints = this.uiService.createSearch();
    console.debug('search', constraints);
    this.collectionService.search(constraints);
  }

  public playlistId(_: number, playlist: Playlist): string {
    return playlist.id;
  }

  public listId(_: number, item: ListItem): string {
    return item.id;
  }

  public stringFieldId(_: number, item: StringFilterField): string {
    return item.field;
  }

  public arrayFieldId(_: number, item: ArrayFilterField): string {
    return item.field;
  }
}
