// Search pattern: debounced input, local-storage recent searches, a scored
// "top result" plus per-category sections with "See all" expansion, backed
// by the free iTunes Search API (no key required, CORS-open).
// This is an original implementation inspired by the observed UX pattern
// (not copied code) — see the project README for what was observed vs built.

const ITUNES_API = "https://itunes.apple.com/search";
const RECENT_SEARCHES_KEY = "search-demo:recent-searches";
const DEBOUNCE_MS = 300;
const OVERVIEW_LIMIT = 4;
const SEE_ALL_LIMIT = 12;
const MIN_QUERY_LENGTH = 1; // mirrors the `.length<1` guard found in evidence

const ENTITY_BY_CATEGORY = {
  tracks: "song",
  artists: "musicArtist",
  albums: "album",
};

const searchInput = document.getElementById("search-input");
const clearButton = document.getElementById("clear-input");
const recentView = document.getElementById("recent-view");
const resultsView = document.getElementById("results-view");
const emptyView = document.getElementById("empty-view");
const loadingView = document.getElementById("loading-view");
const recentChips = document.getElementById("recent-chips");
const clearRecentBtn = document.getElementById("clear-recent");
const trendingSection = document.getElementById("trending-section");
const trendingGrid = document.getElementById("trending-grid");
const recommendationsSection = document.getElementById("recommendations-section");
const recommendationsContainer = document.getElementById("recommendations-container");
const topResultEl = document.getElementById("top-result");
const sectionsEl = document.getElementById("category-sections");

const navSearchBtn = document.getElementById("nav-search");
const createPlaylistBtn = document.getElementById("create-playlist");
const playlistNavList = document.getElementById("playlist-nav-list");
const playlistViewEl = document.getElementById("playlist-view");
const playlistViewTitle = document.getElementById("playlist-view-title");
const playlistTrackListEl = document.getElementById("playlist-track-list");
const playlistEmptyEl = document.getElementById("playlist-empty");
const deletePlaylistBtn = document.getElementById("delete-playlist-btn");
const addPopover = document.getElementById("add-to-playlist-popover");

const layoutEl = document.getElementById("layout");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const bgBlurEl = document.getElementById("bg-blur");

function openSidebar() {
  layoutEl.classList.add("sidebar-open");
}
function closeSidebar() {
  layoutEl.classList.remove("sidebar-open");
}
mobileMenuToggle.addEventListener("click", () => {
  layoutEl.classList.toggle("sidebar-open");
});
sidebarBackdrop.addEventListener("click", closeSidebar);

function updateBackgroundArt(url) {
  bgBlurEl.style.backgroundImage = url ? `url("${url}")` : "";
}

const playerBar = document.getElementById("player-bar");
const playerArt = document.getElementById("player-art");
const playerName = document.getElementById("player-name");
const playerArtist = document.getElementById("player-artist");
const playerToggle = document.getElementById("player-toggle");
const playerBarTrack = document.querySelector(".player-bar-track");
const playerBarFill = document.getElementById("player-bar-fill");
const playerTimeElapsed = document.getElementById("player-time-elapsed");
const playerTimeTotal = document.getElementById("player-time-total");

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecentSearch(term) {
  const trimmed = term.trim();
  if (!trimmed) return;
  const current = getRecentSearches().filter(
    (t) => t.toLowerCase() !== trimmed.toLowerCase(),
  );
  current.unshift(trimmed);
  localStorage.setItem(
    RECENT_SEARCHES_KEY,
    JSON.stringify(current.slice(0, 8)),
  );
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
  renderRecentChips();
}

