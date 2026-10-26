import { storage } from "./utils";

export const DEBOUNCE_MS = 300;
export const OVERVIEW_LIMIT = 4;
export const SEE_ALL_LIMIT = 12;
export const MIN_QUERY_LENGTH = 1;

/**
 * Storage keys keep the original "search-demo:" prefix so playlists, recent
 * searches and the YouTube ID cache from earlier builds carry over.
 */
export const KEYS = {
  recent: "search-demo:recent-searches",
  theme: "search-demo:theme",
  ytCache: "search-demo:yt-cache",
  playlists: "search-demo:playlists",
  ytKey: "groov:youtube-api-key",
} as const;

const BUILD_YOUTUBE_KEY = (import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined) ?? "";

/** A key pasted in the app wins over one baked in at build time. */
export function getYoutubeApiKey(): string {
  return storage.get<string>(KEYS.ytKey, "") || BUILD_YOUTUBE_KEY;
}

export function setYoutubeApiKey(key: string): void {
  if (key.trim()) storage.set(KEYS.ytKey, key.trim());
  else storage.remove(KEYS.ytKey);
}

export function hasCustomYoutubeKey(): boolean {
  return Boolean(storage.get<string>(KEYS.ytKey, ""));
}
