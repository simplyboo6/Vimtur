export interface Playlist {
  id: string;
  name: string;
  size: number;
}

export interface PlaylistCreate {
  name: string;
}

export type PlaylistUpdate = Partial<PlaylistCreate>;
