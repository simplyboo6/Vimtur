import type {
  BaseMedia,
  Configuration,
  DeletedMedia,
  Media,
  MediaPlaylist,
  Playlist,
  PlaylistCreate,
  PlaylistEntryUpdate,
  PlaylistUpdate,
  SubsetConstraints,
  SubsetFields,
  UpdateMedia,
} from '@vimtur/common';

export abstract class Database {
  // Media
  public abstract getMedia(hash: string): Promise<Media | undefined>;
  // Cheap row count used by batch-deletion safety checks, unlike
  // subsetFields which loads every media row into memory.
  public abstract countMedia(): Promise<number>;
  public abstract saveMedia(hash: string, media: UpdateMedia | BaseMedia): Promise<Media>;
  /**
   * Applies an update to every media matching `constraints`. UpdateMedia's
   * autoTags: null clears the generated tags back to the unprocessed state
   * (see its doc comment); [] is the pipeline's "processed, nothing scored"
   * marker, so the two are distinct. Returns the number of matched media.
   */
  public abstract saveBulkMedia(constraints: SubsetConstraints, media: UpdateMedia): Promise<number>;
  public abstract removeMedia(hash: string, ignoreInImport: boolean): Promise<void>;
  public abstract isDeletedPath(path: string): Promise<boolean>;
  public abstract isDeletedHash(hash: string): Promise<boolean>;
  public abstract getDeletedMedia(): Promise<DeletedMedia[]>;
  /**
   * Records one ignored path for a media hash. Rows are keyed by (hash, path),
   * so the same content deleted (or found again) at a second path adds a row
   * instead of replacing the first: SCAN matches paths and INDEX matches
   * hashes, so both need to see every recorded location.
   */
  public abstract addDeleted(deleted: DeletedMedia): Promise<void>;
  /** Drops every ignored path recorded for `hash`. A no-op for an unknown hash. */
  public abstract removeDeleted(hash: string): Promise<void>;
  // Media - tags
  public abstract addMediaTag(hash: string, tag: string): Promise<void>;
  public abstract removeMediaTag(hash: string, tag: string): Promise<void>;
  // Media - actors
  public abstract addMediaActor(hash: string, actor: string): Promise<void>;
  public abstract removeMediaActor(hash: string, actor: string): Promise<void>;
  // Media - playlists
  public abstract addMediaToPlaylist(hash: string, playlistId: string): Promise<MediaPlaylist>;
  public abstract removeMediaFromPlaylist(hash: string, playlistId: string): Promise<void>;
  public abstract updateMediaPlaylistOrder(
    hash: string,
    playlistId: string,
    update: PlaylistEntryUpdate,
  ): Promise<void>;
  // TODO Function to add subset to playlist

  // Searching
  public abstract subset(constraints: SubsetConstraints): Promise<string[]>;
  /**
   * Counts the media matching `constraints`. sample, limit, sortBy and
   * sortDirection are ignored: a count has no ordering or paging, and both
   * engines must agree on the filter semantics.
   */
  public abstract countSubset(constraints: SubsetConstraints): Promise<number>;
  public abstract subsetFields(constraints: SubsetConstraints, fields: SubsetFields | 'all'): Promise<BaseMedia[]>;

  // Actors
  public abstract addActor(name: string): Promise<void>;
  public abstract removeActor(name: string): Promise<void>;
  public abstract getActors(): Promise<string[]>;
  // Existence check for validating attachments without loading every name.
  public abstract hasActor(name: string): Promise<boolean>;

  // Tags
  public abstract addTag(name: string): Promise<void>;
  public abstract removeTag(name: string): Promise<void>;
  public abstract getTags(): Promise<string[]>;
  // Existence check for validating attachments without loading every name.
  public abstract hasTag(name: string): Promise<boolean>;

  // Playlists
  public abstract addPlaylist(request: PlaylistCreate): Promise<Playlist>;
  public abstract removePlaylist(id: string): Promise<void>;
  public abstract updatePlaylist(id: string, request: PlaylistUpdate): Promise<void>;
  public abstract getPlaylists(): Promise<Playlist[]>;
  public abstract getPlaylist(id: string): Promise<Playlist | undefined>;

  // Config
  public abstract getUserConfig(): Promise<Configuration.Partial>;
  public abstract saveUserConfig(config: Configuration.Partial): Promise<void>;

  // Task state
  /**
   * Reads one JSON-serialised value a task persisted under its definition id,
   * or undefined when no value was stored.
   */
  public abstract getTaskState<T>(taskId: string, key: string): Promise<T | undefined>;
  /** Persists a JSON-serialisable value under the task's definition id and key, replacing any previous value. */
  public abstract setTaskState(taskId: string, key: string, value: unknown): Promise<void>;

  // Utility
  public abstract close(): Promise<void>;

  // Clears data from all tables. Implementation should check TEST_MODE=1 is set.
  public abstract testCleanup(): Promise<void>;
}
