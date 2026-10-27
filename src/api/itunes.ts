// iTunes Search API + Apple's public top-songs feed: free, no key, CORS-open.
import type { Category, Item, SearchResult } from "../types";
import { scoreMatch } from "../utils";

const ITUNES_API = "https://itunes.apple.com/search";

export const CATEGORY_LABELS: Record<Category, string> = {
  tracks: "Songs",
  artists: "Artists",
  albums: "Albums",
};

const ENTITY_BY_CATEGORY: Record<Category, string> = {
  tracks: "song",
  artists: "musicArtist",
  albums: "album",
};

// Shape of the iTunes fields we read; the API returns many more.
interface ITunesRaw {
  wrapperType?: string;
  trackId?: number;
  trackName?: string;
  artistId?: number;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  artistLinkUrl?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
}

export function normalizeResult(raw: ITunesRaw, category: Category): Item {
  if (category === "tracks") {
    return {
      id: `song-${raw.trackId}`,
      name: raw.trackName ?? "",
      subtitle: raw.artistName ?? "",
      artwork: raw.artworkUrl100 ?? null,
      previewUrl: raw.previewUrl ?? null,
      externalUrl: raw.trackViewUrl ?? null,
      topSubtitle: `Song · ${raw.artistName ?? ""}`,
      artistId: raw.artistId,
      collectionId: raw.collectionId,
      genre: raw.primaryGenreName,
      durationMs: raw.trackTimeMillis,
    };
  }
  if (category === "albums") {
    const year = raw.releaseDate ? new Date(raw.releaseDate).getFullYear() : "";
    return {
      id: `album-${raw.collectionId}`,
      name: raw.collectionName ?? "",
      subtitle: year ? `${year} · ${raw.artistName ?? ""}` : (raw.artistName ?? ""),
      artwork: raw.artworkUrl100 ?? null,
      externalUrl: raw.collectionViewUrl ?? null,
      topSubtitle: `Album · ${raw.artistName ?? ""}`,
      artistId: raw.artistId,
      collectionId: raw.collectionId,
    };
  }
  return {
    id: `artist-${raw.artistId}`,
    name: raw.artistName ?? "",
    subtitle: raw.primaryGenreName ? `${raw.primaryGenreName} artist` : "Artist",
    artwork: null,
    externalUrl: raw.artistLinkUrl ?? null,
    topSubtitle: "Artist",
    artistId: raw.artistId,
  };
}

export async function fetchCategory(
  term: string,
  category: Category,
  limit: number,
  signal?: AbortSignal,
): Promise<Item[]> {
  const params = new URLSearchParams({
    term,
    media: "music",
    entity: ENTITY_BY_CATEGORY[category],
    limit: String(limit),
  });
  const response = await fetch(`${ITUNES_API}?${params}`, { signal });
  if (!response.ok) throw new Error(`iTunes API error: ${response.status}`);
  const data = (await response.json()) as { results: ITunesRaw[] };
  return data.results.map((r) => normalizeResult(r, category));
}

/** Songs fetched to judge popularity, even though fewer are shown. */
const POPULARITY_SAMPLE = 15;

/**
 * Top result = good name match AND popular. iTunes lists songs roughly by
 * popularity, so a song's rank is its popularity; an artist or album is as
 * popular as the number of top songs that belong to it. So "demons" gives
 * Imagine Dragons' hit, not an unknown artist literally named "Demons",
 * while "imagine dragons" still gives the artist.
 */
