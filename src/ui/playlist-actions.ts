// Removing a song from a playlist. In a shared playlist that's a choice:
// remove it for everyone (owner, or whoever added it) or just hide it for me.
import { canRemoveForEveryone, getPlaylists, hideTrack, removeTrackFromPlaylist } from "../library/playlists";
import { bus } from "../state";
import { chooseOption } from "./choice";

export async function removeSong(playlistId: string, trackId: string, name: string): Promise<void> {
  const playlist = getPlaylists()[playlistId];
  if (!playlist) return;
  if (!playlist.shared) {
    removeTrackFromPlaylist(playlistId, trackId);
    bus.emit("toast", `Removed from "${playlist.name}"`);
    return;
  }
  const canRemove = canRemoveForEveryone(playlist, trackId);
  const choice = await chooseOption<"all" | "hide">(
    `Remove "${name}"?`,
    [
      ...(canRemove ? [{ label: "Remove for everyone", value: "all" as const, danger: true }] : []),
      { label: "Just hide it for me", value: "hide" as const },
    ],
    canRemove
      ? "Hiding keeps it for the others. You can show hidden songs again at the bottom of the playlist."
      : `Only ${playlist.ownerName ?? "the owner"} or whoever added it can remove it for everyone. You can hide it for yourself.`,
  );
  if (choice === "all") {
    removeTrackFromPlaylist(playlistId, trackId);
    bus.emit("toast", `Removed from "${playlist.name}" for everyone`);
  } else if (choice === "hide") {
    hideTrack(playlistId, trackId);
    bus.emit("toast", "Hidden for you");
  }
}

/** Toast when an add was refused. */
export function addRefused(playlistId: string): void {
  const playlist = getPlaylists()[playlistId];
  bus.emit("toast", `Only ${playlist?.ownerName ?? "the owner"} adds songs to "${playlist?.name ?? "this playlist"}"`);
}
