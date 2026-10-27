// Navigation between the search/home view and playlist views, plus the
// sidebar playlist list.
import { deletePlaylist, getPlaylists, isOwner, removeTrackFromPlaylist, createPlaylist } from "../library/playlists";
import { getAccount } from "../cloud/session";
import { sharePlaylist } from "../cloud/sync";
import { playPlaylist } from "../player/radio";
import { isShuffleOn, toggleShuffle } from "../player/player";
import { findArtistId } from "../api/itunes";
import { renderDetail } from "./detail";
import { isLikedPlaylist } from "../library/liked";
import { renderStats } from "./stats";

function renderShuffleToggle(): void {
  const btn = $("shuffle-playlist-btn");
  const on = isShuffleOn();
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "🔀 Shuffle on" : "🔀 Shuffle";
}
import type { Playlist } from "../types";
import { bus } from "../state";
import { $ } from "../utils";
import { playlistRowMarkup } from "./cards";
import { renderHomeFeed } from "./home";
import { closeSidebar } from "./layout";
import { pushStep } from "./back";

const searchInput = $<HTMLInputElement>("search-input");
const recentView = $("recent-view");
const resultsView = $("results-view");
const loadingView = $("loading-view");
const navSearchBtn = $("nav-search");
const playlistNavList = $("playlist-nav-list");
const playlistViewEl = $("playlist-view");
const playlistViewTitle = $("playlist-view-title");
const playlistTrackListEl = $("playlist-track-list");
const playlistEmptyEl = $("playlist-empty");
const playlistMetaEl = $("playlist-meta");
const shareBtn = $("share-playlist-btn");
const deleteBtn = $("delete-playlist-btn");
const detailViewEl = $("detail-view");
const statsViewEl = $("stats-view");
const navStatsBtn = $("nav-stats");

/** "search", "stats", a playlist id, "artist:<id>:<name>" or "album:<id>". */
let currentView = "search";
let viewStepCount = 0;

const isDetail = (view: string) => /^(artist|album|mix):/.test(view);

/** Back from here returns to the view we're leaving. */
function recordViewChange(): void {
  const previous = currentView;
  pushStep(`view-${++viewStepCount}`, () => navigateTo(previous, false));
}

export function navigateTo(view: string, record = true): void {
  if (view === "search") navigateToSearch(record);
  else if (view === "stats") navigateToStats(record);
  else if (isDetail(view)) navigateToDetail(view, record);
  else navigateToPlaylist(view, record);
}

function hideMainSections(): void {
  recentView.style.display = "none";
  resultsView.style.display = "none";
  loadingView.style.display = "none";
  playlistViewEl.style.display = "none";
  detailViewEl.style.display = "none";
  statsViewEl.style.display = "none";
  navStatsBtn.classList.remove("active");
}

export function navigateToStats(record = true): void {
  if (record && currentView !== "stats") recordViewChange();
  currentView = "stats";
  hideMainSections();
  statsViewEl.style.display = "block";
  navSearchBtn.classList.remove("active");
  navStatsBtn.classList.add("active");
  renderPlaylistNav();
  renderStats();
  window.scrollTo({ top: 0 });
}

function navigateToDetail(view: string, record = true): void {
  if (record && currentView !== view) recordViewChange();
  currentView = view;
  hideMainSections();
  detailViewEl.style.display = "block";
  navSearchBtn.classList.remove("active");
  renderPlaylistNav();
  renderDetail(view);
  window.scrollTo({ top: 0 });
}

/** Open an artist's page (looks the artist up by name if needed). */
export async function openArtist(artistId: number | null | undefined, name: string): Promise<void> {
  const id = artistId || (await findArtistId(name));
  if (!id) {
    bus.emit("toast", `Couldn't find ${name}`);
    return;
  }
  navigateTo(`artist:${id}:${encodeURIComponent(name)}`);
}

export function openAlbum(collectionId: number): void {
  navigateTo(`album:${collectionId}`);
}

