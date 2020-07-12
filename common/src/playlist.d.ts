export interface Playlist {
  id: string;
  name: string;
  thumbnail?: string;
  size: number;
}

export interface PlaylistCreate {
  name: string;
  thumbnail?: string;
  // Initial media in playlist
  hashes?: string[];
}

export interface PlaylistUpdate {
  name?: string;
  thumbnail?: string;
}

export interface PlaylistEntryUpdate {
  order: number;
}
