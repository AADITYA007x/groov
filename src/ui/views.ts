// Navigation between the search/home view and playlist views, plus the
// sidebar playlist list.
import { deletePlaylist, getPlaylists, removeTrackFromPlaylist, createPlaylist } from "../library/playlists";
import { bus } from "../state";
import { $ } from "../utils";
import { playlistRowMarkup } from "./cards";
import { renderHomeFeed } from "./home";
import { closeSidebar } from "./layout";

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

/** "search" or a playlist id. */
let currentView = "search";

export type SearchSubview = "recent" | "results" | "loading";

export function showView(view: SearchSubview): void {
  if (currentView !== "search") {
    currentView = "search";
    navSearchBtn.classList.add("active");
    renderPlaylistNav();
  }
  playlistViewEl.style.display = "none";
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

  for (const id of ids) {
    const btn = document.createElement("button");
    btn.className = `playlist-nav-item${currentView === id ? " active" : ""}`;
    btn.dataset.id = id;
    btn.textContent = playlists[id].name;
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
  playlistViewTitle.textContent = playlist.name;
  playlistEmptyEl.style.display = playlist.tracks.length ? "none" : "block";
  playlistTrackListEl.innerHTML = playlist.tracks.map((item) => playlistRowMarkup(id, item)).join("");
}

export function navigateToPlaylist(id: string): void {
  currentView = id;
  recentView.style.display = "none";
  resultsView.style.display = "none";
  loadingView.style.display = "none";
  playlistViewEl.style.display = "block";
  navSearchBtn.classList.remove("active");
  renderPlaylistNav();
  renderPlaylistView(id);
}

export function navigateToSearch(): void {
  currentView = "search";
  playlistViewEl.style.display = "none";
  navSearchBtn.classList.add("active");
  renderPlaylistNav();
  showView(searchInput.value.trim() ? "results" : "recent");
}

export function initViews(): void {
  playlistTrackListEl.addEventListener("click", (e) => {
    const removeBtn = (e.target as Element).closest<HTMLElement>(".playlist-row-remove");
    if (!removeBtn) return;
    removeTrackFromPlaylist(removeBtn.dataset.playlist!, removeBtn.dataset.track!);
  });

  navSearchBtn.addEventListener("click", () => {
    navigateToSearch();
    closeSidebar();
  });

  $("create-playlist").addEventListener("click", () => {
    const name = prompt("Playlist name");
    if (name === null) return;
    navigateToPlaylist(createPlaylist(name || "New Playlist"));
  });

  $("delete-playlist-btn").addEventListener("click", () => {
    if (currentView === "search") return;
    const name = getPlaylists()[currentView]?.name || "this playlist";
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    deletePlaylist(currentView);
    navigateToSearch();
  });

  bus.on("playlistschange", () => {
    renderPlaylistNav();
    if (currentView !== "search") renderPlaylistView(currentView);
  });

  renderPlaylistNav();
}
