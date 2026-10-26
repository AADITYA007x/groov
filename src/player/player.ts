// Playback engines + queue. No layout here: the player bar and the Now
// Playing screen (ui/now-playing.ts) render from the events this emits.
//
// Two interchangeable engines behind one interface:
//  - "audio":   the free, always-available 30s iTunes preview clip.
//  - "youtube": full length via ONE hidden YouTube IFrame player, used when a
//               YouTube key is set and a match is found. Falls back to
//               "audio" on any failure (no key, quota, no match, network).
//
// The YouTube iframe lives in #yt-host. It's invisible by default (the UI
// shows album art); the Now Playing screen can lay it over its artwork
// slot to show the video. Only CSS moves it, never the DOM, because
// re-parenting a live iframe reloads it and restarts the song.
import { getYoutubeApiKey } from "../config";
import { findYoutubeVideoId, loadYoutubeIframeApi } from "../api/youtube";
import { bus, trackRegistry } from "../state";
import type { Item } from "../types";
import { $ } from "../utils";

export type Engine = "audio" | "youtube";

let currentTrackId: string | null = null;
let activeEngine: Engine = "audio";
let currentQueue: string[] = [];
let currentQueueIndex = -1;
let progressTimer: ReturnType<typeof setInterval> | undefined;

export function getCurrentTrackId(): string | null {
  return currentTrackId;
}

export function getEngine(): Engine {
  return activeEngine;
}

// --- Seeking ------------------------------------------------------------------
// After a seek, engines keep reporting the old time for a moment while they
// buffer. Report the target instead until they catch up, so the bar and the
// notification move once, smoothly, instead of jumping back and forth.

let pendingSeek: { target: number; until: number } | null = null;

function settledPosition(actual: number): number {
  if (!pendingSeek) return actual;
  if (Math.abs(actual - pendingSeek.target) < 1.5 || Date.now() > pendingSeek.until) {
    pendingSeek = null;
    return actual;
  }
  return pendingSeek.target;
}

// --- iTunes 30s preview engine -------------------------------------------------

const audio = new Audio();
audio.preload = "none";

audio.addEventListener("play", () => activeEngine === "audio" && onPlaybackStarted());
audio.addEventListener("pause", () => activeEngine === "audio" && onPlaybackPaused());
audio.addEventListener("ended", () => activeEngine === "audio" && onPlaybackEnded());
audio.addEventListener("loadedmetadata", () => {
  if (activeEngine === "audio" && Number.isFinite(audio.duration)) {
    bus.emit("durationchange", audio.duration);
    emitProgress();
  }
});
audio.addEventListener("timeupdate", () => activeEngine === "audio" && emitProgress());

// --- YouTube full-track engine --------------------------------------------------

let yt: YT.Player | null = null;
let ytReady: Promise<YT.Player> | null = null;
let lastReportedDuration = 0;
let unmuteTimer: ReturnType<typeof setTimeout> | undefined;

function getYoutubePlayer(): Promise<YT.Player> {
  ytReady ??= loadYoutubeIframeApi().then(
    (YTApi) =>
      new Promise((resolve) => {
        const player: YT.Player = new YTApi.Player($("youtube-player"), {
          height: "100%",
          width: "100%",
          playerVars: {
            controls: 0, // our own controls
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            iv_load_policy: 3, // no annotations
            cc_load_policy: 0, // no captions by default
          },
          events: {
            onReady: () => resolve((yt = player)),
            onStateChange: onYoutubeStateChange,
          },
        });
      }),
  );
  return ytReady;
}

function hideCaptions(player: YT.Player): void {
  // Undocumented but widely used; YouTube may still show captions if the
  // viewer turned them on globally, so we also unload the module.
  try {
    player.unloadModule?.("captions");
    player.unloadModule?.("cc");
  } catch {
    // older player builds
  }
}

function onYoutubeStateChange(e: YT.OnStateChangeEvent): void {
  if (activeEngine !== "youtube") return;
  const S = window.YT.PlayerState;
  if (e.data === S.PLAYING) {
    hideCaptions(e.target);
    finishSeekMute();
    onPlaybackStarted();
  } else if (e.data === S.PAUSED) {
    onPlaybackPaused();
  } else if (e.data === S.ENDED) {
    onPlaybackEnded();
  }
}

function startProgressPolling(): void {
  clearInterval(progressTimer);
  lastReportedDuration = 0;
  progressTimer = setInterval(() => {
    if (activeEngine !== "youtube" || !yt?.getDuration) return;
    const duration = yt.getDuration() || 0;
    if (duration > 0 && duration !== lastReportedDuration) {
      lastReportedDuration = duration;
      bus.emit("durationchange", duration);
    }
    emitProgress();
  }, 250);
}

/** Mute across a YouTube seek so its buffering stutter isn't heard. */
function startSeekMute(): void {
  if (!yt) return;
  yt.mute();
  clearTimeout(unmuteTimer);
  unmuteTimer = setTimeout(finishSeekMute, 1200); // safety net
}

