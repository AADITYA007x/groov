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
      genre: raw.primaryGenreName,
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
    };
  }
  return {
    id: `artist-${raw.artistId}`,
    name: raw.artistName ?? "",
    subtitle: raw.primaryGenreName ? `${raw.primaryGenreName} artist` : "Artist",
    artwork: null,
    externalUrl: raw.artistLinkUrl ?? null,
    topSubtitle: "Artist",
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

export async function searchCatalog(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const categories = Object.keys(ENTITY_BY_CATEGORY) as Category[];
  const settled = await Promise.allSettled(
    categories.map((category) => fetchCategory(query, category, limit, signal)),
  );

  const matches: SearchResult["matches"] = {};
  let best: SearchResult["best"] = null;

  settled.forEach((outcome, i) => {
    const category = categories[i];
    const items = outcome.status === "fulfilled" ? outcome.value : [];
    matches[category] = items;
    if (items.length) {
      const score = scoreMatch(items[0].name, query);
      if (!best || score > best.score) best = { item: items[0], score, category };
    }
  });

  // Every category failing means the network is down, not "no results".
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (settled.every((s) => s.status === "rejected")) throw new Error("Catalog unreachable");

  return { matches, best };
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

export async function fetchTrendingSongs(limit: number): Promise<Item[]> {
  const response = await fetch(`https://itunes.apple.com/us/rss/topsongs/limit=${limit}/json`);
  if (!response.ok) throw new Error(`Charts feed error: ${response.status}`);
  const data = (await response.json()) as { feed?: { entry?: ChartEntry[] } };
  return (data.feed?.entry || []).map(normalizeChartEntry);
}
