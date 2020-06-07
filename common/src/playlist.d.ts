export interface Playlist {
  id: string;
  name: string;
  thumbnail?: string;
  size: number;
}

export interface PlaylistCreate {
  name: string;
  thumbnail?: string;
}

export type PlaylistUpdate = Partial<PlaylistCreate>;

export interface PlaylistEntryUpdate {
  order: number;
}
