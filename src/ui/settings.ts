// Sidebar settings: paste a YouTube key at runtime (no rebuild needed), and
// show which version is installed.
import { getYoutubeApiKey, hasCustomYoutubeKey, setYoutubeApiKey } from "../config";
import { $ } from "../utils";

const keyBtn = $("youtube-key-btn");
const versionEl = $("app-version");

function renderKeyStatus(): void {
  const key = getYoutubeApiKey();
  const source = hasCustomYoutubeKey() ? "your key" : "built-in key";
  keyBtn.textContent = key ? `YouTube: full songs (${source})` : "YouTube: add key for full songs";
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
}
