import type { Item } from "./types";
import type { Account } from "./cloud/session";
import type { SyncStatus } from "./cloud/sync";
import type { FriendStatus } from "./cloud/presence";
import type { JamInfo } from "./cloud/jam";
import type { Engine } from "./player/player";
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
  /** The user jumped to a new position. */
  seeked: void;
  /** The current track's length became known (seconds). */
  durationchange: number;
  /** Switched between the native player, YouTube player and 30s preview. */
  enginechange: Engine;
  /** A song is being found/downloaded before it can start. */
  loading: boolean;
  /** "Show video" gave up (the video wouldn't start); stay on audio. */
  videounavailable: void;
  /** Playlists were created, edited or deleted. */
  playlistschange: void;
  /** Signed in (the account) or out (null). */
  authchange: Account | null;
  /** A change was queued for the account. */
  outbox: void;
  syncstatus: SyncStatus;
  /** Who's online and what they're playing. */
  friendschange: FriendStatus[];
  /** Listening along with someone / people listening along with me. */
  jamchange: JamInfo;
  /** A short message at the bottom of the screen. */
  toast: string;
}>();