function renderRecentChips() {
  const recents = getRecentSearches();
  recentChips.innerHTML = "";
  clearRecentBtn.style.display = recents.length ? "inline-flex" : "none";
  document.getElementById("recent-empty").style.display = recents.length
    ? "none"
    : "block";

  for (const term of recents) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.innerHTML = `<span>🕘 ${escapeHtml(term)}</span>`;
    chip.addEventListener("click", () => {
      searchInput.value = term;
      runSearch(term);
      searchInput.focus();
    });
    recentChips.appendChild(chip);
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// Scores a result's match quality against the query: exact > prefix > substring.
function scoreMatch(name, query) {
  const n = (name || "").toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

// --- Playback ---------------------------------------------------------
//
// Two interchangeable engines behind one interface:
//  - "audio": the free, always-available 30s iTunes preview clip.
//  - "youtube": full-length audio (as video) via the YouTube IFrame Player,
//    used only when a YOUTUBE_API_KEY is configured (see config.js) and a
//    matching video can be found. Falls back to "audio" on any failure.

const youtubePlayerEl = document.getElementById("youtube-player");
const youtubePlayerWrapEl = document.getElementById("youtube-player-wrap");
const videoExpandBtn = document.getElementById("video-expand-btn");
const videoOverlay = document.getElementById("video-overlay");
const videoCollapseBtn = document.getElementById("video-collapse");
const youtubePlayerExpandedEl = document.getElementById("youtube-player-expanded");
const videoOverlayName = document.getElementById("video-overlay-name");
const videoOverlayArtist = document.getElementById("video-overlay-artist");
const lyricsToggleBtn = document.getElementById("lyrics-toggle-btn");
const lyricsOverlay = document.getElementById("lyrics-overlay");
const lyricsCloseBtn = document.getElementById("lyrics-close");
const lyricsTrackName = document.getElementById("lyrics-track-name");
const lyricsTrackArtist = document.getElementById("lyrics-track-artist");
const lyricsBody = document.getElementById("lyrics-body");
const trackRegistry = new Map(); // id -> item, for play-button lookups
let currentTrackId = null;
let currentYoutubeVideoId = null;
let activeEngine = "audio";
let youtubeProgressTimer = null;
let currentQueue = []; // track ids, built from whichever grid/playlist the user clicked play in
let currentQueueIndex = -1;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setOverlayIcon(id, icon) {
  document
    .querySelectorAll(
      `.play-overlay[data-id="${cssEscape(id)}"], .playlist-row-play[data-id="${cssEscape(id)}"]`,
    )
    .forEach((btn) => {
      btn.textContent = icon;
      btn.setAttribute("aria-label", icon === "⏸" ? "Pause" : "Play");
      btn.classList.toggle("is-playing", icon === "⏸");
    });
}

function cssEscape(id) {
  return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
}

function isTrackPlaying(id) {
  if (currentTrackId !== id) return false;
  if (activeEngine === "youtube") {
    return activeYoutubePlayer?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
  }
  return !audio.paused;
}

// --- iTunes 30s preview engine ------------------------------------------

const audio = new Audio();
audio.preload = "none";

audio.addEventListener("play", () => {
  if (activeEngine === "audio") onPlaybackStarted();
});
audio.addEventListener("pause", () => {
  if (activeEngine === "audio") onPlaybackPaused();
});
audio.addEventListener("ended", () => {
  if (activeEngine === "audio") onPlaybackEnded();
});
audio.addEventListener("loadedmetadata", () => {
  if (activeEngine === "audio" && Number.isFinite(audio.duration)) {
    playerTimeTotal.textContent = formatTime(audio.duration);
  }
});
audio.addEventListener("timeupdate", () => {
  if (activeEngine !== "audio") return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 30;
  updateProgressUI(audio.currentTime, duration);
});

// --- YouTube full-track engine -------------------------------------------

const youtubeIdCache = (() => {
  try {
    return JSON.parse(localStorage.getItem("search-demo:yt-cache") || "{}");
  } catch {
    return {};
  }
})();

function saveYoutubeIdCache() {
  try {
    localStorage.setItem("search-demo:yt-cache", JSON.stringify(youtubeIdCache));
  } catch {
    // storage unavailable or full; cache just won't persist across reloads
  }
}

async function findYoutubeVideoId(item) {
  if (item.id in youtubeIdCache) return youtubeIdCache[item.id];

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoCategoryId: "10", // Music
    maxResults: "1",
    q: `${item.name} ${item.subtitle}`,
    key: YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  const videoId = data.items?.[0]?.id?.videoId || null;

  youtubeIdCache[item.id] = videoId;
  saveYoutubeIdCache();
  return videoId;
}

let youtubeApiReadyPromise = null;

function loadYoutubeIframeApi() {
  if (youtubeApiReadyPromise) return youtubeApiReadyPromise;
  youtubeApiReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return youtubeApiReadyPromise;
}

let youtubePlayerInstance = null;
let youtubePlayerReadyPromise = null;
let expandedPlayerInstance = null;
let expandedPlayerReadyPromise = null;
let activeYoutubePlayer = null; // whichever of the two instances is currently audible
let isVideoExpanded = false;

function getYoutubePlayer() {
  if (youtubePlayerReadyPromise) return youtubePlayerReadyPromise;
  youtubePlayerReadyPromise = loadYoutubeIframeApi().then(
    (YT) =>
      new Promise((resolve) => {
        youtubePlayerInstance = new YT.Player(youtubePlayerEl, {
          height: "54",
          width: "96",
          playerVars: { controls: 1, modestbranding: 1 },
          events: {
            onReady: () => resolve(youtubePlayerInstance),
            onStateChange: onYoutubeStateChange,
          },
        });
      }),
  );
  return youtubePlayerReadyPromise;
}

function onYoutubeStateChange(e) {
  if (activeEngine !== "youtube") return;
  if (e.data === YT.PlayerState.PLAYING) onPlaybackStarted();
  else if (e.data === YT.PlayerState.PAUSED) onPlaybackPaused();
  else if (e.data === YT.PlayerState.ENDED) onPlaybackEnded();
}

function startYoutubeProgressPolling() {
  clearInterval(youtubeProgressTimer);
  youtubeProgressTimer = setInterval(() => {
    if (activeEngine !== "youtube" || !activeYoutubePlayer?.getDuration) return;
    const duration = activeYoutubePlayer.getDuration() || 1;
    updateProgressUI(activeYoutubePlayer.getCurrentTime(), duration);
  }, 250);
}

// --- Full-size video view -------------------------------------------------
//
// A second YT.Player instance in its own overlay, rather than moving the
// mini player's iframe — reparenting a live <iframe> reloads it in most
// WebViews, which would restart playback. Only one instance plays audio at
// a time; expanding/collapsing hands off the current position between them.

function getExpandedYoutubePlayer() {
  if (expandedPlayerReadyPromise) return expandedPlayerReadyPromise;
  expandedPlayerReadyPromise = loadYoutubeIframeApi().then(
    (YT) =>
      new Promise((resolve) => {
        expandedPlayerInstance = new YT.Player(youtubePlayerExpandedEl, {
          height: "100%",
          width: "100%",
          playerVars: { controls: 1, modestbranding: 1 },
          events: {
            onReady: () => resolve(expandedPlayerInstance),
            onStateChange: onYoutubeStateChange,
          },
        });
      }),
  );
  return expandedPlayerReadyPromise;
}

async function expandVideo() {
  if (activeEngine !== "youtube" || !currentYoutubeVideoId || isVideoExpanded) return;
  const resumeTime = youtubePlayerInstance?.getCurrentTime?.() || 0;
  youtubePlayerInstance?.pauseVideo?.();

  videoOverlayName.textContent = playerName.textContent;
  videoOverlayArtist.textContent = playerArtist.textContent;
  videoOverlay.style.display = "flex";
  isVideoExpanded = true;

  const player = await getExpandedYoutubePlayer();
  if (!isVideoExpanded) return; // collapsed again before it finished loading
  activeYoutubePlayer = player;
  player.loadVideoById(currentYoutubeVideoId, resumeTime);
  player.playVideo();
}

function collapseVideo() {
  if (!isVideoExpanded) return;
  isVideoExpanded = false;
  const resumeTime = expandedPlayerInstance?.getCurrentTime?.() || 0;
  expandedPlayerInstance?.pauseVideo?.();
  videoOverlay.style.display = "none";
  activeYoutubePlayer = youtubePlayerInstance;
  if (youtubePlayerInstance) {
    youtubePlayerInstance.seekTo(resumeTime, true);
    youtubePlayerInstance.playVideo();
  }
}

videoExpandBtn.addEventListener("click", expandVideo);
videoCollapseBtn.addEventListener("click", collapseVideo);

// --- Shared player-bar UI + engine dispatch ------------------------------

function onPlaybackStarted() {
  playerToggle.textContent = "⏸";
  playerToggle.setAttribute("aria-label", "Pause");
  if (currentTrackId) setOverlayIcon(currentTrackId, "⏸");
}

function onPlaybackPaused() {
  playerToggle.textContent = "▶";
  playerToggle.setAttribute("aria-label", "Play");
  if (currentTrackId) setOverlayIcon(currentTrackId, "▶");
}

function onPlaybackEnded() {
  onPlaybackPaused();
  clearInterval(youtubeProgressTimer);
  playerBarFill.style.width = "0%";
  playerTimeElapsed.textContent = "0:00";
  playNextInQueue();
}

// Autoplay: continue through whichever grid or playlist the current track
// was started from, in the order it appears there.
async function playNextInQueue() {
  if (currentQueueIndex < 0 || currentQueueIndex >= currentQueue.length - 1) return;
  currentQueueIndex += 1;
  const nextId = currentQueue[currentQueueIndex];
  if (!nextId) return;
  const wasExpanded = isVideoExpanded;
  await playTrack(nextId);
  if (wasExpanded && activeEngine === "youtube") expandVideo();
}

function buildQueueFromContext(btn) {
  const container = btn.closest(".card-grid, .playlist-track-list");
  if (container) {
    const ids = [...container.querySelectorAll(".play-overlay[data-id], .playlist-row-play[data-id]")].map(
      (el) => el.dataset.id,
    );
    currentQueue = ids;
    currentQueueIndex = ids.indexOf(btn.dataset.id);
  } else {
    currentQueue = [btn.dataset.id];
    currentQueueIndex = 0;
  }
}

function updateProgressUI(currentTime, duration) {
  playerBarFill.style.width = `${Math.min(100, (currentTime / duration) * 100)}%`;
  playerTimeElapsed.textContent = formatTime(currentTime);
  playerTimeTotal.textContent = formatTime(duration);
  updateLyricsHighlight(currentTime);
}

// --- Lyrics (lrclib.net: free, no key, CORS-open) -------------------------

const LRCLIB_API = "https://lrclib.net/api";
const lyricsCache = new Map(); // track id -> { plain, synced } | null (not found)
let currentLyrics = null;
let activeLyricLineIndex = -1;

function parseLrc(lrc) {
  if (!lrc) return null;
  const lines = [];
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

async function fetchLyrics(item) {
  if (lyricsCache.has(item.id)) return lyricsCache.get(item.id);

  let data = null;
  const params = new URLSearchParams({ track_name: item.name || "", artist_name: item.subtitle || "" });
  try {
    const res = await fetch(`${LRCLIB_API}/get?${params}`);
    if (res.ok) data = await res.json();
  } catch {
    data = null; // network hiccup: try the fuzzier search endpoint below
  }
  if (!data) {
    try {
      const res = await fetch(`${LRCLIB_API}/search?${params}`);
      if (res.ok) data = (await res.json())?.[0] || null;
    } catch {
      data = null;
    }
  }

  const parsed = data ? { plain: data.plainLyrics || "", synced: parseLrc(data.syncedLyrics) } : null;
  lyricsCache.set(item.id, parsed);
  return parsed;
}

function renderLyricsBody() {
  if (!currentLyrics || (!currentLyrics.plain && !currentLyrics.synced)) {
    lyricsBody.innerHTML = `<p class="lyrics-empty">No lyrics found for this track.</p>`;
    return;
  }
  if (currentLyrics.synced) {
    lyricsBody.innerHTML = currentLyrics.synced
      .map((line, i) => `<div class="lyrics-line" data-index="${i}">${escapeHtml(line.text || "♪")}</div>`)
      .join("");
  } else {
    lyricsBody.innerHTML = `<p>${escapeHtml(currentLyrics.plain).replace(/\n/g, "<br>")}</p>`;
  }
}

async function openLyrics() {
  if (!currentTrackId) return;
  const item = trackRegistry.get(currentTrackId);
  if (!item) return;

  lyricsTrackName.textContent = item.name || "";
  lyricsTrackArtist.textContent = item.subtitle || "";
  lyricsBody.innerHTML = `<p class="lyrics-empty">Loading lyrics…</p>`;
  lyricsOverlay.style.display = "flex";

  const requestedId = currentTrackId;
  const lyrics = await fetchLyrics(item);
  if (currentTrackId !== requestedId || lyricsOverlay.style.display === "none") return;

  currentLyrics = lyrics;
  activeLyricLineIndex = -1;
  renderLyricsBody();
}

function closeLyrics() {
  lyricsOverlay.style.display = "none";
}

function updateLyricsHighlight(currentTime) {
  if (!currentLyrics?.synced || lyricsOverlay.style.display === "none") return;
  let newIndex = -1;
  for (let i = 0; i < currentLyrics.synced.length; i++) {
    if (currentLyrics.synced[i].time <= currentTime) newIndex = i;
    else break;
  }
  if (newIndex === activeLyricLineIndex) return;
  activeLyricLineIndex = newIndex;
  const lines = lyricsBody.querySelectorAll(".lyrics-line");
  lines.forEach((el) => el.classList.remove("active"));
  const activeEl = lines[newIndex];
  if (activeEl) {
    activeEl.classList.add("active");
    activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

lyricsToggleBtn.addEventListener("click", openLyrics);
lyricsCloseBtn.addEventListener("click", closeLyrics);

function stopActiveEngine() {
  audio.pause();
  clearInterval(youtubeProgressTimer);
  if (youtubePlayerInstance?.pauseVideo) youtubePlayerInstance.pauseVideo();
  if (expandedPlayerInstance?.pauseVideo) expandedPlayerInstance.pauseVideo();
  if (isVideoExpanded) {
    isVideoExpanded = false;
    videoOverlay.style.display = "none";
  }
}

async function playTrack(id) {
  const item = trackRegistry.get(id);
  if (!item) return;

  // Same track already loaded: just toggle play/pause on its engine.
  if (currentTrackId === id) {
    togglePlayback();
    return;
  }

  stopActiveEngine();
  if (currentTrackId) setOverlayIcon(currentTrackId, "▶");
  currentTrackId = id;

  playerBar.style.display = "flex";
  document.body.classList.add("has-player");
  playerName.textContent = item.name || "";
  playerArtist.textContent = item.subtitle || "";
  updateBackgroundArt(item.artwork);
  playerBarFill.style.width = "0%";
  playerTimeElapsed.textContent = "0:00";
  playerTimeTotal.textContent = "0:30";
  currentLyrics = null;
  activeLyricLineIndex = -1;
  if (lyricsOverlay.style.display !== "none") openLyrics();

  let youtubeId = null;
  if (YOUTUBE_API_KEY) {
    try {
      youtubeId = await findYoutubeVideoId(item);
    } catch {
      youtubeId = null; // network/quota error: fall back to the preview below
    }
  }

  if (currentTrackId !== id) return; // superseded by another click meanwhile

  if (youtubeId) {
    activeEngine = "youtube";
    currentYoutubeVideoId = youtubeId;
    playerArt.style.display = "none";
    youtubePlayerWrapEl.style.display = "block";
    const player = await getYoutubePlayer();
    if (currentTrackId !== id) return;
    player.loadVideoById(youtubeId);
    player.playVideo();
    activeYoutubePlayer = player;
    startYoutubeProgressPolling();
  } else if (item.previewUrl) {
    activeEngine = "audio";
    currentYoutubeVideoId = null;
    youtubePlayerWrapEl.style.display = "none";
    playerArt.style.display = "block";
    playerArt.src = item.artwork || "";
    audio.src = item.previewUrl;
    audio.currentTime = 0;
    audio.play();
  }
}

function togglePlayback() {
  if (activeEngine === "youtube" && activeYoutubePlayer) {
    const state = activeYoutubePlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) activeYoutubePlayer.pauseVideo();
    else activeYoutubePlayer.playVideo();
  } else {
    if (audio.paused) audio.play();
    else audio.pause();
  }
}

playerToggle.addEventListener("click", () => {
  if (currentTrackId) togglePlayback();
});

playerBarTrack.addEventListener("click", (e) => {
  if (!currentTrackId) return;
  const rect = playerBarTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  if (activeEngine === "youtube" && activeYoutubePlayer) {
    activeYoutubePlayer.seekTo(ratio * activeYoutubePlayer.getDuration(), true);
  } else if (Number.isFinite(audio.duration)) {
    audio.currentTime = ratio * audio.duration;
  }
});

// Event delegation: play-overlay / playlist-row-play buttons are re-created
// on every render.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".play-overlay, .playlist-row-play");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  buildQueueFromContext(btn);
  playTrack(btn.dataset.id);
});

// --- Playlists ------------------------------------------------------------
//
// Stored as full track snapshots (not just ids) so a saved playlist stays
// playable after a reload, independent of whether that track still shows up
// in trackRegistry from a live search.

const PLAYLISTS_KEY = "search-demo:playlists";
let currentView = "search"; // "search" or a playlist id

function getPlaylists() {
  try {
    return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePlaylists(playlists) {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch {
    // storage unavailable or full; changes just won't persist across reloads
  }
}

function createPlaylist(name) {
  const playlists = getPlaylists();
  const id = `playlist-${Date.now()}`;
  playlists[id] = { id, name: name.trim() || "New Playlist", tracks: [] };
  savePlaylists(playlists);
  renderPlaylistNav();
  return id;
}

function deletePlaylist(id) {
  const playlists = getPlaylists();
  delete playlists[id];
  savePlaylists(playlists);
  renderPlaylistNav();
}

function addTrackToPlaylist(playlistId, item) {
  const playlists = getPlaylists();
  const playlist = playlists[playlistId];
  if (!playlist || playlist.tracks.some((t) => t.id === item.id)) return;
  playlist.tracks.push({ ...item });
  savePlaylists(playlists);
  if (currentView === playlistId) renderPlaylistView(playlistId);
}

function removeTrackFromPlaylist(playlistId, trackId) {
  const playlists = getPlaylists();
  const playlist = playlists[playlistId];
  if (!playlist) return;
  playlist.tracks = playlist.tracks.filter((t) => t.id !== trackId);
  savePlaylists(playlists);
  if (currentView === playlistId) renderPlaylistView(playlistId);
}

function renderPlaylistNav() {
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

function playlistRowMarkup(playlistId, item) {
  const isPlaying = isTrackPlaying(item.id);
  trackRegistry.set(item.id, item);
  return `
    <div class="playlist-row">
      <div class="playlist-row-art-wrap">
        ${
          item.artwork
            ? `<img class="playlist-row-art" src="${item.artwork}" alt="" />`
            : `<div class="playlist-row-art art-fallback">🎵</div>`
        }
        <button class="playlist-row-play${isPlaying ? " is-playing" : ""}" data-id="${escapeHtml(item.id)}" aria-label="${isPlaying ? "Pause" : "Play"}">${isPlaying ? "⏸" : "▶"}</button>
      </div>
      <div class="playlist-row-info">
        <div class="playlist-row-name">${escapeHtml(item.name || "")}</div>
        <div class="playlist-row-subtitle">${escapeHtml(item.subtitle || "")}</div>
      </div>
      <button class="playlist-row-remove" data-playlist="${escapeHtml(playlistId)}" data-track="${escapeHtml(item.id)}" aria-label="Remove from playlist">✕</button>
    </div>
  `;
}

function renderPlaylistView(id) {
  const playlists = getPlaylists();
  const playlist = playlists[id];
  if (!playlist) {
    navigateToSearch();
    return;
  }
  playlistViewTitle.textContent = playlist.name;
  playlistEmptyEl.style.display = playlist.tracks.length ? "none" : "block";
  playlistTrackListEl.innerHTML = playlist.tracks
    .map((item) => playlistRowMarkup(id, item))
    .join("");
}

function navigateToPlaylist(id) {
  currentView = id;
  recentView.style.display = "none";
  resultsView.style.display = "none";
  loadingView.style.display = "none";
  playlistViewEl.style.display = "block";
  navSearchBtn.classList.remove("active");
  renderPlaylistNav();
  renderPlaylistView(id);
}

function navigateToSearch() {
  currentView = "search";
  playlistViewEl.style.display = "none";
  navSearchBtn.classList.add("active");
  renderPlaylistNav();
  showView(searchInput.value.trim() ? "results" : "recent");
}

playlistTrackListEl.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".playlist-row-remove");
  if (!removeBtn) return;
  removeTrackFromPlaylist(removeBtn.dataset.playlist, removeBtn.dataset.track);
});

navSearchBtn.addEventListener("click", () => {
  navigateToSearch();
  closeSidebar();
});

createPlaylistBtn.addEventListener("click", () => {
  const name = prompt("Playlist name");
  if (name === null) return;
  const id = createPlaylist(name || "New Playlist");
  navigateToPlaylist(id);
});

deletePlaylistBtn.addEventListener("click", () => {
  if (currentView === "search") return;
  const playlists = getPlaylists();
  const name = playlists[currentView]?.name || "this playlist";
  if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
  deletePlaylist(currentView);
  navigateToSearch();
});

// --- Add-to-playlist popover -----------------------------------------------

function openAddToPlaylistPopover(trackId, anchorEl) {
  const item = trackRegistry.get(trackId);
  if (!item) return;
  const playlists = getPlaylists();
  const ids = Object.keys(playlists);

  let html = "";
  if (!ids.length) {
    html += `<div class="playlist-nav-empty">No playlists yet — create one below.</div>`;
  } else {
    for (const id of ids) {
      const checked = playlists[id].tracks.some((t) => t.id === trackId);
      html += `<button class="popover-item${checked ? " checked" : ""}" data-playlist="${escapeHtml(id)}">${escapeHtml(playlists[id].name)}</button>`;
    }
  }
  html += `<div class="popover-divider"></div>`;
  html += `
    <form class="popover-new-form">
      <input type="text" placeholder="New playlist name" maxlength="60" autocomplete="off" />
      <button type="submit">Create</button>
    </form>
  `;
  addPopover.innerHTML = html;

  const rect = anchorEl.getBoundingClientRect();
  addPopover.style.display = "block";
  const popoverWidth = addPopover.offsetWidth || 220;
  addPopover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 200)}px`;
  addPopover.style.left = `${Math.min(rect.left, window.innerWidth - popoverWidth - 16)}px`;

  addPopover.querySelectorAll(".popover-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.playlist;
      if (btn.classList.contains("checked")) removeTrackFromPlaylist(pid, trackId);
      else addTrackToPlaylist(pid, item);
      closeAddToPlaylistPopover();
    });
  });

  addPopover.querySelector(".popover-new-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = e.target.querySelector("input");
    const name = input.value.trim();
    if (!name) return;
    const newId = createPlaylist(name);
    addTrackToPlaylist(newId, item);
    closeAddToPlaylistPopover();
  });
}

function closeAddToPlaylistPopover() {
  addPopover.style.display = "none";
  addPopover.innerHTML = "";
}

document.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".add-overlay");
  if (addBtn) {
    e.preventDefault();
    e.stopPropagation();
    openAddToPlaylistPopover(addBtn.dataset.id, addBtn);
    return;
  }
  if (addPopover.style.display !== "none" && !addPopover.contains(e.target)) {
    closeAddToPlaylistPopover();
  }
});

// --- iTunes Search API ---------------------------------------------------

function normalizeResult(raw, category) {
  if (category === "tracks") {
    return {
      id: `song-${raw.trackId}`,
      name: raw.trackName,
      subtitle: raw.artistName,
      artwork: raw.artworkUrl100,
      previewUrl: raw.previewUrl,
      externalUrl: raw.trackViewUrl,
      topSubtitle: `Song · ${raw.artistName}`,
      artistId: raw.artistId,
      genre: raw.primaryGenreName,
    };
  }
  if (category === "albums") {
    const year = raw.releaseDate ? new Date(raw.releaseDate).getFullYear() : "";
    return {
      id: `album-${raw.collectionId}`,
      name: raw.collectionName,
      subtitle: year ? `${year} · ${raw.artistName}` : raw.artistName,
      artwork: raw.artworkUrl100,
      externalUrl: raw.collectionViewUrl,
      topSubtitle: `Album · ${raw.artistName}`,
    };
  }
  // artists
  return {
    id: `artist-${raw.artistId}`,
    name: raw.artistName,
    subtitle: raw.primaryGenreName ? `${raw.primaryGenreName} artist` : "Artist",
    artwork: null,
    externalUrl: raw.artistLinkUrl,
    topSubtitle: "Artist",
  };
}

async function fetchCategory(term, category, limit, signal) {
  const params = new URLSearchParams({
    term,
    media: "music",
    entity: ENTITY_BY_CATEGORY[category],
    limit: String(limit),
  });
  const response = await fetch(`${ITUNES_API}?${params}`, { signal });
  if (!response.ok) throw new Error(`iTunes API error: ${response.status}`);
  const data = await response.json();
  return data.results.map((r) => normalizeResult(r, category));
}

async function searchCatalog(query, limit, signal) {
  const categories = Object.keys(ENTITY_BY_CATEGORY);
  const settled = await Promise.allSettled(
    categories.map((category) => fetchCategory(query, category, limit, signal)),
  );

  const matches = {};
  let best = null;

  settled.forEach((outcome, i) => {
    const category = categories[i];
    const items = outcome.status === "fulfilled" ? outcome.value : [];
    matches[category] = items;
    if (items.length) {
      const score = scoreMatch(items[0].name, query);
      if (!best || score > best.score) {
        best = { item: items[0], score, category };
      }
    }
  });

  return { matches, best };
}

// --- Trending (Apple's public top-songs chart feed; free, no key, CORS-open,
// same itunes.apple.com host as search) -----------------------------------

async function fetchTrendingSongs(limit) {
  const response = await fetch(`https://itunes.apple.com/us/rss/topsongs/limit=${limit}/json`);
  if (!response.ok) throw new Error(`Charts feed error: ${response.status}`);
  const data = await response.json();
  return (data.feed?.entry || []).map(normalizeChartEntry);
}

