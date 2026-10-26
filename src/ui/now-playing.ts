// The player bar and the full-screen Now Playing view (tap the song in the
// bar to open it). Both render from player events, so they always agree.
import { hiResArtwork } from "../player/media-controls";
import {
  getDuration,
  getEngine,
  isPlaying,
  playNext,
  playPrevious,
  seekTo,
  togglePlayback,
  getCurrentTrackId,
} from "../player/player";
import { openLyrics } from "../player/lyrics";
import { bus } from "../state";
import type { Item } from "../types";
import { $, cssEscape, formatTime } from "../utils";
import { updateBackgroundArt } from "./layout";
import { openAddToPlaylist } from "./popover";
import { createSeekBar, type SeekBar } from "./seekbar";

const bar = $("player-bar");
const barArt = $<HTMLImageElement>("player-art");
const barName = $("player-name");
const barArtist = $("player-artist");
const barToggle = $("player-toggle");
const barElapsed = $("player-time-elapsed");
const barTotal = $("player-time-total");

const np = $("now-playing");
const npBg = $("np-bg");
const npArtSlot = $("np-art-slot");
const npArt = $<HTMLImageElement>("np-art");
const npTitle = $("np-title");
const npArtist = $("np-artist");
const npElapsed = $("np-elapsed");
const npTotal = $("np-total");
const npToggle = $("np-toggle");
const npVideoBtn = $("np-video");
const ytHost = $("yt-host");

let currentItem: Item | null = null;
let videoMode = false;
const seekBars: SeekBar[] = [];

const isOpen = () => np.style.display !== "none";

// --- Rendering -------------------------------------------------------------------

function renderTrack(item: Item): void {
  currentItem = item;
  bar.style.display = "flex";
  document.body.classList.add("has-player");

  const small = hiResArtwork(item.artwork, 200) || "";
  const large = hiResArtwork(item.artwork, 600) || "";
  barArt.src = small;
  barArt.style.visibility = small ? "visible" : "hidden";
  barName.textContent = item.name;
  barArtist.textContent = item.subtitle;

  npArt.src = large;
  npArt.classList.toggle("empty", !large);
  npTitle.textContent = item.name;
  npArtist.textContent = item.subtitle;
  npBg.style.backgroundImage = large ? `url("${large}")` : "";
  updateBackgroundArt(item.artwork);
}

function renderPlayState(playing: boolean): void {
  for (const btn of [barToggle, npToggle]) {
    btn.textContent = playing ? "⏸" : "▶";
    btn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  np.classList.toggle("playing", playing);

  // Play buttons on cards and playlist rows.
  document.querySelectorAll<HTMLElement>(".play-overlay.is-playing, .playlist-row-play.is-playing").forEach((b) => {
    b.textContent = "▶";
    b.classList.remove("is-playing");
    b.setAttribute("aria-label", "Play");
  });
  const id = getCurrentTrackId();
  if (playing && id) {
    const sel = cssEscape(id);
    document
      .querySelectorAll<HTMLElement>(`.play-overlay[data-id="${sel}"], .playlist-row-play[data-id="${sel}"]`)
      .forEach((b) => {
        b.textContent = "⏸";
        b.classList.add("is-playing");
        b.setAttribute("aria-label", "Pause");
      });
  }
}

function renderTimes(elapsed: number, duration: number): void {
  const e = formatTime(elapsed);
  const t = duration > 0 ? formatTime(duration) : "0:00";
  barElapsed.textContent = e;
  npElapsed.textContent = e;
  barTotal.textContent = t;
  npTotal.textContent = t;
}

function renderProgress(currentTime: number, duration: number): void {
  const ratio = duration > 0 ? currentTime / duration : 0;
  seekBars.forEach((s) => s.set(ratio));
  if (!seekBars.some((s) => s.isDragging())) renderTimes(currentTime, duration);
}

// --- Video mode -------------------------------------------------------------------
// Lays the hidden YouTube player over the artwork slot, 16:9, centered.

function placeVideo(): void {
  if (!videoMode) return;
  const r = npArtSlot.getBoundingClientRect();
  const height = Math.min(r.height, (r.width * 9) / 16);
  const width = (height * 16) / 9;
  Object.assign(ytHost.style, {
    left: `${r.left + (r.width - width) / 2}px`,
    top: `${r.top + (r.height - height) / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
}

function setVideoMode(on: boolean): void {
  videoMode = on && getEngine() === "youtube";
  ytHost.classList.toggle("as-video", videoMode);
  np.classList.toggle("video-mode", videoMode);
  npVideoBtn.classList.toggle("active", videoMode);
  npVideoBtn.setAttribute("aria-label", videoMode ? "Show artwork" : "Show video");
  if (videoMode) placeVideo();
  else ytHost.removeAttribute("style");
}

function renderEngine(): void {
  const yt = getEngine() === "youtube";
  npVideoBtn.style.visibility = yt ? "visible" : "hidden";
  if (!yt && videoMode) setVideoMode(false);
}

// --- Open / close (Android back button closes it too) -----------------------------

function open(): void {
  if (!currentItem || isOpen()) return;
  np.style.display = "flex";
  document.body.classList.add("np-open");
  history.pushState({ nowPlaying: true }, "");
  requestAnimationFrame(() => np.classList.add("visible"));
}

function close(fromHistory = false): void {
  if (!isOpen()) return;
  setVideoMode(false);
  np.classList.remove("visible");
  document.body.classList.remove("np-open");
  np.style.display = "none";
  if (!fromHistory && history.state?.nowPlaying) history.back();
}

// --- Init ---------------------------------------------------------------------------

export function initNowPlaying(): void {
  const onSeek = (ratio: number) => seekTo(ratio * getDuration());
  const onPreview = (ratio: number) => renderTimes(ratio * getDuration(), getDuration());
  seekBars.push(createSeekBar($("player-seek"), { onSeek, onPreview }));
  seekBars.push(createSeekBar($("np-seek"), { onSeek, onPreview }));

  barToggle.addEventListener("click", () => togglePlayback());
  npToggle.addEventListener("click", () => togglePlayback());
  $("player-prev").addEventListener("click", () => void playPrevious());
  $("player-next").addEventListener("click", () => void playNext());
  $("np-prev").addEventListener("click", () => void playPrevious());
  $("np-next").addEventListener("click", () => void playNext());

  $("player-open").addEventListener("click", open);
  $("np-close").addEventListener("click", () => close());
  npVideoBtn.addEventListener("click", () => setVideoMode(!videoMode));
  $("np-lyrics").addEventListener("click", () => openLyrics());
  $("np-add").addEventListener("click", (e) => {
    e.stopPropagation();
    const id = getCurrentTrackId();
    if (id) openAddToPlaylist(id, e.currentTarget as HTMLElement);
  });

  window.addEventListener("popstate", () => close(true));
  window.addEventListener("resize", placeVideo);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  bus.on("trackchange", renderTrack);
  bus.on("playstate", (playing) => renderPlayState(playing));
  bus.on("progress", ({ currentTime, duration }) => renderProgress(currentTime, duration));
  bus.on("enginechange", renderEngine);

  // Cards re-render often; keep their play icons in sync.
  bus.on("playlistschange", () => renderPlayState(isPlaying()));
  renderEngine();
}
