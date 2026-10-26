// Playback: two interchangeable engines behind one interface.
//  - "audio":   the free, always-available 30s iTunes preview clip.
//  - "youtube": full-length via the YouTube IFrame Player, used when a YouTube
//               key is configured and a matching video is found. Falls back to
//               "audio" on any failure (no key, quota, no match, network).
import { getYoutubeApiKey } from "../config";
import { findYoutubeVideoId, loadYoutubeIframeApi } from "../api/youtube";
import { bus, trackRegistry } from "../state";
import { $, cssEscape, formatTime } from "../utils";
import { updateBackgroundArt } from "../ui/layout";

type Engine = "audio" | "youtube";

const playerBar = $("player-bar");
const playerArt = $<HTMLImageElement>("player-art");
const playerName = $("player-name");
const playerArtist = $("player-artist");
const playerToggle = $("player-toggle");
const playerBarTrack = document.querySelector<HTMLElement>(".player-bar-track")!;
const playerBarFill = $("player-bar-fill");
const playerTimeElapsed = $("player-time-elapsed");
const playerTimeTotal = $("player-time-total");
const youtubePlayerEl = $("youtube-player");
const youtubePlayerWrapEl = $("youtube-player-wrap");
const videoExpandBtn = $("video-expand-btn");
const videoOverlay = $("video-overlay");
const videoCollapseBtn = $("video-collapse");
const youtubePlayerExpandedEl = $("youtube-player-expanded");
const videoOverlayName = $("video-overlay-name");
const videoOverlayArtist = $("video-overlay-artist");

let currentTrackId: string | null = null;
let currentYoutubeVideoId: string | null = null;
let activeEngine: Engine = "audio";
let youtubeProgressTimer: ReturnType<typeof setInterval> | undefined;
let currentQueue: string[] = [];
let currentQueueIndex = -1;

export function getCurrentTrackId(): string | null {
  return currentTrackId;
}

// --- iTunes 30s preview engine ---------------------------------------------

const audio = new Audio();
audio.preload = "none";

audio.addEventListener("play", () => activeEngine === "audio" && onPlaybackStarted());
audio.addEventListener("pause", () => activeEngine === "audio" && onPlaybackPaused());
audio.addEventListener("ended", () => activeEngine === "audio" && onPlaybackEnded());
audio.addEventListener("loadedmetadata", () => {
  if (activeEngine === "audio" && Number.isFinite(audio.duration)) {
    playerTimeTotal.textContent = formatTime(audio.duration);
    bus.emit("durationchange", audio.duration);
  }
});
audio.addEventListener("timeupdate", () => {
  if (activeEngine !== "audio") return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 30;
  updateProgressUI(audio.currentTime, duration);
});

// --- YouTube full-track engine ----------------------------------------------
//
// Two YT.Player instances: the mini one in the player bar and a full-size one
// in an overlay. Reparenting a live <iframe> reloads it in most WebViews (and
// restarts playback), so expanding hands the position off between instances
// instead. Only one of them is audible at a time.

let miniPlayer: YT.Player | null = null;
let miniPlayerReady: Promise<YT.Player> | null = null;
let expandedPlayer: YT.Player | null = null;
let expandedPlayerReady: Promise<YT.Player> | null = null;
let activeYoutubePlayer: YT.Player | null = null;
let isVideoExpanded = false;

function createYoutubePlayer(el: HTMLElement, height: string, width: string): Promise<YT.Player> {
  return loadYoutubeIframeApi().then(
    (YTApi) =>
      new Promise((resolve) => {
        const player: YT.Player = new YTApi.Player(el, {
          height,
          width,
          playerVars: { controls: 1, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => resolve(player),
            onStateChange: onYoutubeStateChange,
          },
        });
      }),
  );
}

function getMiniPlayer(): Promise<YT.Player> {
  miniPlayerReady ??= createYoutubePlayer(youtubePlayerEl, "54", "96").then((p) => (miniPlayer = p));
  return miniPlayerReady;
}

function getExpandedPlayer(): Promise<YT.Player> {
  expandedPlayerReady ??= createYoutubePlayer(youtubePlayerExpandedEl, "100%", "100%").then(
    (p) => (expandedPlayer = p),
  );
  return expandedPlayerReady;
}

function onYoutubeStateChange(e: YT.OnStateChangeEvent): void {
  if (activeEngine !== "youtube" || e.target !== activeYoutubePlayer) return;
  const S = window.YT.PlayerState;
  if (e.data === S.PLAYING) onPlaybackStarted();
  else if (e.data === S.PAUSED) onPlaybackPaused();
  else if (e.data === S.ENDED) onPlaybackEnded();
}

let lastReportedDuration = 0;

