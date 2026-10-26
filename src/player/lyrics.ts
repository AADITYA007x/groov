// Lyrics overlay: fetches on open, follows track changes, highlights the
// current line of synced lyrics as playback progresses.
import { fetchLyrics } from "../api/lyrics";
import { bus, trackRegistry } from "../state";
import type { Item, Lyrics } from "../types";
import { $, escapeHtml } from "../utils";
import { getCurrentTrackId } from "./player";

const toggleBtn = $("lyrics-toggle-btn");
const overlay = $("lyrics-overlay");
const closeBtn = $("lyrics-close");
const trackName = $("lyrics-track-name");
const trackArtist = $("lyrics-track-artist");
const body = $("lyrics-body");

let currentLyrics: Lyrics | null = null;
let activeLineIndex = -1;

const isOpen = () => overlay.style.display !== "none";

function render(): void {
  if (!currentLyrics || (!currentLyrics.plain && !currentLyrics.synced)) {
    body.innerHTML = `<p class="lyrics-empty">No lyrics found for this track.</p>`;
    return;
  }
  if (currentLyrics.synced) {
    body.innerHTML = currentLyrics.synced
      .map((line, i) => `<div class="lyrics-line" data-index="${i}">${escapeHtml(line.text || "♪")}</div>`)
      .join("");
  } else {
    body.innerHTML = `<p>${escapeHtml(currentLyrics.plain).replace(/\n/g, "<br>")}</p>`;
  }
}

async function load(item: Item): Promise<void> {
  trackName.textContent = item.name || "";
  trackArtist.textContent = item.subtitle || "";
  body.innerHTML = `<p class="lyrics-empty">Loading lyrics…</p>`;
  currentLyrics = null;
  activeLineIndex = -1;

  const lyrics = await fetchLyrics(item);
  if (getCurrentTrackId() !== item.id || !isOpen()) return;
  currentLyrics = lyrics;
  render();
}

function open(): void {
  const id = getCurrentTrackId();
  const item = id ? trackRegistry.get(id) : undefined;
  if (!item) return;
  overlay.style.display = "flex";
  void load(item);
}

function close(): void {
  overlay.style.display = "none";
}

function highlight(currentTime: number): void {
  if (!currentLyrics?.synced || !isOpen()) return;
  let newIndex = -1;
  for (let i = 0; i < currentLyrics.synced.length; i++) {
    if (currentLyrics.synced[i].time <= currentTime) newIndex = i;
    else break;
  }
  if (newIndex === activeLineIndex) return;
  activeLineIndex = newIndex;
  const lines = body.querySelectorAll(".lyrics-line");
  lines.forEach((el) => el.classList.remove("active"));
  const activeEl = lines[newIndex];
  if (activeEl) {
    activeEl.classList.add("active");
    activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function initLyrics(): void {
  toggleBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  bus.on("trackchange", (item) => {
    currentLyrics = null;
    activeLineIndex = -1;
    if (isOpen()) void load(item);
  });
  bus.on("progress", ({ currentTime }) => highlight(currentTime));
}
