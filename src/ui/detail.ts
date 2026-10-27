// Artist and album pages, inside the app.
//   Artist: popular songs (by popularity), albums (newest first), Play, Radio.
//   Album: songs in track order, Play, Radio, tap the artist to open them.
import { fetchAlbumPage, fetchArtistPage } from "../api/itunes";
import { hiResArtwork } from "../player/media-controls";
import { isShuffleOn, playTrack, setQueue } from "../player/player";
import { startRadio } from "../player/radio";
import { trackRegistry } from "../state";
import type { Item } from "../types";
import { $, escapeHtml } from "../utils";
import { cardMarkup, trackRowMarkup } from "./cards";

const art = $<HTMLImageElement>("detail-art");
const kindEl = $("detail-kind");
const titleEl = $("detail-title");
const subEl = $("detail-sub");
const body = $("detail-body");
const playBtn = $<HTMLButtonElement>("detail-play");
const radioBtn = $<HTMLButtonElement>("detail-radio");

let token = 0;
let tracks: Item[] = [];

function setHeader(kind: "Artist" | "Album", title: string, subHtml: string, artwork: string | null): void {
  kindEl.textContent = kind;
  titleEl.textContent = title;
  subEl.innerHTML = subHtml;
  art.classList.toggle("round", kind === "Artist");
  const src = hiResArtwork(artwork, 600);
  art.src = src ?? "";
  art.style.visibility = src ? "visible" : "hidden";
}

function setLoading(kind: "Artist" | "Album", hintName: string): void {
  setHeader(kind, hintName || "Loading…", "", null);
  playBtn.disabled = true;
  radioBtn.disabled = true;
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
}

function showError(): void {
  body.innerHTML = `<p class="muted">Couldn't load this. Check your internet and try again.</p>`;
}

async function renderArtist(artistId: number, hintName: string, t: number): Promise<void> {
  setLoading("Artist", hintName);
  const page = await fetchArtistPage(artistId, hintName);
  if (t !== token) return;
  const genre = page.artist.subtitle && page.artist.subtitle !== "Artist" ? page.artist.subtitle.replace(/ artist$/, "") : "";
  setHeader("Artist", page.artist.name, escapeHtml(genre), page.artist.artwork);
  tracks = page.topSongs;
  body.innerHTML = `
    ${
      tracks.length
        ? `<h2 class="section-title">Popular</h2>
           <div class="playlist-track-list">${tracks.map((s, i) => trackRowMarkup(s, i)).join("")}</div>`
        : ""
    }
    ${
      page.albums.length
        ? `<h2 class="section-title">Albums</h2>
           <div class="card-grid">${page.albums.map((a) => cardMarkup(a, "albums")).join("")}</div>`
        : ""
    }
  `;
  playBtn.disabled = !tracks.length;
  radioBtn.disabled = !tracks.length;
}

async function renderAlbum(collectionId: number, t: number): Promise<void> {
  setLoading("Album", "");
  const page = await fetchAlbumPage(collectionId);
  if (t !== token) return;
  const artistName = page.album.subtitle.replace(/^\d{4} · /, "");
  const artistLink = page.album.artistId
    ? `<a class="detail-artist-link" data-artist="${page.album.artistId}" data-artist-name="${escapeHtml(artistName)}" href="#">${escapeHtml(artistName)}</a>`
    : escapeHtml(artistName);
  const bits = [artistLink, page.year ? String(page.year) : "", `${page.tracks.length} songs`].filter(Boolean);
  setHeader("Album", page.album.name, bits.join(" · "), page.album.artwork);
  // Album songs carry the album's art (lookups often omit it on tracks).
  tracks = page.tracks.map((s) => ({ ...s, artwork: s.artwork ?? page.album.artwork }));
  body.innerHTML = `<div class="playlist-track-list">${tracks.map((s, i) => trackRowMarkup(s, i, false)).join("")}</div>`;
  playBtn.disabled = !tracks.length;
  radioBtn.disabled = !tracks.length;
}

/** view is "artist:<id>[:name]" or "album:<id>". */
export function renderDetail(view: string): void {
  const t = ++token;
  const [kind, id, ...rest] = view.split(":");
  const job =
    kind === "artist" ? renderArtist(Number(id), decodeURIComponent(rest.join(":")), t) : renderAlbum(Number(id), t);
  job.catch(() => t === token && showError());
}

export function initDetail(): void {
  playBtn.addEventListener("click", () => {
    if (!tracks.length) return;
    tracks.forEach((s) => trackRegistry.set(s.id, s));
    const start = isShuffleOn() ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[0];
    setQueue(
      tracks.map((s) => s.id),
      start.id,
    );
    void playTrack(start.id);
  });
  radioBtn.addEventListener("click", () => {
    if (tracks[0]) void startRadio(tracks[0]);
  });
}
