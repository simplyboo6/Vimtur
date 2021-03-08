import {
  Component,
  Input,
  SimpleChanges,
  OnInit,
  OnDestroy,
  ViewChild,
  AfterViewChecked,
} from '@angular/core';
import { Media, Configuration, UpdateMetadata, Playlist } from '@vimtur/common';
import { ConfigService } from 'services/config.service';
import { MediaService } from 'services/media.service';
import { PlaylistService } from 'services/playlist.service';
import { TagService } from 'services/tag.service';
import { ActorService } from 'services/actor.service';
import { Subscription } from 'rxjs';
import { ListItem, toListItems } from 'app/shared/types';

const DEFAULT_COLUMN_COUNT = 1;

@Component({
  selector: 'app-tag-panel',
  templateUrl: './tag-panel.component.html',
  styleUrls: ['./tag-panel.component.scss'],
})
export class TagPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  public tagsModel: Record<string, boolean> = {};
  public ratingModel?: number;
  public actorsModel?: ListItem[];
  public playlistsModel?: ListItem[];
  public media?: Media;
  public tags?: string[];
  public actors?: ListItem[];
  public playlists?: ListItem[];
  public suggestedActors: string[] = [];
  public visible = false;
  public mediaService: MediaService;
  public config?: Configuration.Main;
  public mediaMetadataUpdate?: UpdateMetadata;
  public actorService: ActorService;
  public playlistService: PlaylistService;
  public currentPlaylist?: Playlist;
  public columnIndexes?: number[];
  public columnTags?: string[][];

  @ViewChild('ratingElement', { static: false }) private ratingElement: any;
  private configService: ConfigService;
  private tagService: TagService;
  private subscriptions: Subscription[] = [];

  public constructor(
    configService: ConfigService,
    mediaService: MediaService,
    tagService: TagService,
    actorService: ActorService,
    playlistService: PlaylistService,
  ) {
    this.configService = configService;
    this.mediaService = mediaService;
    this.tagService = tagService;
    this.actorService = actorService;
    this.playlistService = playlistService;
  }

  public ngOnInit() {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
        this.updateColumnIndexes();
      }),
    );

    this.subscriptions.push(
      this.mediaService.getMedia().subscribe(media => {
        this.media = media;
        this.tagsModel = undefined;
        this.actorsModel = undefined;
        this.ratingModel = undefined;
        this.playlistsModel = undefined;

        if (this.media) {
          // Map undefined to empty strings to better do change detection.
          media.metadata.artist = media.metadata.artist || '';
          media.metadata.album = media.metadata.album || '';
          media.metadata.title = media.metadata.title || '';

          this.mediaMetadataUpdate = { ...media.metadata };

          this.tagsModel = {};
          for (const tag of media.tags) {
            this.tagsModel[tag] = true;
          }
          this.ratingModel = media.rating;
          // Copy it since it'll be modified.
          this.actorsModel = toListItems(media.actors);

          this.updatePlaylistsModel();
        }
      }),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(tags => {
        this.tags = tags;
        this.updateColumnIndexes();
      }),
    );

    this.subscriptions.push(
      this.actorService.getActors().subscribe(actors => {
        this.actors = toListItems(actors);
      }),
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

  public saveMetadata(field: 'artist' | 'album' | 'title') {
    if (!this.media || !this.mediaMetadataUpdate) {
      return;
    }
    this.mediaService.saveMetadata({ [field]: this.mediaMetadataUpdate[field] });
    this.media.metadata[field] = this.mediaMetadataUpdate[field];
  }

  public updateTag(tag: string) {
    const state = !!this.tagsModel[tag];
    if (state) {
      this.mediaService.addTag(tag);
    } else {
      this.mediaService.removeTag(tag);
    }
  }

  private updateColumnIndexes(): void {
    const count = (this.config && this.config.user.tagColumnCount) || DEFAULT_COLUMN_COUNT;
    const indexes: number[] = [];
    for (let i = 0; i < count; i++) {
      indexes.push(i);
    }
    this.columnIndexes = indexes;
    this.updateColumnTags();
  }

  private updateColumnTags(): void {
    this.columnTags = [];
    if (!this.columnIndexes) {
      return;
    }
    this.columnTags = this.columnIndexes.map(index => {
      const count = (this.config && this.config.user.tagColumnCount) || DEFAULT_COLUMN_COUNT;
      if (!this.tags) {
        return [];
      }
      const tagsPerColumn = Math.ceil(this.tags.length / count);

      return this.tags.filter((tag, i) => {
        return i >= index * tagsPerColumn && i < (index + 1) * tagsPerColumn;
      });
    });
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

  private updatePlaylistsModel(): void {
    this.playlistsModel = undefined;
    if (!this.media || !this.playlists) {
      return;
    }

    this.playlistsModel = this.media.playlists.map(playlist => {
      return {
        id: playlist.id,
        itemName: this.playlists.find(list => list.id === playlist.id)?.itemName,
      };
    });
  }
}
