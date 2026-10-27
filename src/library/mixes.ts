// "Made for you": mixes you can open like a playlist.
//   On Repeat   – your most-played songs of the last 4 weeks
//   Daily Mix   – a seed song you love + YouTube Music's mix after it
//                 (fetched once a day, first songs downloaded in advance
//                 so they start instantly and work offline)
//   Rediscover  – favourites you haven't played in 3 weeks
// New listeners get Daily Mixes from their playlists, or from the charts.
import { fetchTrendingSongs } from "../api/itunes";
import { hasNativeAudio, nativeAudio, toNativeTrack } from "../player/native-audio";
import { librarySongs, radioAfter } from "../player/radio";
import { bus, trackRegistry } from "../state";
import type { Item } from "../types";
import { storage } from "../utils";
import { historySize, mainArtist, topSongs, type SongStat } from "./history";

const DAY = 86400000;
const MIX_SIZE = 25;
const CACHE_KEY = "groov:daily-mixes";
const PREFETCH_KEY = "groov:mix-prefetched";
/** Songs per Daily Mix downloaded ahead of time (Android). */
const PREFETCH_PER_MIX = 4;

export interface Mix {
  id: string;
  title: string;
  subtitle: string;
  /** Known songs (On Repeat / Rediscover), or a seed for a Daily Mix. */
  songs?: Item[];
  seed?: Item;
}

const today = () => Math.floor(Date.now() / DAY);

/** Same picks all day, new ones tomorrow. */
function dailyPick<T>(items: T[], salt: number): T | undefined {
  if (!items.length) return undefined;
  return items[(today() * 7 + salt * 3) % items.length];
}

/** One song each from different artists. */
function byDifferentArtists(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const a = mainArtist(i.subtitle).toLowerCase();
    if (seen.has(a)) return false;
    seen.add(a);
    return true;
  });
}

let chartSeeds: Item[] = [];

export function getMixes(): Mix[] {
  const now = Date.now();
  const out: Mix[] = [];
  const month = topSongs(now - 28 * DAY, 60);

  const onRepeat = month.filter((s) => s.plays >= 2).slice(0, MIX_SIZE);
  if (onRepeat.length >= 3) {
    out.push({ id: "repeat", title: "On Repeat", subtitle: "Songs you can't stop playing", songs: onRepeat.map((s) => s.item) });
  }

  // Seeds: your top songs; else your playlists; else today's chart.
  const fromHistory = (month.length >= 3 ? month : topSongs(0, 60)).map((s: SongStat) => s.item);
  let seeds = byDifferentArtists(historySize() >= 5 ? fromHistory : []);
  if (seeds.length < 2) seeds = byDifferentArtists([...seeds, ...librarySongs()]);
  if (seeds.length < 2) seeds = byDifferentArtists([...seeds, ...chartSeeds]);
  const top = seeds.slice(0, 8);
  const first = dailyPick(top.slice(0, 4), 1);
  const second = dailyPick(top.slice(4), 2) ?? dailyPick(top.filter((s) => s !== first), 5);
  [first, second].forEach((seed, i) => {
    if (!seed) return;
    out.push({ id: `daily${i + 1}`, title: `Daily Mix ${i + 1}`, subtitle: `${mainArtist(seed.subtitle)} and more`, seed });
  });

  const rediscover = topSongs(0, 300)
    .filter((s) => s.lastPlayed < now - 21 * DAY && s.plays >= 2)
    .slice(0, MIX_SIZE);
  if (rediscover.length >= 3) {
    out.push({ id: "rediscover", title: "Rediscover", subtitle: "Old favourites you haven't played lately", songs: rediscover.map((s) => s.item) });
  }
  return out;
}

export function getMix(id: string): Mix | undefined {
  return getMixes().find((m) => m.id === id);
}

// --- Daily Mix songs (fetched once a day per seed) -------------------------------------

type Cache = Record<string, { day: number; songs: Item[] }>;

export function cachedMixSongs(mix: Mix): Item[] | null {
  if (mix.songs) return mix.songs;
  if (!mix.seed) return [];
  const hit = storage.get<Cache>(CACHE_KEY, {})[mix.seed.id];
  return hit && hit.day === today() ? [mix.seed, ...hit.songs] : null;
}

const inflight = new Map<string, Promise<Item[]>>();

export async function loadMixSongs(mix: Mix): Promise<Item[]> {
  const cached = cachedMixSongs(mix);
  if (cached) return cached;
  const seed = mix.seed!;
  let job = inflight.get(seed.id);
  if (!job) {
    job = (async () => {
      const after = (await radioAfter(seed)).filter((i) => i.id !== seed.id).slice(0, MIX_SIZE - 1);
      const cache = storage.get<Cache>(CACHE_KEY, {});
      // Keep only today's mixes.
      for (const k of Object.keys(cache)) if (cache[k].day !== today()) delete cache[k];
      if (after.length) cache[seed.id] = { day: today(), songs: after };
      storage.set(CACHE_KEY, cache);
      return [seed, ...after];
    })().finally(() => inflight.delete(seed.id));
    inflight.set(seed.id, job);
  }
  const songs = await job;
  songs.forEach((s) => trackRegistry.set(s.id, s));
  return songs;
}

// --- Getting today's mixes ready in the background -------------------------------------

let warming = false;

/** Fetch today's Daily Mixes and download their first songs (once a day). */
export async function warmMixes(): Promise<void> {
  if (warming) return;
  warming = true;
  try {
    if (!chartSeeds.length && historySize() < 5 && librarySongs().length < 2) {
      chartSeeds = await fetchTrendingSongs(20).catch(() => []);
      if (chartSeeds.length) bus.emit("mixchange", undefined);
    }
    const daily = getMixes().filter((m) => m.seed);
    let changed = false;
    for (const mix of daily) {
      if (cachedMixSongs(mix)) continue;
      try {
        await loadMixSongs(mix);
        changed = true;
      } catch {
        // offline: try again next time Home opens
      }
    }
    if (changed) bus.emit("mixchange", undefined);

    if (!hasNativeAudio) return;
    const done = storage.get<{ day: number; ids: string[] }>(PREFETCH_KEY, { day: 0, ids: [] });
    const ids = done.day === today() ? done.ids : [];
    for (const mix of daily) {
      const songs = cachedMixSongs(mix) ?? [];
      for (const song of songs.slice(0, PREFETCH_PER_MIX)) {
        if (ids.includes(song.id)) continue;
        // One at a time, so it doesn't slow down what you're playing.
        await nativeAudio.prefetch({ ...toNativeTrack(song), wait: true }).catch(() => undefined);
        ids.push(song.id);
        storage.set(PREFETCH_KEY, { day: today(), ids });
      }
    }
  } finally {
    warming = false;
  }
}