function startYoutubeProgressPolling(): void {
  clearInterval(youtubeProgressTimer);
  lastReportedDuration = 0;
  youtubeProgressTimer = setInterval(() => {
    if (activeEngine !== "youtube" || !activeYoutubePlayer?.getDuration) return;
    const duration = activeYoutubePlayer.getDuration() || 0;
    if (duration > 0 && duration !== lastReportedDuration) {
      lastReportedDuration = duration;
      bus.emit("durationchange", duration);
    }
    updateProgressUI(activeYoutubePlayer.getCurrentTime(), duration || 1);
  }, 250);
}

async function expandVideo(): Promise<void> {
  if (activeEngine !== "youtube" || !currentYoutubeVideoId || isVideoExpanded) return;
  const resumeTime = miniPlayer?.getCurrentTime?.() || 0;
  miniPlayer?.pauseVideo?.();

  videoOverlayName.textContent = playerName.textContent;
  videoOverlayArtist.textContent = playerArtist.textContent;
  videoOverlay.style.display = "flex";
  isVideoExpanded = true;

  const player = await getExpandedPlayer();
  if (!isVideoExpanded) return; // collapsed again before it finished loading
  activeYoutubePlayer = player;
  player.loadVideoById(currentYoutubeVideoId, resumeTime);
  player.playVideo();
}

function collapseVideo(): void {
  if (!isVideoExpanded) return;
  isVideoExpanded = false;
  const resumeTime = expandedPlayer?.getCurrentTime?.() || 0;
  expandedPlayer?.pauseVideo?.();
  videoOverlay.style.display = "none";
  activeYoutubePlayer = miniPlayer;
  if (miniPlayer) {
    miniPlayer.seekTo(resumeTime, true);
    miniPlayer.playVideo();
  }
}

// --- Shared player-bar UI ----------------------------------------------------

function setOverlayIcons(id: string, playing: boolean): void {
  const sel = cssEscape(id);
  document
    .querySelectorAll(`.play-overlay[data-id="${sel}"], .playlist-row-play[data-id="${sel}"]`)
    .forEach((btn) => {
      btn.textContent = playing ? "⏸" : "▶";
      btn.setAttribute("aria-label", playing ? "Pause" : "Play");
      btn.classList.toggle("is-playing", playing);
    });
}

function onPlaybackStarted(): void {
  playerToggle.textContent = "⏸";
  playerToggle.setAttribute("aria-label", "Pause");
  if (currentTrackId) setOverlayIcons(currentTrackId, true);
  bus.emit("playstate", true);
}

function onPlaybackPaused(): void {
  playerToggle.textContent = "▶";
  playerToggle.setAttribute("aria-label", "Play");
  if (currentTrackId) setOverlayIcons(currentTrackId, false);
  bus.emit("playstate", false);
}

function onPlaybackEnded(): void {
  onPlaybackPaused();
  clearInterval(youtubeProgressTimer);
  playerBarFill.style.width = "0%";
  playerTimeElapsed.textContent = "0:00";
  void playNextInQueue();
}

function updateProgressUI(currentTime: number, duration: number): void {
  playerBarFill.style.width = `${Math.min(100, (currentTime / duration) * 100)}%`;
  playerTimeElapsed.textContent = formatTime(currentTime);
  playerTimeTotal.textContent = formatTime(duration);
  bus.emit("progress", { currentTime, duration });
}

// --- Queue -------------------------------------------------------------------
// Autoplay continues through whichever grid or playlist the current track was
// started from, in the order it appears there.

export function setQueue(ids: string[], startId: string): void {
  currentQueue = ids.length ? ids : [startId];
  currentQueueIndex = Math.max(0, currentQueue.indexOf(startId));
}

export function queueFromElement(el: HTMLElement): void {
  const id = el.dataset.id!;
  const container = el.closest(".card-grid, .playlist-track-list");
  const ids = container
    ? [...container.querySelectorAll<HTMLElement>(".play-overlay[data-id], .playlist-row-play[data-id]")].map(
        (b) => b.dataset.id!,
      )
    : [id];
  setQueue(ids, id);
}

const hasNext = () => currentQueueIndex >= 0 && currentQueueIndex < currentQueue.length - 1;
const hasPrevious = () => currentQueueIndex > 0;

async function playQueueIndex(index: number): Promise<void> {
  const id = currentQueue[index];
  if (!id) return;
  currentQueueIndex = index;
  const wasExpanded = isVideoExpanded;
  await playTrack(id);
  if (wasExpanded && activeEngine === "youtube") void expandVideo();
}

async function playNextInQueue(): Promise<void> {
  if (hasNext()) await playQueueIndex(currentQueueIndex + 1);
}

export async function playNext(): Promise<void> {
  await playNextInQueue();
}

/** Like every music app: restart the song if past 3s, else go back one. */
export async function playPrevious(): Promise<void> {
  if (getPosition() > 3 || !hasPrevious()) {
    seekTo(0);
    return;
  }
  await playQueueIndex(currentQueueIndex - 1);
}

// --- Public controls ---------------------------------------------------------