export type SearchSubview = "recent" | "results" | "loading";

export function showView(view: SearchSubview): void {
  if (currentView !== "search") {
    // Typing a search while a playlist is open: back returns to the playlist.
    recordViewChange();
    currentView = "search";
    navSearchBtn.classList.add("active");
    renderPlaylistNav();
  }
  playlistViewEl.style.display = "none";
  detailViewEl.style.display = "none";
  statsViewEl.style.display = "none";
  navStatsBtn.classList.remove("active");
  recentView.style.display = view === "recent" ? "block" : "none";
  resultsView.style.display = view === "results" ? "block" : "none";
  loadingView.style.display = view === "loading" ? "block" : "none";
  if (view === "recent") void renderHomeFeed();
}

export function renderPlaylistNav(): void {
  const playlists = getPlaylists();
  const ids = Object.keys(playlists);
  playlistNavList.innerHTML = "";

  if (!ids.length) {
    playlistNavList.innerHTML = `<div class="playlist-nav-empty">Create a playlist to save songs you find here.</div>`;
    return;
  }

  // Liked Songs first, then the rest in their usual order.
  ids.sort((a, b) => Number(isLikedPlaylist(playlists[b])) - Number(isLikedPlaylist(playlists[a])));
  for (const id of ids) {
    const liked = isLikedPlaylist(playlists[id]);
    const btn = document.createElement("button");
    btn.className = `playlist-nav-item${currentView === id ? " active" : ""}${liked ? " liked" : ""}`;
    btn.dataset.id = id;
    btn.textContent = liked
      ? `❤️ ${playlists[id].name} · ${playlists[id].tracks.length}`
      : (playlists[id].shared ? "👥 " : "") + playlists[id].name;
    btn.addEventListener("click", () => {
      navigateToPlaylist(id);
      closeSidebar();
    });
    playlistNavList.appendChild(btn);
  }
}

function renderPlaylistView(id: string): void {
  const playlist = getPlaylists()[id];
  if (!playlist) {
    navigateToSearch();
    return;
  }
  playlistViewTitle.textContent = isLikedPlaylist(playlist) ? `❤️ ${playlist.name}` : playlist.name;
  renderPlaylistMeta(playlist);
  playlistEmptyEl.style.display = playlist.tracks.length ? "none" : "block";
  const me = getAccount()?.id;
  playlistTrackListEl.innerHTML = playlist.tracks
    .map((item) => {
      const by = playlist.shared ? playlist.addedBy?.[item.id] : undefined;
      return playlistRowMarkup(id, item, by && by.id !== me ? by.name : undefined);
    })
    .join("");
}

/** "Shared with Neha" / "Shared by Neha", Share / Delete / Leave buttons. */
function renderPlaylistMeta(playlist: Playlist): void {
  const owner = isOwner(playlist);
  const me = getAccount()?.id;
  let meta = "";
  if (playlist.shared && owner) {
    const names = (playlist.members ?? []).map((m) => m.name);
    meta = names.length ? `👥 Shared with ${names.join(", ")}` : "";
  } else if (playlist.shared) {
    const others = (playlist.members ?? []).filter((m) => m.id !== me).map((m) => m.name);
    meta = `👥 Shared by ${playlist.ownerName ?? "someone"}` + (others.length ? ` · also ${others.join(", ")}` : "");
  } else if (!playlist.cloud) {
    meta = getAccount() ? "" : "Only on this device · sign in to sync and share";
  }
  playlistMetaEl.textContent = meta;
  playlistMetaEl.style.display = meta ? "block" : "none";
  const liked = isLikedPlaylist(playlist);
  shareBtn.style.display = owner && getAccount() && !liked ? "inline-flex" : "none";
  deleteBtn.style.display = liked ? "none" : "inline-flex";
  const hasSongs = playlist.tracks.length > 0;
  $("play-playlist-btn").style.display = hasSongs ? "inline-flex" : "none";
  $("shuffle-playlist-btn").style.display = playlist.tracks.length > 1 ? "inline-flex" : "none";
  deleteBtn.textContent = owner ? "Delete playlist" : "Leave playlist";
}

