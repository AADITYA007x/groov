import type { Item } from "./types";
import { createEmitter } from "./utils";

/** Every track rendered anywhere, by id, so play buttons can look them up. */
export const trackRegistry = new Map<string, Item>();

export function registerTrack(item: Item): void {
  trackRegistry.set(item.id, item);
}

/** App-wide events. Modules subscribe instead of importing each other. */
export const bus = createEmitter<{
  /** A new track was loaded into the player. */
  trackchange: Item;
  /** Playback started (true) or paused/stopped (false). */
  playstate: boolean;
  progress: { currentTime: number; duration: number };
  /** Playlists were created, edited or deleted. */
  playlistschange: void;
}>();