export function isTrackPlaying(id: string): boolean {
  if (currentTrackId !== id) return false;
  if (activeEngine === "youtube") {
    return activeYoutubePlayer?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
  }
  return !audio.paused;
}

function stopActiveEngine(): void {
  audio.pause();
  clearInterval(youtubeProgressTimer);
  miniPlayer?.pauseVideo?.();
  expandedPlayer?.pauseVideo?.();
  if (isVideoExpanded) {
    isVideoExpanded = false;
    videoOverlay.style.display = "none";
  }
}

export async function playTrack(id: string): Promise<void> {
  const item = trackRegistry.get(id);
  if (!item) return;

  // Same track already loaded: just toggle play/pause.
  if (currentTrackId === id) {
    togglePlayback();
    return;
  }

  stopActiveEngine();
  if (currentTrackId) setOverlayIcons(currentTrackId, false);
  currentTrackId = id;

  playerBar.style.display = "flex";
  document.body.classList.add("has-player");
  playerName.textContent = item.name || "";
  playerArtist.textContent = item.subtitle || "";
  updateBackgroundArt(item.artwork);
  playerBarFill.style.width = "0%";
  playerTimeElapsed.textContent = "0:00";
  playerTimeTotal.textContent = "0:30";
  bus.emit("trackchange", item);

  let youtubeId: string | null = null;
  if (getYoutubeApiKey()) {
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
    const player = await getMiniPlayer();
    if (currentTrackId !== id) return;
    activeYoutubePlayer = player;
    player.loadVideoById(youtubeId);
    player.playVideo();
    startYoutubeProgressPolling();
  } else if (item.previewUrl) {
    activeEngine = "audio";
    currentYoutubeVideoId = null;
    youtubePlayerWrapEl.style.display = "none";
    playerArt.style.display = "block";
    playerArt.src = item.artwork || "";
    audio.src = item.previewUrl;
    audio.currentTime = 0;
    audio.play().catch(() => onPlaybackPaused());
  } else {
    onPlaybackPaused();
  }
}

function getPosition(): number {
  if (activeEngine === "youtube") return activeYoutubePlayer?.getCurrentTime?.() || 0;
  return audio.currentTime || 0;
}

function getDuration(): number {
  if (activeEngine === "youtube") return activeYoutubePlayer?.getDuration?.() || 0;
  return Number.isFinite(audio.duration) ? audio.duration : 0;
}

export function seekTo(seconds: number): void {
  if (!currentTrackId) return;
  const target = Math.max(0, seconds);
  if (activeEngine === "youtube" && activeYoutubePlayer) {
    activeYoutubePlayer.seekTo(target, true);
  } else if (Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(target, audio.duration);
  } else {
    return;
  }
  bus.emit("seeked", undefined);
}

export function play(): void {
  if (currentTrackId && !isTrackPlaying(currentTrackId)) togglePlayback();
}

export function pause(): void {
  if (currentTrackId && isTrackPlaying(currentTrackId)) togglePlayback();
}

/** Everything the notification / media keys need to show. */
export function getSnapshot() {
  const item = currentTrackId ? trackRegistry.get(currentTrackId) : undefined;
  return {
    item,
    playing: currentTrackId ? isTrackPlaying(currentTrackId) : false,
    position: getPosition(),
    duration: getDuration(),
    hasNext: hasNext(),
    // Always offered: on the first song it restarts the track.
    hasPrevious: Boolean(item),
  };
}

export function togglePlayback(): void {
  if (activeEngine === "youtube" && activeYoutubePlayer) {
    if (activeYoutubePlayer.getPlayerState() === window.YT.PlayerState.PLAYING) {
      activeYoutubePlayer.pauseVideo();
    } else {
      activeYoutubePlayer.playVideo();
    }
  } else if (audio.paused) {
    audio.play().catch(() => onPlaybackPaused());
  } else {
    audio.pause();
  }
}

export function initPlayer(): void {
  videoExpandBtn.addEventListener("click", () => void expandVideo());
  videoCollapseBtn.addEventListener("click", collapseVideo);

  playerToggle.addEventListener("click", () => {
    if (currentTrackId) togglePlayback();
  });

  $("player-prev").addEventListener("click", () => void playPrevious());
  $("player-next").addEventListener("click", () => void playNext());

  playerBarTrack.addEventListener("click", (e) => {
    if (!currentTrackId) return;
    const rect = playerBarTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * getDuration());
  });

  // Keyboard on laptop: Space = play/pause, Shift+←/→ = previous/next.
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (!currentTrackId || target.closest("input, textarea, [contenteditable]")) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlayback();
    } else if (e.shiftKey && e.code === "ArrowRight") {
      void playNext();
    } else if (e.shiftKey && e.code === "ArrowLeft") {
      void playPrevious();
    }
  });

  // Play buttons are re-created on every render, so delegate from document.
  document.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>(".play-overlay, .playlist-row-play");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    queueFromElement(btn);
    void playTrack(btn.dataset.id!);
  });
}
