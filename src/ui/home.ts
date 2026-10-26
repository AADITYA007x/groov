// Home feed: the live top-songs chart plus heuristic "Recommended for you"
// (more from artists/genres already in your playlists).
import { fetchArtistTracks, fetchCategory, fetchTrendingSongs } from "../api/itunes";
import { OVERVIEW_LIMIT } from "../config";
import { getPlaylists } from "../library/playlists";
import { $ } from "../utils";
import { cardMarkup, sectionMarkup } from "./cards";

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
    await Promise.all([renderTrending(), renderRecommendations()]);
  } finally {
    loading = false;
  }
}
