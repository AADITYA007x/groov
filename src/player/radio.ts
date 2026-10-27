// Endless radio, Surprise me, and Shuffle my library.
//
// Radio on Android uses YouTube Music's own mix for a song (what it would
// play next), topped up from the last song whenever the queue runs low, so it
// never ends. On the laptop/web (no native engine) it falls back to more
// songs by the same artist and genre from the catalog.
import { fetchArtistTracks, fetchCategory, fetchTrendingSongs } from "../api/itunes";
import { getPlaylists } from "../library/playlists";
import { bus, trackRegistry } from "../state";
import type { Item } from "../types";
import { hasNativeAudio, nativeAudio } from "./native-audio";
import { appendToQueue, getCurrentTrackId, getQueueInfo, isShuffleOn, playTrack, setQueue } from "./player";

interface RadioTrack {
  videoId: string;
  title: string;
  artist: string;
  durationSec: number;
  artwork: string | null;
}

let fetching = false;
let seedName: string | null = null;

export function isRadioOn(): boolean {
  return getQueueInfo().source === "radio";
}

export function getRadioSeed(): string | null {
  return isRadioOn() ? seedName : null;
}

// --- Turning YouTube titles into song names ---------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanArtist(name: string): string {
  return name
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s+Official$/i, "")
    .trim();
}

/** "Imagine Dragons - Demons (Official Music Video)" → "Demons". */
export function cleanTitle(title: string, artist: string): string {
  let s = title
    .replace(/\s*[([][^)\]]*(official|lyric|audio|video|visuali[sz]er|hd|4k|remaster)[^)\]]*[)\]]/gi, "")
    .replace(/\s*\|.*$/, "")
    .trim();
  if (artist) s = s.replace(new RegExp(`^${escapeRegex(artist)}\\s*[-–—:]\\s*`, "i"), "");
  return s || title;
}

function toItem(t: RadioTrack): Item {
  const artist = cleanArtist(t.artist || "");
  return {
    id: `yt-${t.videoId}`,
    name: cleanTitle(t.title, artist),
    subtitle: artist,
    artwork: t.artwork,
    previewUrl: null,
    externalUrl: `https://music.youtube.com/watch?v=${t.videoId}`,
    topSubtitle: `Song · ${artist}`,
    durationMs: t.durationSec > 0 ? t.durationSec * 1000 : undefined,
  };
}

// --- Finding radio songs ----------------------------------------------------------

async function nativeRadioAfter(seed: Item): Promise<Item[]> {
  const videoId = seed.id.startsWith("yt-") ? seed.id.slice(3) : undefined;
  const { tracks } = await nativeAudio.radio({ key: seed.id, videoId });
  return tracks.map(toItem);
}

/** Without the native engine: same artist + same genre from the catalog. */
async function catalogRadioAfter(seed: Item): Promise<Item[]> {
  const jobs: Promise<Item[]>[] = [];
  if (seed.artistId) jobs.push(fetchArtistTracks(seed.artistId, 15));
  if (seed.genre) jobs.push(fetchCategory(seed.genre, "tracks", 15));
  if (!jobs.length) jobs.push(fetchCategory(seed.subtitle, "tracks", 15));
  const results = await Promise.allSettled(jobs);
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return items.filter((i) => i.id !== seed.id && i.previewUrl).sort(() => Math.random() - 0.5);
}

export async function radioAfter(seed: Item): Promise<Item[]> {
  if (hasNativeAudio) {
    try {
      const items = await nativeRadioAfter(seed);
      if (items.length) return items;
    } catch (err) {
      console.warn("Native radio failed, using the catalog:", err);
    }
  }
  return catalogRadioAfter(seed);
}