function finishSeekMute(): void {
  clearTimeout(unmuteTimer);
  unmuteTimer = undefined;
  if (yt?.isMuted?.()) yt.unMute();
}

// --- Shared state -------------------------------------------------------------

function getRawPosition(): number {
  if (activeEngine === "youtube") return yt?.getCurrentTime?.() || 0;
  return audio.currentTime || 0;
}

export function getPosition(): number {
  return settledPosition(getRawPosition());
}

export function getDuration(): number {
  if (activeEngine === "youtube") return yt?.getDuration?.() || 0;
  return Number.isFinite(audio.duration) ? audio.duration : 0;
}

function emitProgress(): void {
  const duration = getDuration();
  bus.emit("progress", { currentTime: getPosition(), duration: duration || 30 });
}

function onPlaybackStarted(): void {
  bus.emit("playstate", true);
}

function onPlaybackPaused(): void {
  bus.emit("playstate", false);
}

function onPlaybackEnded(): void {
  onPlaybackPaused();
  void playNextInQueue();
}

export function isTrackPlaying(id: string): boolean {
  if (currentTrackId !== id) return false;
  if (activeEngine === "youtube") {
    return yt?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
  }
  return !audio.paused;
}

export function isPlaying(): boolean {
  return currentTrackId ? isTrackPlaying(currentTrackId) : false;
}

// --- Queue --------------------------------------------------------------------
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

async function playQueueIndex(index: number): Promise<void> {
  const id = currentQueue[index];
  if (!id) return;
  currentQueueIndex = index;
  await playTrack(id);
}

async function playNextInQueue(): Promise<void> {
  if (hasNext()) await playQueueIndex(currentQueueIndex + 1);
}

export async function playNext(): Promise<void> {
  await playNextInQueue();
}

/** Like every music app: restart the song if past 3s, else go back one. */
export async function playPrevious(): Promise<void> {
  if (getPosition() > 3 || currentQueueIndex <= 0) {
    seekTo(0);
    return;
  }
  await playQueueIndex(currentQueueIndex - 1);
}

// --- Public controls ----------------------------------------------------------

function stopActiveEngine(): void {
  audio.pause();
  clearInterval(progressTimer);
  finishSeekMute();
  pendingSeek = null;
  yt?.pauseVideo?.();
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
  const previousId = currentTrackId;
  currentTrackId = id;
  if (previousId) bus.emit("playstate", false);
  bus.emit("trackchange", item);
  emitProgressReset();

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
    setEngine("youtube");
    const player = await getYoutubePlayer();
    if (currentTrackId !== id) return;
    player.loadVideoById(youtubeId);
    player.playVideo();
    startProgressPolling();
  } else if (item.previewUrl) {
    setEngine("audio");
    audio.src = item.previewUrl;
    audio.currentTime = 0;
    audio.play().catch(() => onPlaybackPaused());
  } else {
    onPlaybackPaused();
  }
}

function emitProgressReset(): void {
  bus.emit("progress", { currentTime: 0, duration: 0 });
}

function setEngine(engine: Engine): void {
  activeEngine = engine;
  bus.emit("enginechange", engine);
}

export function togglePlayback(): void {
  if (activeEngine === "youtube" && yt) {
    if (yt.getPlayerState() === window.YT.PlayerState.PLAYING) yt.pauseVideo();
    else yt.playVideo();
  } else if (audio.paused) {
    audio.play().catch(() => onPlaybackPaused());
  } else {
    audio.pause();
  }
}

export function play(): void {
  if (currentTrackId && !isPlaying()) togglePlayback();
}

export function pause(): void {
  if (currentTrackId && isPlaying()) togglePlayback();
}

export function seekTo(seconds: number): void {
  if (!currentTrackId) return;
  const duration = getDuration();
  const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.25) : seconds);
  if (activeEngine === "youtube" && yt) {
    if (isPlaying()) startSeekMute();
    yt.seekTo(target, true);
  } else if (Number.isFinite(audio.duration)) {
    audio.currentTime = target;
  } else {
    return;
  }
  pendingSeek = { target, until: Date.now() + 4000 };
  emitProgress();
  bus.emit("seeked", undefined);
}

/** Everything the notification / media keys need to show. */
export function getSnapshot(): {
  item: Item | undefined;
  playing: boolean;
  position: number;
  duration: number;
  hasNext: boolean;
  hasPrevious: boolean;
} {
  const item = currentTrackId ? trackRegistry.get(currentTrackId) : undefined;
  return {
    item,
    playing: isPlaying(),
    position: getPosition(),
    duration: getDuration(),
    hasNext: hasNext(),
    // Always offered: on the first song it restarts the track.
    hasPrevious: Boolean(item),
  };
}

export function initPlayer(): void {
  // Play buttons are re-created on every render, so delegate from document.
  document.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>(".play-overlay, .playlist-row-play");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    queueFromElement(btn);
    void playTrack(btn.dataset.id!);
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
}
