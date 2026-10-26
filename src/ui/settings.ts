// Sidebar settings: paste a YouTube key at runtime (no rebuild needed),
// allow background play on Android, and show which version is installed.
import { getYoutubeApiKey, hasCustomYoutubeKey, setYoutubeApiKey } from "../config";
import { isBackgroundPlayAllowed, isNativeApp, openBackgroundPlaySettings } from "../player/media-controls";
import { $ } from "../utils";

const keyBtn = $("youtube-key-btn");
const backgroundBtn = $("background-play-btn");
const versionEl = $("app-version");

function renderKeyStatus(): void {
  const key = getYoutubeApiKey();
  const source = hasCustomYoutubeKey() ? "your key" : "built-in key";
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
  });

  if (isNativeApp) {
    void renderBackgroundStatus();
    backgroundBtn.addEventListener("click", () => void openBackgroundPlaySettings());
    // Re-check when coming back from Android's settings screen.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void renderBackgroundStatus();
    });
  }
}