function normalizeChartEntry(entry) {
  const images = entry["im:image"] || [];
  const previewLink = (entry.link || []).find((l) => l.attributes?.rel === "enclosure");
  const htmlLink = Array.isArray(entry.link)
    ? entry.link.find((l) => l.attributes?.rel === "alternate")
    : entry.link;
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

async function renderTrending() {
  let items;
  try {
    items = await fetchTrendingSongs(OVERVIEW_LIMIT);
  } catch {
    trendingSection.style.display = "none"; // chart feed hiccup: fail quiet, not a core feature
    return;
  }
  trendingGrid.innerHTML = items.map((item) => cardMarkup(item, "tracks")).join("");
  trendingSection.style.display = items.length ? "block" : "none";
  resolveTrackLinks(trendingGrid);
}

// --- Recommended for you (heuristic: more from artists/genres already in
// your playlists, via iTunes — not Spotify's actual ML ranking, see README) -

async function fetchArtistTracks(artistId, limit) {
  const params = new URLSearchParams({ id: String(artistId), entity: "song", limit: String(limit) });
  const response = await fetch(`https://itunes.apple.com/lookup?${params}`);
  if (!response.ok) throw new Error(`iTunes lookup error: ${response.status}`);
  const data = await response.json();
  return data.results
    .filter((r) => r.wrapperType === "track")
    .map((r) => normalizeResult(r, "tracks"));
}

function recommendationSignals() {
  const playlists = getPlaylists();
  const allTracks = Object.values(playlists).flatMap((p) => p.tracks);
  const artistCounts = new Map(); // artistId -> { count, name }
  const genreCounts = new Map(); // genre -> count

  for (const t of allTracks) {
    if (t.artistId) {
      const current = artistCounts.get(t.artistId) || { count: 0, name: t.subtitle };
      current.count += 1;
      artistCounts.set(t.artistId, current);
    }
    if (t.genre) genreCounts.set(t.genre, (genreCounts.get(t.genre) || 0) + 1);
  }

  return { allTracks, artistCounts, genreCounts };
}

function recommendationSectionMarkup(title, items) {
  return `
    <div class="category-section">
      <h2 class="section-title">${escapeHtml(title)}</h2>
      <div class="card-grid">${items.map((item) => cardMarkup(item, "tracks")).join("")}</div>
    </div>
  `;
}

async function renderRecommendations() {
  const { allTracks, artistCounts, genreCounts } = recommendationSignals();

  if (!allTracks.length) {
    recommendationsContainer.innerHTML = `<p class="muted">Add a few songs to a playlist and recommendations based on them will show up here.</p>`;
    recommendationsSection.style.display = "block";
    return;
  }

  const savedIds = new Set(allTracks.map((t) => t.id));
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 2);
  const topGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const sections = [];

  for (const [artistId, info] of topArtists) {
    try {
      const items = (await fetchArtistTracks(artistId, OVERVIEW_LIMIT + 4))
        .filter((i) => !savedIds.has(i.id))
        .slice(0, OVERVIEW_LIMIT);
      if (items.length) sections.push(recommendationSectionMarkup(`More by ${info.name}`, items));
    } catch {
      // one artist lookup failing shouldn't blank the whole recommendations section
    }
  }

  if (topGenre) {
    try {
      const items = (await fetchCategory(topGenre, "tracks", OVERVIEW_LIMIT + 4))
        .filter((i) => !savedIds.has(i.id))
        .slice(0, OVERVIEW_LIMIT);
      if (items.length) sections.push(recommendationSectionMarkup(`Because you like ${topGenre}`, items));
    } catch {
      // same here
    }
  }

  recommendationsContainer.innerHTML =
    sections.join("") ||
    `<p class="muted">Add a few more songs to your playlists to get recommendations.</p>`;
  recommendationsSection.style.display = "block";
  resolveTrackLinks(recommendationsContainer);
}

