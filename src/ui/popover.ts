// "Add to playlist" popover opened from a card's + button.
import { addTrackToPlaylist, createPlaylist, getPlaylists, removeTrackFromPlaylist } from "../library/playlists";
import { addToQueueEnd, playNextInsert, queueFromElement, playTrack } from "../player/player";
import { startRadio } from "../player/radio";
import { isLiked, isLikedPlaylist, toggleLike } from "../library/liked";
import { bus, trackRegistry } from "../state";
import { $, escapeHtml } from "../utils";
import { pushStep, removeStep } from "./back";
import { markManual } from "./queue";

const popover = $("add-to-playlist-popover");

function close(): void {
  removeStep("popover");
  popover.style.display = "none";
  popover.innerHTML = "";
}

export function openAddToPlaylist(trackId: string, anchorEl: HTMLElement): void {
  const item = trackRegistry.get(trackId);
  if (!item) return;
  const playlists = getPlaylists();
  // Liked Songs has its own ❤️ action; other playlists listed below it.
  const ids = Object.keys(playlists).filter((id) => !isLikedPlaylist(playlists[id]));
  const liked = isLiked(trackId);

  let html = `
    <button class="popover-action" data-action="next">▶ Play next</button>
    <button class="popover-action" data-action="queue">➕ Add to queue</button>
    <button class="popover-action" data-action="like">${liked ? "💔 Remove from Liked Songs" : "❤️ Like"}</button>
    <button class="popover-action" data-action="radio">📻 Start radio</button>
    <div class="popover-divider"></div>
    <div class="popover-label">Add to playlist</div>
  `;
  html += ids.length
    ? ids
        .map((id) => {
          const checked = playlists[id].tracks.some((t) => t.id === trackId);
          return `<button class="popover-item${checked ? " checked" : ""}" data-playlist="${escapeHtml(id)}">${escapeHtml(playlists[id].name)}</button>`;
        })
        .join("")
    : `<div class="playlist-nav-empty">No playlists yet — create one below.</div>`;
  html += `
    <div class="popover-divider"></div>
    <form class="popover-new-form">
      <input type="text" placeholder="New playlist name" maxlength="60" autocomplete="off" />
      <button type="submit">Create</button>
    </form>
  `;
  popover.innerHTML = html;

  const rect = anchorEl.getBoundingClientRect();
  popover.style.display = "block";
  pushStep("popover", close);
  const width = popover.offsetWidth || 220;
  popover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 200)}px`;
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 16))}px`;

  popover.querySelectorAll<HTMLElement>(".popover-action").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "next") {
        playNextInsert(item);
        markManual(item.id);
        bus.emit("toast", `▶ "${item.name}" plays next`);
      } else if (action === "queue") {
        addToQueueEnd(item);
        markManual(item.id);
        bus.emit("toast", `➕ Added "${item.name}" to the queue`);
      } else if (action === "like") toggleLike(item);
      else if (action === "radio") void startRadio(item);
      close();
    });
  });

  popover.querySelectorAll<HTMLElement>(".popover-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.playlist!;
      if (btn.classList.contains("checked")) removeTrackFromPlaylist(pid, trackId);
      else addTrackToPlaylist(pid, item);
      close();
    });
  });

  popover.querySelector<HTMLFormElement>(".popover-new-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (e.currentTarget as HTMLFormElement).querySelector("input")!.value.trim();
    if (!name) return;
    addTrackToPlaylist(createPlaylist(name), item);
    close();
  });
}

export function initPopover(): void {
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    const addBtn = target.closest<HTMLElement>(".add-overlay");
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      openAddToPlaylist(addBtn.dataset.id!, addBtn);
      return;
    }
    if (popover.style.display !== "none" && !popover.contains(target)) close();
  });

  // A plain click on a track card plays it in-app instead of following the
  // link out to YouTube/Apple Music; the href stays for long-press/new-tab.
  // Registered after the play/add handlers so their preventDefault is seen.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const link = (e.target as Element).closest<HTMLElement>("a.card[data-id], a.top-result-card[data-id]");
    if (!link) return;
    e.preventDefault();
    queueFromElement(link);
    void playTrack(link.dataset.id!);
  });
}
