import { Component, OnInit, OnDestroy } from '@angular/core';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { CollectionService } from 'services/collection.service';
import { UiService, SearchModel } from 'services/ui.service';
import { PlaylistService } from 'services/playlist.service';
import { Subscription } from 'rxjs';
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
      this.tagService.getTags().subscribe(tags => (this.tags = toListItems(tags))),
    );

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => (this.actors = toListItems(actors))),
    );

    this.subscriptions.push(
      this.playlistService.getPlaylists().subscribe(playlists => (this.playlists = playlists)),
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
}