// --- Rendering -------------------------------------------------------------

function artMarkup(item, category, sizeClass) {
  const roundClass = category === "artists" ? "round" : "";
  if (item.artwork) {
    return `<img class="art ${sizeClass} ${roundClass}" src="${item.artwork}" alt="" loading="lazy" />`;
  }
  const icon = category === "tracks" ? "🎵" : category === "albums" ? "💿" : "🧑‍🎤";
  return `<div class="art ${sizeClass} ${roundClass} art-fallback">${icon}</div>`;
}

function trackButtonsMarkup(item, category) {
  if (category !== "tracks") return "";
  trackRegistry.set(item.id, item);
  let html = "";
  if (item.previewUrl) {
    const isPlaying = isTrackPlaying(item.id);
    html += `<button class="play-overlay${isPlaying ? " is-playing" : ""}" data-id="${escapeHtml(item.id)}" aria-label="${isPlaying ? "Pause" : "Play"}">${isPlaying ? "⏸" : "▶"}</button>`;
  }
  html += `<button class="add-overlay" data-id="${escapeHtml(item.id)}" aria-label="Add to playlist">+</button>`;
  return html;
}

function cardMarkup(item, category) {
  const idAttr = category === "tracks" ? ` data-id="${escapeHtml(item.id)}"` : "";
  return `
    <a class="card" href="${trackLinkUrl(item, category)}" target="_blank" rel="noopener noreferrer"${idAttr}>
      <div class="card-art-wrap">
        ${artMarkup(item, category, "")}
        ${trackButtonsMarkup(item, category)}
      </div>
      <div class="card-title">${escapeHtml(item.name || "")}</div>
      <div class="card-subtitle">${escapeHtml(item.subtitle || "")}</div>
    </a>
  `;
}

