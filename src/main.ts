import "./style.css";
import { initLyrics } from "./player/lyrics";
import { initMediaControls } from "./player/media-controls";
import { initPlayer } from "./player/player";
import { initLayout } from "./ui/layout";
import { initPopover } from "./ui/popover";
import { initSearch } from "./ui/search";
import { initSettings } from "./ui/settings";
import { initTheme } from "./ui/theme";
import { initViews } from "./ui/views";

// Order matters for the document-level click handlers: play buttons first,
// then add-to-playlist, then the plain card click (see ui/popover.ts).
initLayout();
initTheme();
initPlayer();
initMediaControls();
initLyrics();
initPopover();
initViews();
initSettings();
initSearch();
