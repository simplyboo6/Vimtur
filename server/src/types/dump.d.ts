import { BaseMedia, Configuration, DeletedMedia, Playlist } from '@vimtur/common';

export interface DumpPlaylist extends Playlist {
  hashes: string[];
}

export interface DumpFile {
  tags: string[];
  actors: string[];
  media: BaseMedia[];
  config?: Configuration.Partial;
  deleted?: DeletedMedia[];
  version?: number;
  playlists?: DumpPlaylist[];
}