/** Start endless radio from a song (default: the one playing). */
export async function startRadio(seed?: Item): Promise<void> {
  const current = getCurrentTrackId();
  const item = seed ?? (current ? trackRegistry.get(current) : undefined);
  if (!item) return;
  bus.emit("toast", `📻 Starting radio from "${item.name}"…`);
  let items: Item[];
  try {
    items = await radioAfter(item);
  } catch {
    items = [];
  }
  if (!items.length) {
    bus.emit("toast", "Couldn't find radio songs for this one");
    return;
  }
  items.forEach((i) => trackRegistry.set(i.id, i));
  trackRegistry.set(item.id, item);
  seedName = item.name;
  setQueue([item.id, ...items.map((i) => i.id)], item.id, "radio");
  if (getCurrentTrackId() !== item.id) await playTrack(item.id);
  bus.emit("toast", `📻 Radio based on "${item.name}"`);
}

/** Keep radio going: when 2 songs are left, add more from the last one. */
async function topUp(): Promise<void> {
  const { source, remaining, lastId } = getQueueInfo();
  if (source !== "radio" || remaining > 2 || fetching || !lastId) return;
  const last = trackRegistry.get(lastId);
  if (!last) return;
  fetching = true;
  try {
    const items = await radioAfter(last);
    items.forEach((i) => trackRegistry.set(i.id, i));
    if (getQueueInfo().source === "radio") appendToQueue(items.map((i) => i.id));
  } catch (err) {
    console.warn("Radio top-up failed:", err);
  } finally {
    fetching = false;
  }
}

// --- Surprise me / Shuffle my library ------------------------------------------------

export function librarySongs(): Item[] {
  const seen = new Map<string, Item>();
  for (const p of Object.values(getPlaylists())) for (const t of p.tracks) seen.set(t.id, t);
  return [...seen.values()];
}

/** A popular song you don't have yet, then endless radio from it. */
export async function surpriseMe(): Promise<void> {
  bus.emit("toast", "🎲 Picking something…");
  let chart: Item[];
  try {
    chart = await fetchTrendingSongs(100);
  } catch {
    bus.emit("toast", "Can't reach the charts right now");
    return;
  }
  const yours = new Set(librarySongs().map((t) => t.id));
  const fresh = chart.filter((t) => !yours.has(t.id));
  const pool = fresh.length ? fresh : chart;
  if (!pool.length) return;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  chart.forEach((t) => trackRegistry.set(t.id, t));

  if (hasNativeAudio) {
    // Play it, then build radio around it (needs the song's YouTube match).
    setQueue([pick.id], pick.id);
    await playTrack(pick.id);
    await startRadio(pick);
  } else {
    const rest = pool.filter((t) => t.id !== pick.id).sort(() => Math.random() - 0.5);
    seedName = "Surprise me";
    setQueue([pick.id, ...rest.map((t) => t.id)], pick.id, "radio");
    await playTrack(pick.id);
  }
}

/** Every song in all your playlists, in random order. */
export async function shuffleLibrary(): Promise<void> {
  const songs = librarySongs().sort(() => Math.random() - 0.5);
  if (!songs.length) {
    bus.emit("toast", "Add some songs to a playlist first");
    return;
  }
  songs.forEach((t) => trackRegistry.set(t.id, t));
  setQueue(
    songs.map((t) => t.id),
    songs[0].id,
  );
  await playTrack(songs[0].id);
  bus.emit("toast", `🔀 Shuffling ${songs.length} songs from your playlists`);
}

/** Play a playlist: from the top, or from a random song if shuffle is on. */
export async function playPlaylist(playlistId: string): Promise<void> {
  const playlist = getPlaylists()[playlistId];
  if (!playlist?.tracks.length) return;
  const tracks = playlist.tracks;
  tracks.forEach((t) => trackRegistry.set(t.id, t));
  const start = isShuffleOn() ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[0];
  setQueue(
    tracks.map((t) => t.id),
    start.id,
  );
  await playTrack(start.id);
}

export function initRadio(): void {
  bus.on("trackchange", () => void topUp());
}
