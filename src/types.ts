export type Category = "tracks" | "artists" | "albums";

/** A normalized catalog item (song, artist or album) as the UI uses it. */
export interface Item {
  id: string;
  name: string;
  subtitle: string;
  artwork: string | null;
  previewUrl?: string | null;
  externalUrl?: string | null;
  topSubtitle: string;
  artistId?: number;
  genre?: string;
  /** Track length from the catalog; helps pick the right YouTube version. */
  durationMs?: number;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Item[];
}

export type Playlists = Record<string, Playlist>;

export interface SearchResult {
  matches: Partial<Record<Category, Item[]>>;
  best: { item: Item; score: number; category: Category } | null;
}

export interface LyricLine {
  time: number;
  text: string;
}

export interface Lyrics {
  plain: string;
  synced: LyricLine[] | null;
}