// --- Prefer a YouTube link over the Apple Music preview link -------------
//
// Cards always render first with the iTunes/Apple Music link (instant,
// no network round trip). If a YouTube match is already cached for this
// track, use that instead; otherwise kick off a lookup in the background
// and swap the href in once it resolves, so Apple Music is never shown
// for a track YouTube has.

function trackLinkUrl(item, category) {
  if (category === "tracks" && YOUTUBE_API_KEY) {
    const cachedId = youtubeIdCache[item.id];
    if (cachedId) return `https://www.youtube.com/watch?v=${cachedId}`;
  }
  return item.externalUrl || "#";
}

function resolveTrackLinks(container) {
  if (!YOUTUBE_API_KEY) return;
  container.querySelectorAll('a.card[data-id], a.top-result-card[data-id]').forEach((a) => {
    const item = trackRegistry.get(a.dataset.id);
    if (!item || a.dataset.id in youtubeIdCache) return;
    findYoutubeVideoId(item)
      .then((ytId) => {
        if (ytId) a.href = `https://www.youtube.com/watch?v=${ytId}`;
      })
      .catch(() => {
        // lookup failed; leave the existing Apple Music link in place
      });
  });
}

function renderTopResult(best) {
  if (!best) {
    topResultEl.innerHTML = "";
    topResultEl.style.display = "none";
    return;
  }
  topResultEl.style.display = "block";
  const { item, category } = best;
  const idAttr = category === "tracks" ? ` data-id="${escapeHtml(item.id)}"` : "";
  topResultEl.innerHTML = `
    <h2 class="section-title">Top result</h2>
    <a class="top-result-card" href="${trackLinkUrl(item, category)}" target="_blank" rel="noopener noreferrer"${idAttr}>
      <div class="card-art-wrap">
        ${artMarkup(item, category, "large")}
        ${trackButtonsMarkup(item, category)}
      </div>
      <div class="top-result-name">${escapeHtml(item.name || "")}</div>
      <div class="top-result-subtitle">${escapeHtml(item.topSubtitle || "")}</div>
    </a>
  `;
  resolveTrackLinks(topResultEl);
}

