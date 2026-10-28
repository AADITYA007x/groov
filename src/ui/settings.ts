// Sidebar settings: paste a YouTube key at runtime (no rebuild needed),
// allow background play on Android, and show which version is installed.
import { getYoutubeApiKey, hasAccountYoutubeKey, hasCustomYoutubeKey, setYoutubeApiKey } from "../config";
import { shareYoutubeKey } from "../cloud/shared";
import { isBackgroundPlayAllowed, isNativeApp, openBackgroundPlaySettings } from "../player/media-controls";
import { $ } from "../utils";
import { hasNativeAudio, nativeAudio } from "../player/native-audio";
import { getCrossfadeSeconds, setCrossfadeSeconds } from "../player/player";
import { bus } from "../state";
import { chooseOption } from "./choice";
import { isAutoplayOn, setAutoplay } from "../player/radio";

const keyBtn = $("youtube-key-btn");
const backgroundBtn = $("background-play-btn");
const versionEl = $("app-version");
const crossfadeBtn = $("crossfade-btn");
const autoplayBtn = $("autoplay-btn");

function renderAutoplay(): void {
  autoplayBtn.textContent = isAutoplayOn() ? "Autoplay: on (radio when the queue ends)" : "Autoplay: off";
}
const storageBtn = $("storage-btn");

// --- Crossfade (Android) ---------------------------------------------------------

function renderCrossfade(): void {
  const s = getCrossfadeSeconds();
  crossfadeBtn.textContent = s ? `Crossfade: ${s} seconds` : "Crossfade: off";
}

async function chooseCrossfade(): Promise<void> {
  const current = getCrossfadeSeconds();
  const choice = await chooseOption(
    "Crossfade",
    [0, 3, 6, 10].map((s) => ({ label: s ? `${s} seconds` : "Off", value: s, active: s === current })),
    "Fades each song into the next one. Works once the next song has downloaded (it downloads while the current one plays).",
  );
  if (choice === null) return;
  setCrossfadeSeconds(choice);
  renderCrossfade();
}

// --- Saved songs (Android cache) -----------------------------------------------------

const LIMITS = [300, 800, 1500, 3000];

function formatSize(bytes: number): string {
  const mb = bytes / 1e6;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1).replace(/\.0$/, "")} GB` : `${Math.round(mb)} MB`;
}

async function renderStorage(): Promise<{ bytes: number; songs: number; limitMb: number } | null> {
  try {
    const info = await nativeAudio.storageInfo();
    storageBtn.textContent = `Saved songs: ${info.songs} · ${formatSize(info.bytes)}`;
    return info;
  } catch {
    storageBtn.textContent = "Saved songs";
    return null;
  }
}

async function chooseStorage(): Promise<void> {
  const info = await renderStorage();
  const limit = info?.limitMb ?? 800;
  type Choice = number | "clear";
  const options: { label: string; value: Choice; active?: boolean; danger?: boolean }[] = LIMITS.map((mb) => ({
    label: `Keep up to ${formatSize(mb * 1e6)}`,
    value: mb,
    active: mb === limit,
  }));
  options.push({ label: "Delete saved songs now", value: "clear", danger: true });
  const note = info
    ? `${info.songs} songs saved (${formatSize(info.bytes)}). Saved songs play instantly and work offline; the oldest are removed when the limit is reached.`
    : "";
  const choice = await chooseOption<Choice>("Saved songs", options, note);
  if (choice === null) return;
  if (choice === "clear") {
    const { deleted } = await nativeAudio.clearCache().catch(() => ({ deleted: 0 }));
    bus.emit("toast", `Deleted ${deleted} saved songs`);
  } else {
    await nativeAudio.setCacheLimit({ mb: choice }).catch(() => undefined);
    bus.emit("toast", `Keeping up to ${formatSize(choice * 1e6)} of songs`);
  }
  setTimeout(() => void renderStorage(), 500);
}

function renderKeyStatus(): void {
  const key = getYoutubeApiKey();
  if (hasNativeAudio) {
    // Full songs are built in on Android; the key is only a fallback.
    keyBtn.textContent = key ? "Backup YouTube key: set ✓" : "Backup YouTube key: none (optional)";
    return;
  }
  const source = hasCustomYoutubeKey() ? "your key" : hasAccountYoutubeKey() ? "from your account" : "built-in key";
  keyBtn.textContent = key ? `YouTube: full songs (${source})` : "YouTube: add key for full songs";
}

async function renderBackgroundStatus(): Promise<void> {
  const allowed = await isBackgroundPlayAllowed();
  if (allowed === null) return;
  backgroundBtn.style.display = "block";
  backgroundBtn.textContent = allowed
    ? "Background play: allowed ✓"
    : "Background play: tap to allow (stops music being killed)";
}

export function initSettings(): void {
  renderAutoplay();
  autoplayBtn.addEventListener("click", () => {
    setAutoplay(!isAutoplayOn());
    renderAutoplay();
    bus.emit("toast", isAutoplayOn() ? "📻 Autoplay on" : "Autoplay off");
  });
  versionEl.textContent = `Groov v${__APP_VERSION__}`;
  renderKeyStatus();
  keyBtn.addEventListener("click", () => {
    const value = prompt(
      "Paste your YouTube Data API v3 key.\nLeave empty to go back to the built-in key (or 30s previews if there is none).",
      hasCustomYoutubeKey() ? getYoutubeApiKey() : "",
    );
    if (value === null) return;
    setYoutubeApiKey(value);
    renderKeyStatus();
    if (value.trim()) {
      void shareYoutubeKey(value.trim()).then((shared) => {
        if (shared) bus.emit("toast", "🔑 Key saved to your account: your other devices and friends get it too");
      });
    }
  });
  bus.on("youtubekeychange", renderKeyStatus);

  if (hasNativeAudio) {
    crossfadeBtn.style.display = "block";
    storageBtn.style.display = "block";
    renderCrossfade();
    void renderStorage();
    crossfadeBtn.addEventListener("click", () => void chooseCrossfade());
    storageBtn.addEventListener("click", () => void chooseStorage());
    document.getElementById("mobile-menu-toggle")?.addEventListener("click", () => void renderStorage());
  }

  if (isNativeApp) {
    void renderBackgroundStatus();
    backgroundBtn.addEventListener("click", () => void openBackgroundPlaySettings());
    // Re-check when coming back from Android's settings screen.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void renderBackgroundStatus();
    });
  }
}
