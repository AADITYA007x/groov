// Home feed: "Made for you" mixes and recently played (from what you listen
// to), the live top-songs chart, and "Recommended for you" (more from
// artists/genres already in your playlists).
import { fetchArtistTracks, fetchCategory, fetchTrendingSongs } from "../api/itunes";
import { OVERVIEW_LIMIT } from "../config";
import { mainArtist, recentlyPlayed, topSongs, type SongStat } from "../library/history";
import { getPlaylists } from "../library/playlists";
import { playTrack, setQueue } from "../player/player";
import { startRadio } from "../player/radio";
import { bus, trackRegistry } from "../state";
import type { Item } from "../types";
import { $, escapeHtml } from "../utils";
import { cardMarkup, sectionMarkup } from "./cards";

// --- Made for you -------------------------------------------------------------------

const DAY = 86400000;
const madeSection = $("made-for-you-section");
const madeRow = $("made-for-you");
const recentSection = $("recently-played-section");
const recentGrid = $("recently-played-grid");

interface Mix {
  title: string;
  subtitle: string;
  art: (string | null | undefined)[];
  /** Play a fixed list, or start radio from a song. */
  songs?: Item[];
  radioFrom?: Item;
}
let mixes: Mix[] = [];

/** Same picks all day, new ones tomorrow. */
function dailyPick<T>(items: T[], salt: number): T | undefined {
  if (!items.length) return undefined;
  const day = Math.floor(Date.now() / DAY);
  return items[(day * 7 + salt * 3) % items.length];
}

function buildMixes(): Mix[] {
  const now = Date.now();
  const out: Mix[] = [];
  const month = topSongs(now - 28 * DAY, 40);

  const onRepeat = month.filter((s) => s.plays >= 2).slice(0, 25);
  if (onRepeat.length >= 3) {
    out.push({
      title: "On Repeat",
      subtitle: "Songs you can't stop playing",
      art: onRepeat.map((s) => s.item.artwork),
      songs: onRepeat.map((s) => s.item),
    });
  }

  // Daily mixes: radio from one of your top songs, each a different artist.
  const seen = new Set<string>();
  const seeds: SongStat[] = [];
  for (const s of month.length >= 3 ? month : topSongs(0, 40)) {
    const artist = mainArtist(s.item.subtitle).toLowerCase();
    if (seen.has(artist)) continue;
    seen.add(artist);
    seeds.push(s);
  }
  const top = seeds.slice(0, 8);
  const picks = [dailyPick(top.slice(0, 4), 1), dailyPick(top.slice(4), 2) ?? dailyPick(top.slice(1, 4), 5)];
  picks.forEach((seed, i) => {
    if (!seed || (i === 1 && seed === picks[0])) return;
    out.push({
      title: `Daily Mix ${i + 1}`,
      subtitle: `${mainArtist(seed.item.subtitle)} and more`,
      art: [seed.item.artwork],
      radioFrom: seed.item,
    });
  });

  // Rediscover: songs you played a lot, but not in the last 3 weeks.
  const rediscover = topSongs(0, 300)
    .filter((s) => s.lastPlayed < now - 21 * DAY && s.plays >= 2)
    .slice(0, 25);
  if (rediscover.length >= 3) {
    out.push({
      title: "Rediscover",
      subtitle: "Old favourites you haven't played lately",
      art: rediscover.map((s) => s.item.artwork),
      songs: rediscover.map((s) => s.item),
    });
  }
  return out;
}