function renderSections(matches, query) {
  sectionsEl.innerHTML = "";
  let anyResults = false;

  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const items = matches[category] || [];
    if (!items.length) continue;
    anyResults = true;

    const section = document.createElement("section");
    section.className = "category-section";

    const visible = items.slice(0, OVERVIEW_LIMIT);
    const hasMore = items.length > OVERVIEW_LIMIT;

    section.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${label}</h2>
        ${hasMore ? `<button class="see-all">See all</button>` : ""}
      </div>
      <div class="card-grid">
        ${visible.map((item) => cardMarkup(item, category)).join("")}
      </div>
    `;

    if (hasMore) {
      let expandedItems = null;
      section.querySelector(".see-all").addEventListener("click", async (e) => {
        const grid = section.querySelector(".card-grid");
        const isExpanded = e.target.textContent === "Show less";

        if (isExpanded) {
          grid.innerHTML = visible.map((item) => cardMarkup(item, category)).join("");
          e.target.textContent = "See all";
          resolveTrackLinks(grid);
          return;
        }

        if (!expandedItems) {
          e.target.textContent = "Loading…";
          e.target.disabled = true;
          try {
            expandedItems = await fetchCategory(query, category, SEE_ALL_LIMIT);
          } catch {
            expandedItems = items; // fall back to what we already have
          }
          e.target.disabled = false;
        }

        grid.innerHTML = expandedItems.map((item) => cardMarkup(item, category)).join("");
        e.target.textContent = "Show less";
        resolveTrackLinks(grid);
      });
    }

    sectionsEl.appendChild(section);
  }

  emptyView.style.display = anyResults ? "none" : "block";
  if (!anyResults) {
    emptyView.querySelector(".query-text").textContent = query;
  }
  resolveTrackLinks(sectionsEl);
}

let homeFeedLoading = false;

async function renderHomeFeed() {
  if (homeFeedLoading) return;
  homeFeedLoading = true;
  try {
    await Promise.all([renderTrending(), renderRecommendations()]);
  } finally {
    homeFeedLoading = false;
  }
}

function showView(view) {
  if (currentView !== "search") {
    currentView = "search";
    navSearchBtn.classList.add("active");
    renderPlaylistNav();
  }
  playlistViewEl.style.display = "none";
  recentView.style.display = view === "recent" ? "block" : "none";
  resultsView.style.display = view === "results" ? "block" : "none";
  loadingView.style.display = view === "loading" ? "block" : "none";
  if (view === "recent") renderHomeFeed();
}

let activeController = null;

async function runSearch(query) {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    if (activeController) activeController.abort();
    showView("recent");
    renderRecentChips();
    return;
  }

  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;

  showView("loading");

  let result;
  try {
    // Fetch one extra item per category beyond the preview count, purely as
    // a cheap signal for whether "See all" should appear; clicking it does
    // its own fetch at SEE_ALL_LIMIT rather than just revealing this extra item.
    result = await searchCatalog(trimmed, OVERVIEW_LIMIT + 1, controller.signal);
  } catch (err) {
    if (err.name === "AbortError") return; // superseded by a newer search
    showView("results");
    sectionsEl.innerHTML = "";
    topResultEl.style.display = "none";
    emptyView.style.display = "block";
    emptyView.querySelector(".query-text").textContent =
      `${trimmed}" — network error reaching the catalog`;
    return;
  }

  if (controller.signal.aborted) return; // a newer search started meanwhile

  showView("results");
  renderTopResult(result.best);
  renderSections(result.matches, trimmed);
  saveRecentSearch(trimmed);
  renderRecentChips();
}

const debouncedSearch = debounce(runSearch, DEBOUNCE_MS);

searchInput.addEventListener("input", (e) => {
  const value = e.target.value;
  clearButton.style.display = value ? "flex" : "none";
  if (value.trim().length < MIN_QUERY_LENGTH) {
    if (activeController) activeController.abort();
    showView("recent");
    renderRecentChips();
  } else {
    debouncedSearch(value);
  }
});

searchInput.addEventListener("focus", () => {
  if (!searchInput.value.trim()) {
    showView("recent");
    renderRecentChips();
  }
});

clearButton.addEventListener("click", () => {
  searchInput.value = "";
  clearButton.style.display = "none";
  if (activeController) activeController.abort();
  showView("recent");
  renderRecentChips();
  searchInput.focus();
});

clearRecentBtn.addEventListener("click", clearRecentSearches);

// Initial state: empty search box shows recent searches, matching the
// `.length<1` guard observed in the evidence.
renderPlaylistNav();
showView("recent");
renderRecentChips();
