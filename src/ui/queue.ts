// "Up next" sheet: what's coming, drag ≡ to reorder, ✕ to remove, tap to
// jump to a song. Songs you queued by hand are marked "queued".
import {
  getCurrentTrackId,
  getUpcoming,
  moveUpcoming,
  playUpcoming,
  removeUpcoming,
} from "../player/player";
import { getRadioSeed } from "../player/radio";
import { bus, trackRegistry } from "../state";
import { $, escapeHtml } from "../utils";
import { pushStep, removeStep } from "./back";

const sheet = $("queue-sheet");
const list = $("queue-list");
const nowEl = $("queue-now");
/** How many upcoming songs to draw (radio can be long). */
const MAX_ROWS = 60;

const isOpen = () => sheet.style.display !== "none";

let manualIds = new Set<string>();

/** Songs queued by hand, so they can be labelled (tracked from the events). */
export function markManual(id: string): void {
  manualIds.add(id);
}

function render(): void {
  if (!isOpen()) return;
  const current = getCurrentTrackId();
  const now = current ? trackRegistry.get(current) : undefined;
  const radio = getRadioSeed();
  nowEl.textContent = now
    ? `Now playing: ${now.name} · ${now.subtitle}${radio ? ` · 📻 Radio from "${radio}"` : ""}`
    : "Nothing playing";

  const upcoming = getUpcoming();
  if (!upcoming.length) {
    list.innerHTML = `<div class="queue-empty">Nothing up next. Use ⋯ on any song → "Add to queue", or start 📻 Radio.</div>`;
    return;
  }
  list.innerHTML = upcoming
    .slice(0, MAX_ROWS)
    .map((id, i) => {
      const item = trackRegistry.get(id);
      if (!item) return "";
      const art = item.artwork ? `<img class="queue-art" src="${escapeHtml(item.artwork)}" alt="" loading="lazy" />` : `<div class="queue-art"></div>`;
      return `
        <div class="queue-row${manualIds.has(id) ? " manual" : ""}" data-index="${i}">
          <button class="queue-handle" aria-label="Drag to reorder">≡</button>
          ${art}
          <div class="queue-info" data-play="${i}">
            <div class="queue-name">${escapeHtml(item.name)}</div>
            <div class="queue-artist">${escapeHtml(item.subtitle)}</div>
          </div>
          <button class="queue-remove" data-remove="${i}" aria-label="Remove">✕</button>
        </div>`;
    })
    .join("");
}

function open(): void {
  sheet.style.display = "flex";
  pushStep("queue", close);
  render();
}

function close(): void {
  removeStep("queue");
  sheet.style.display = "none";
}

// --- Drag to reorder (touch + mouse) --------------------------------------------------

function enableDrag(): void {
  let row: HTMLElement | null = null;
  let startY = 0;
  let from = 0;
  let rowHeight = 60;

  list.addEventListener("pointerdown", (e) => {
    const handle = (e.target as Element).closest(".queue-handle");
    if (!handle) return;
    row = handle.closest<HTMLElement>(".queue-row");
    if (!row) return;
    e.preventDefault();
    from = Number(row.dataset.index);
    startY = e.clientY;
    rowHeight = row.getBoundingClientRect().height || 60;
    row.classList.add("dragging");
    (handle as HTMLElement).setPointerCapture(e.pointerId);
  });

  list.addEventListener("pointermove", (e) => {
    if (!row) return;
    row.style.transform = `translateY(${e.clientY - startY}px)`;
  });

  const drop = (e: PointerEvent) => {
    if (!row) return;
    const steps = Math.round((e.clientY - startY) / rowHeight);
    row.classList.remove("dragging");
    row.style.transform = "";
    row = null;
    if (steps !== 0) moveUpcoming(from, from + steps);
  };
  list.addEventListener("pointerup", drop);
  list.addEventListener("pointercancel", drop);
}

export function initQueue(): void {
  $("np-queue").addEventListener("click", open);
  $("queue-close").addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });
  list.addEventListener("click", (e) => {
    const target = e.target as Element;
    const remove = target.closest<HTMLElement>("[data-remove]");
    if (remove) {
      removeUpcoming(Number(remove.dataset.remove));
      return;
    }
    const play = target.closest<HTMLElement>("[data-play]");
    if (play) void playUpcoming(Number(play.dataset.play));
  });
  enableDrag();
  bus.on("queueupdate", render);
  bus.on("trackchange", render);
  bus.on("queuechange", () => {
    manualIds = new Set();
    render();
  });
}
