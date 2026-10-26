// Synced lyrics from lrclib.net: free, no key, CORS-open.
import type { Item, LyricLine, Lyrics } from "../types";

const LRCLIB_API = "https://lrclib.net/api";
const cache = new Map<string, Lyrics | null>(); // track id -> lyrics | null (not found)

export function parseLrc(lrc: string | null | undefined): LyricLine[] | null {
  if (!lrc) return null;
  const lines: LyricLine[] = [];
  const timeTag = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  for (const rawLine of lrc.split("\n")) {
    const matches = [...rawLine.matchAll(timeTag)];
    if (!matches.length) continue;
    const text = rawLine.replace(timeTag, "").trim();
    for (const m of matches) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      lines.push({ time: minutes * 60 + seconds + ms / 1000, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.length ? lines : null;
}

interface LrclibRecord {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function fetchLyrics(item: Item): Promise<Lyrics | null> {
  if (cache.has(item.id)) return cache.get(item.id) ?? null;

  const params = new URLSearchParams({ track_name: item.name || "", artist_name: item.subtitle || "" });
  // Exact match first, then the fuzzier search endpoint.
  const data =
    (await getJson<LrclibRecord>(`${LRCLIB_API}/get?${params}`)) ??
    (await getJson<LrclibRecord[]>(`${LRCLIB_API}/search?${params}`))?.[0] ??
    null;

  const parsed = data ? { plain: data.plainLyrics || "", synced: parseLrc(data.syncedLyrics) } : null;
  cache.set(item.id, parsed);
  return parsed;
}
