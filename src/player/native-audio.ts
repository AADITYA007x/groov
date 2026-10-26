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
  play(track: NativeTrack): Promise<{ cancelled: boolean }>;
  prefetch(track: NativeTrack): Promise<void>;
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
