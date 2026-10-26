// Playlists are stored as full track snapshots (not just ids) so a saved
// playlist stays playable after a reload, even if its tracks no longer show
// up in a live search.
import { KEYS } from "../config";
import { bus } from "../state";
import type { Item, Playlists } from "../types";
import { storage } from "../utils";

export function getPlaylists(): Playlists {
  return storage.get<Playlists>(KEYS.playlists, {});
}

function save(playlists: Playlists): void {
  storage.set(KEYS.playlists, playlists);
  bus.emit("playlistschange", undefined);
}

export function createPlaylist(name: string): string {
  const playlists = getPlaylists();
  const id = `playlist-${Date.now()}`;
  playlists[id] = { id, name: name.trim() || "New Playlist", tracks: [] };
  save(playlists);
  return id;
}

export function deletePlaylist(id: string): void {
  const playlists = getPlaylists();
  delete playlists[id];
  save(playlists);
}

export function addTrackToPlaylist(playlistId: string, item: Item): void {
  const playlists = getPlaylists();
  const playlist = playlists[playlistId];
  if (!playlist || playlist.tracks.some((t) => t.id === item.id)) return;
  playlist.tracks.push({ ...item });
  save(playlists);
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): void {
  const playlists = getPlaylists();
  const playlist = playlists[playlistId];
  if (!playlist) return;
  playlist.tracks = playlist.tracks.filter((t) => t.id !== trackId);
  save(playlists);
}
