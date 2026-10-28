// Bridge to the Android NativeAudio plugin: full songs from YouTube Music
// with no API key, played by ExoPlayer. Not available on the web/laptop.
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Item } from "../types";

interface NativeTrack {
  key: string;
  title: string;
  artist: string;
  durationMs: number;
}

interface NativeAudioPlugin {
  play(track: NativeTrack): Promise<{ cancelled: boolean; videoId?: string | null }>;
  prefetch(track: NativeTrack & { wait?: boolean }): Promise<void>;
  radio(o: { key: string; videoId?: string }): Promise<{
    tracks: { videoId: string; title: string; artist: string; durationSec: number; artwork: string | null }[];
  }>;
  crossfade(o: NativeTrack & { seconds: number }): Promise<{ cancelled: boolean; videoId?: string | null }>;
  musicVideo(o: NativeTrack & { audioSec: number }): Promise<{ videoId?: string | null }>;
  storageInfo(): Promise<{ bytes: number; songs: number; limitMb: number }>;
  setCacheLimit(o: { mb: number }): Promise<void>;
  clearCache(): Promise<{ deleted: number }>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  seek(o: { position: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "state", fn: (e: { playing: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: "progress",
    fn: (e: { position: number; duration: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: "ended", fn: () => void): Promise<PluginListenerHandle>;
  addListener(event: "error", fn: (e: { message?: string }) => void): Promise<PluginListenerHandle>;
}

export const nativeAudio = registerPlugin<NativeAudioPlugin>("NativeAudio");
export const hasNativeAudio = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export function toNativeTrack(item: Item): NativeTrack {
  return {
    key: item.id,
    title: item.name,
    artist: item.subtitle,
    durationMs: item.durationMs ?? 0,
  };
}