export function navigateToPlaylist(id: string, record = true): void {
  if (record && currentView !== id) recordViewChange();
  currentView = id;
  hideMainSections();
  playlistViewEl.style.display = "block";
  navSearchBtn.classList.remove("active");
  renderPlaylistNav();
  renderPlaylistView(id);
}

export function navigateToSearch(record = true): void {
  if (record && currentView !== "search") recordViewChange();
  currentView = "search";
  playlistViewEl.style.display = "none";
  detailViewEl.style.display = "none";
  statsViewEl.style.display = "none";
  navStatsBtn.classList.remove("active");
  navSearchBtn.classList.add("active");
  renderPlaylistNav();
  showView(searchInput.value.trim() ? "results" : "recent");
}

export function initViews(): void {
  // Album and artist cards (and artist links) open their page in the app.
  document.addEventListener("click", (e) => {
    const link = (e.target as Element).closest<HTMLElement>("[data-album], [data-artist]");
    if (!link || (e.target as Element).closest(".play-overlay, .add-overlay")) return;
    e.preventDefault();
    if (link.dataset.album) openAlbum(Number(link.dataset.album));
    else void openArtist(Number(link.dataset.artist), link.dataset.artistName ?? "");
  });

  playlistTrackListEl.addEventListener("click", (e) => {
    const removeBtn = (e.target as Element).closest<HTMLElement>(".playlist-row-remove");
    if (!removeBtn) return;
    removeTrackFromPlaylist(removeBtn.dataset.playlist!, removeBtn.dataset.track!);
  });

  navSearchBtn.addEventListener("click", () => {
    navigateToSearch();
    closeSidebar();
  });
  navStatsBtn.addEventListener("click", () => {
    navigateToStats();
    closeSidebar();
  });

  $("create-playlist").addEventListener("click", () => {
    const name = prompt("Playlist name");
    if (name === null) return;
    navigateToPlaylist(createPlaylist(name || "New Playlist"));
  });

  $("play-playlist-btn").addEventListener("click", () => void playPlaylist(currentView));
  // The same shuffle setting as in Now Playing, not a separate action.
  $("shuffle-playlist-btn").addEventListener("click", () => {
    toggleShuffle();
    bus.emit("toast", isShuffleOn() ? "🔀 Shuffle on" : "Shuffle off");
  });
  bus.on("modechange", renderShuffleToggle);
  renderShuffleToggle();

  shareBtn.addEventListener("click", async () => {
    const playlist = getPlaylists()[currentView];
    if (!playlist) return;
    const email = prompt(`Share "${playlist.name}" with…\nEnter their Groov account email:`);
    if (!email?.trim()) return;
    shareBtn.textContent = "Sharing…";
    try {
      const name = await sharePlaylist(playlist.id, email);
      alert(`Shared with ${name}. They can now add and remove songs.`);
    } catch (err) {
      alert(`Couldn't share: ${(err as Error).message}`);
    } finally {
      shareBtn.textContent = "Share";
    }
  });

  deleteBtn.addEventListener("click", () => {
    if (currentView === "search") return;
    const playlist = getPlaylists()[currentView];
    const name = playlist?.name || "this playlist";
    const question = playlist && !isOwner(playlist)
      ? `Leave "${name}"? It will disappear from your playlists.`
      : playlist?.shared
        ? `Delete "${name}" for everyone it's shared with? This can't be undone.`
        : `Delete "${name}"? This can't be undone.`;
    if (!confirm(question)) return;
    deletePlaylist(currentView);
    navigateToSearch(false);
  });

  const refresh = () => {
    renderPlaylistNav();
    if (currentView !== "search" && !isDetail(currentView)) renderPlaylistView(currentView);
  };
  bus.on("authchange", refresh);
  bus.on("playlistschange", refresh);

  renderPlaylistNav();
}