function mixArt(art: Mix["art"]): string {
  const imgs = art.filter(Boolean).slice(0, 4) as string[];
  if (imgs.length >= 4) {
    return `<div class="mix-art grid">${imgs.map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`).join("")}</div>`;
  }
  return imgs[0]
    ? `<div class="mix-art"><img src="${escapeHtml(imgs[0])}" alt="" loading="lazy" /></div>`
    : `<div class="mix-art art-fallback">🎵</div>`;
}

function renderMadeForYou(): void {
  mixes = buildMixes();
  madeSection.style.display = mixes.length ? "block" : "none";
  madeRow.innerHTML = mixes
    .map(
      (m, i) => `
      <button class="mix-card" data-mix="${i}">
        ${mixArt(m.art)}
        <span class="mix-play">▶</span>
        <span class="mix-title">${m.radioFrom ? "📻 " : ""}${escapeHtml(m.title)}</span>
        <span class="mix-sub">${escapeHtml(m.subtitle)}</span>
      </button>`,
    )
    .join("");

  const recent = recentlyPlayed(6);
  recentSection.style.display = recent.length >= 2 ? "block" : "none";
  recentGrid.innerHTML = recent.map((item) => cardMarkup(item, "tracks")).join("");
}

function playMix(mix: Mix): void {
  if (mix.radioFrom) {
    trackRegistry.set(mix.radioFrom.id, mix.radioFrom);
    void startRadio(mix.radioFrom);
    return;
  }
  const songs = mix.songs ?? [];
  if (!songs.length) return;
  songs.forEach((s) => trackRegistry.set(s.id, s));
  setQueue(
    songs.map((s) => s.id),
    songs[0].id,
  );
  void playTrack(songs[0].id);
  bus.emit("toast", `▶ ${mix.title}`);
}

export function initHome(): void {
  madeRow.addEventListener("click", (e) => {
    const card = (e.target as Element).closest<HTMLElement>("[data-mix]");
    if (card) playMix(mixes[Number(card.dataset.mix)]);
  });
  bus.on("historychange", () => {
    if ($("recent-view").style.display !== "none") renderMadeForYou();
  });
}

const trendingSection = $("trending-section");
const trendingGrid = $("trending-grid");
const recommendationsSection = $("recommendations-section");
const recommendationsContainer = $("recommendations-container");

async function renderTrending(): Promise<void> {
  try {
    const items = await fetchTrendingSongs(OVERVIEW_LIMIT);
    trendingGrid.innerHTML = items.map((item) => cardMarkup(item, "tracks")).join("");
    trendingSection.style.display = items.length ? "block" : "none";
  } catch {
    trendingSection.style.display = "none"; // not a core feature: fail quietly
  }
}

function recommendationSignals() {
  const allTracks = Object.values(getPlaylists()).flatMap((p) => p.tracks);
  const artistCounts = new Map<number, { count: number; name: string }>();
  const genreCounts = new Map<string, number>();
  for (const t of allTracks) {
    if (t.artistId) {
      const current = artistCounts.get(t.artistId) ?? { count: 0, name: t.subtitle };
      current.count += 1;
      artistCounts.set(t.artistId, current);
    }
    if (t.genre) genreCounts.set(t.genre, (genreCounts.get(t.genre) ?? 0) + 1);
  }
  return { allTracks, artistCounts, genreCounts };
}

async function renderRecommendations(): Promise<void> {
  const { allTracks, artistCounts, genreCounts } = recommendationSignals();
  recommendationsSection.style.display = "block";

  if (!allTracks.length) {
    recommendationsContainer.innerHTML = `<p class="muted">Add a few songs to a playlist and recommendations based on them will show up here.</p>`;
    return;
  }

  const savedIds = new Set(allTracks.map((t) => t.id));
  const fresh = <T extends { id: string }>(items: T[]) =>
    items.filter((i) => !savedIds.has(i.id)).slice(0, OVERVIEW_LIMIT);

  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 2);
  const topGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Run lookups in parallel; one failing shouldn't blank the others.
  const jobs: Promise<string>[] = topArtists.map(async ([artistId, info]) => {
    const items = fresh(await fetchArtistTracks(artistId, OVERVIEW_LIMIT + 4));
    return items.length ? sectionMarkup(`More by ${info.name}`, items) : "";
  });
  if (topGenre) {
    jobs.push(
      (async () => {
        const items = fresh(await fetchCategory(topGenre, "tracks", OVERVIEW_LIMIT + 4));
        return items.length ? sectionMarkup(`Because you like ${topGenre}`, items) : "";
      })(),
    );
  }
  const sections = (await Promise.allSettled(jobs))
    .map((r) => (r.status === "fulfilled" ? r.value : ""))
    .join("");

  recommendationsContainer.innerHTML =
    sections || `<p class="muted">Add a few more songs to your playlists to get recommendations.</p>`;
}

let loading = false;

export async function renderHomeFeed(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    renderMadeForYou();
    await Promise.all([renderTrending(), renderRecommendations()]);
  } finally {
    loading = false;
  }
}
