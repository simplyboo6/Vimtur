import { Component, OnInit, OnDestroy, AfterViewChecked, ViewChild } from '@angular/core';
import { MediaService } from 'services/media.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { UiService } from 'services/ui.service';
import { Subscription } from 'rxjs';
import { Media, UpdateMedia, Playlist, UpdateMetadata } from '@vimtur/common';
import { ListItem, toListItems } from 'app/shared/types';
import { PlaylistService } from 'services/playlist.service';

interface MediaModel extends UpdateMedia {
  tags?: ListItem[];
  actors?: ListItem[];
  playlists?: ListItem[];
  metadata: UpdateMetadata;
  rating: number;
}

interface MetadataField {
  name: 'artist' | 'album' | 'title';
  text: string;
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
  public playlists?: ListItem[];
  public mediaService: MediaService;
  public tagService: TagService;
  public actorService: ActorService;
  public playlistService: PlaylistService;
  public currentPlaylist?: Playlist;

  public readonly metadataFields: MetadataField[] = [
    { name: 'artist', text: 'Artist' },
    { name: 'album', text: 'Album' },
    { name: 'title', text: 'Title' },
  ];

  // angular2 multiselect doesn't export types and they're not partial
  public readonly tagsSettings: any = {
    text: '+ Tag',
    enableCheckAll: false,
    enableSearchFilter: true,
    addNewItemOnFilter: true,
    enableFilterSelectAll: false,
  };

  public readonly actorsSettings: any = {
    text: '+ Actor',
    enableCheckAll: false,
    enableSearchFilter: true,
    addNewItemOnFilter: true,
    enableFilterSelectAll: false,
  };

  public readonly playlistsSettings: any = {
    text: '+ Playlist',
    enableCheckAll: false,
    enableSearchFilter: true,
    addNewItemOnFilter: true,
    enableFilterSelectAll: false,
  };

  @ViewChild('ratingElement', { static: false }) private ratingElement: any;
  private uiService: UiService;
  private subscriptions: Subscription[] = [];

  public constructor(
    mediaService: MediaService,
    tagService: TagService,
    actorService: ActorService,
    uiService: UiService,
    playlistService: PlaylistService,
  ) {
    this.mediaService = mediaService;
    this.tagService = tagService;
    this.actorService = actorService;
    this.uiService = uiService;
    this.playlistService = playlistService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        this.media = media;
        this.mediaModel = this.media
          ? {
              rating: media.rating || 0,
              tags: toListItems(media.tags),
              actors: toListItems(media.actors),
              playlists: this.updatePlaylistsModel(),
              metadata: {
                artist: media.metadata?.artist || '',
                album: media.metadata?.album || '',
                title: media.metadata?.title || '',
              },
            }
          : undefined;
      }),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(tags => (this.tags = toListItems(tags))),
    );

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => (this.actors = toListItems(actors))),
    );

    this.subscriptions.push(
      this.playlistService.getCurrentPlaylist().subscribe(playlist => {
        this.currentPlaylist = playlist;
        this.updateDisabledPlaylists();
      }),
    );

    this.subscriptions.push(
      this.playlistService.getPlaylists().subscribe(playlists => {
        this.playlists = playlists.map(playlist => {
          return {
            id: playlist.id,
            itemName: playlist.name,
          };
        });

        this.updateDisabledPlaylists();
        this.updatePlaylistsModel();
      }),
    );
  }

  public timestampAsDate(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  public saveBulkMetadata(field: 'artist' | 'album' | 'title') {
    if (!this.mediaModel || !this.mediaModel.metadata) {
      return;
    }
    // TODO Confirm with user and display current search set.
    // TODO Show a warning to the user if no filters are set.
    this.mediaService.saveBulk(this.uiService.createSearch(), {
      metadata: { [field]: this.mediaModel.metadata[field] },
    });
  }

  public saveMetadata(field: 'artist' | 'album' | 'title') {
    if (!this.mediaModel || !this.mediaModel.metadata) {
      return;
    }
    this.mediaService.saveMetadata({ [field]: this.mediaModel.metadata[field] });
  }

  public isMetadataChanged(
    field: 'artist' | 'album' | 'title',
    media?: Media,
    model?: MediaModel,
  ): boolean {
    if (!media || !model || !model.metadata || !media.metadata) {
      return false;
    }

    if (!model.metadata[field] && !media.metadata[field]) {
      return false;
    }

    if (model.metadata[field] === undefined) {
      return false;
    }

    return media.metadata[field] !== model.metadata[field];
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

  private updateDisabledPlaylists(): void {
    if (!this.playlists) {
      return;
    }

    this.playlists = this.playlists.map(pl => {
      return {
        ...pl,
        disabled: Boolean(this.currentPlaylist && this.currentPlaylist.id === pl.id),
      };
    });
  }

  private updatePlaylistsModel(): ListItem[] {
    if (!this.media || !this.playlists || !this.mediaModel) {
      return [];
    }
    this.mediaModel.playlists = [];
    if (this.media.playlists) {
      this.mediaModel.playlists = this.media.playlists.map(playlist => {
        return {
          id: playlist.id,
          itemName: this.playlists?.find(list => list.id === playlist.id)?.itemName || playlist.id,
        };
      });
    }

    return this.mediaModel.playlists || [];
  }
}