export function pickTopResult(
  query: string,
  songs: Item[],
  albums: Item[],
  artists: Item[],
): SearchResult["best"] {
  const MATCH_POINTS = [0, 2, 4, 6]; // none, contains, prefix, exact
  const sample = songs.slice(0, POPULARITY_SAMPLE);
  const songsBy = (pred: (s: Item) => boolean) => sample.filter(pred).length;
  const matchOf = (item: Item, withArtist: boolean) =>
    Math.max(scoreMatch(item.name, query), withArtist ? scoreMatch(`${item.name} ${item.subtitle}`, query) : 0);

  type Candidate = { item: Item; category: Category; score: number };
  const candidates: Candidate[] = [
    ...sample.slice(0, 10).map((item, i) => ({
      item,
      category: "tracks" as const,
      score: MATCH_POINTS[matchOf(item, true)] + (10 - i),
    })),
    ...albums.slice(0, 3).map((item) => ({
      item,
      category: "albums" as const,
      score: MATCH_POINTS[matchOf(item, false)] + 2 * songsBy((s) => s.collectionId === item.collectionId),
    })),
    ...artists.slice(0, 3).map((item, i) => ({
      item,
      category: "artists" as const,
      score: MATCH_POINTS[matchOf(item, false)] + 2 * songsBy((s) => s.artistId === item.artistId) + (i === 0 ? 1 : 0),
    })),
  ];
  // Nothing matching the words at all: still show the most popular song.
  const best = candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || (a.category === "tracks" ? -1 : 1))[0];
  return best ? { item: best.item, category: best.category, score: best.score } : null;
}

export async function searchCatalog(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const [songs, albums, artists] = await Promise.allSettled([
    fetchCategory(query, "tracks", Math.max(limit, POPULARITY_SAMPLE), signal),
    fetchCategory(query, "albums", limit, signal),
    fetchCategory(query, "artists", limit, signal),
  ]);
  // Every category failing means the network is down, not "no results".
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if ([songs, albums, artists].every((s) => s.status === "rejected")) throw new Error("Catalog unreachable");

  const value = (r: PromiseSettledResult<Item[]>) => (r.status === "fulfilled" ? r.value : []);
  const allSongs = value(songs);
  const matches: SearchResult["matches"] = {
    tracks: allSongs.slice(0, limit),
    albums: value(albums),
    artists: value(artists),
  };
  return { matches, best: pickTopResult(query, allSongs, value(albums), value(artists)) };
}

export async function fetchArtistTracks(artistId: number, limit: number): Promise<Item[]> {
  const params = new URLSearchParams({ id: String(artistId), entity: "song", limit: String(limit) });
  const response = await fetch(`https://itunes.apple.com/lookup?${params}`);
  if (!response.ok) throw new Error(`iTunes lookup error: ${response.status}`);
  const data = (await response.json()) as { results: ITunesRaw[] };
  return data.results
    .filter((r) => r.wrapperType === "track")
    .map((r) => normalizeResult(r, "tracks"));
}

// --- Top-songs chart feed ------------------------------------------------

interface Labelled {
  label?: string;
}
interface ChartLink {
  attributes?: { rel?: string; href?: string };
}
interface ChartEntry {
  id?: { attributes?: { "im:id"?: string } };
  "im:name"?: Labelled;
  "im:artist"?: Labelled;
  "im:image"?: Labelled[];
  link?: ChartLink | ChartLink[];
  category?: { attributes?: { label?: string } };
}

function normalizeChartEntry(entry: ChartEntry): Item {
  const images = entry["im:image"] || [];
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
  const previewLink = links.find((l) => l.attributes?.rel === "enclosure");
  const htmlLink = links.find((l) => l.attributes?.rel === "alternate") ?? links[0];
  const artistName = entry["im:artist"]?.label || "";
  return {
    id: `song-${entry.id?.attributes?.["im:id"]}`,
    name: entry["im:name"]?.label || "",
    subtitle: artistName,
    artwork: images[images.length - 1]?.label || null,
    previewUrl: previewLink?.attributes?.href || null,
    externalUrl: htmlLink?.attributes?.href || null,
    topSubtitle: `Song · ${artistName}`,
    genre: entry.category?.attributes?.label,
  };
}

/** Charts for India (the app's listeners); "us" for the US chart. */
export const CHART_COUNTRY = "in";

export async function fetchTrendingSongs(limit: number, country = CHART_COUNTRY): Promise<Item[]> {
  const response = await fetch(`https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/json`);
  if (!response.ok) throw new Error(`Charts feed error: ${response.status}`);
  const data = (await response.json()) as { feed?: { entry?: ChartEntry[] } };
  return (data.feed?.entry || []).map(normalizeChartEntry);
}
