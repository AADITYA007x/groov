// HTML for cards, the top result and playlist rows. Rendering a track also
// registers it so play/add buttons can find it by id.
import { getCachedVideoId } from "../api/youtube";
import { isTrackPlaying } from "../player/player";
import { registerTrack } from "../state";
import type { Category, Item } from "../types";
import { escapeHtml } from "../utils";

/**
 * Card links stay for long-press / open-in-new-tab. A cached YouTube match is
 * preferred, but we no longer look one up just to render a link: that cost
 * 100 quota units per visible card and burned the daily quota in minutes.
 */
export function trackLinkUrl(item: Item, category: Category): string {
  if (category === "tracks") {
    const cachedId = getCachedVideoId(item.id);
    if (cachedId) return `https://www.youtube.com/watch?v=${cachedId}`;
  }
  return item.externalUrl || "#";
}

function artMarkup(item: Item, category: Category, sizeClass: string): string {
  const roundClass = category === "artists" ? "round" : "";
  if (item.artwork) {
    return `<img class="art ${sizeClass} ${roundClass}" src="${escapeHtml(item.artwork)}" alt="" loading="lazy" />`;
  }
  const icon = category === "tracks" ? "🎵" : category === "albums" ? "💿" : "🧑‍🎤";
  return `<div class="art ${sizeClass} ${roundClass} art-fallback">${icon}</div>`;
}

function playButton(cls: string, id: string): string {
  const playing = isTrackPlaying(id);
  return `<button class="${cls}${playing ? " is-playing" : ""}" data-id="${escapeHtml(id)}" aria-label="${playing ? "Pause" : "Play"}">${playing ? "⏸" : "▶"}</button>`;
}

function trackButtonsMarkup(item: Item, category: Category): string {
  if (category !== "tracks") return "";
  registerTrack(item);
  let html = "";
  if (item.previewUrl) html += playButton("play-overlay", item.id);
  html += `<button class="add-overlay" data-id="${escapeHtml(item.id)}" aria-label="Add to playlist">+</button>`;
  return html;
}

export function cardMarkup(item: Item, category: Category): string {
  const idAttr = category === "tracks" ? ` data-id="${escapeHtml(item.id)}"` : "";
  return `
    <a class="card" href="${escapeHtml(trackLinkUrl(item, category))}" target="_blank" rel="noopener noreferrer"${idAttr}>
      <div class="card-art-wrap">
        ${artMarkup(item, category, "")}
        ${trackButtonsMarkup(item, category)}
      </div>
      <div class="card-title">${escapeHtml(item.name)}</div>
      <div class="card-subtitle">${escapeHtml(item.subtitle)}</div>
    </a>
  `;
}

export function topResultMarkup(item: Item, category: Category): string {
  const idAttr = category === "tracks" ? ` data-id="${escapeHtml(item.id)}"` : "";
  return `
    <h2 class="section-title">Top result</h2>
    <a class="top-result-card" href="${escapeHtml(trackLinkUrl(item, category))}" target="_blank" rel="noopener noreferrer"${idAttr}>
      <div class="card-art-wrap">
        ${artMarkup(item, category, "large")}
        ${trackButtonsMarkup(item, category)}
      </div>
      <div class="top-result-name">${escapeHtml(item.name)}</div>
      <div class="top-result-subtitle">${escapeHtml(item.topSubtitle)}</div>
    </a>
  `;
}

export function playlistRowMarkup(playlistId: string, item: Item): string {
  registerTrack(item);
  const art = item.artwork
    ? `<img class="playlist-row-art" src="${escapeHtml(item.artwork)}" alt="" />`
    : `<div class="playlist-row-art art-fallback">🎵</div>`;
  return `
    <div class="playlist-row">
      <div class="playlist-row-art-wrap">
        ${art}
        ${playButton("playlist-row-play", item.id)}
      </div>
      <div class="playlist-row-info">
        <div class="playlist-row-name">${escapeHtml(item.name)}</div>
        <div class="playlist-row-subtitle">${escapeHtml(item.subtitle)}</div>
      </div>
      <button class="playlist-row-remove" data-playlist="${escapeHtml(playlistId)}" data-track="${escapeHtml(item.id)}" aria-label="Remove from playlist">✕</button>
    </div>
  `;
}

export function sectionMarkup(title: string, items: Item[]): string {
  return `
    <div class="category-section">
      <h2 class="section-title">${escapeHtml(title)}</h2>
      <div class="card-grid">${items.map((item) => cardMarkup(item, "tracks")).join("")}</div>
    </div>
  `;
}
