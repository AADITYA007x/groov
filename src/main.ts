import "./style.css";
import { initLyrics } from "./player/lyrics";
import { initMediaControls } from "./player/media-controls";
import { initPlayer } from "./player/player";
import { initSession } from "./cloud/session";
import { initSync } from "./cloud/sync";
import { initPresence } from "./cloud/presence";
import { initJam } from "./cloud/jam";
import { initFriends } from "./ui/friends";
import { initRadio, shuffleLibrary, surpriseMe } from "./player/radio";
import { initAccount } from "./ui/account";
import { initBack } from "./ui/back";
import { initLayout } from "./ui/layout";
import { initNowPlaying } from "./ui/now-playing";
import { initPopover } from "./ui/popover";
import { initSearch } from "./ui/search";
import { initSettings } from "./ui/settings";
import { initTheme } from "./ui/theme";
import { initViews } from "./ui/views";
import { initDetail } from "./ui/detail";
import { initQueue } from "./ui/queue";

// Order matters for the document-level click handlers: play buttons first,
// then add-to-playlist, then the plain card click (see ui/popover.ts).
initBack();
initLayout();
initTheme();
initPlayer();
initNowPlaying();
initMediaControls();
initLyrics();
initPopover();
initViews();
initDetail();
initQueue();
initSettings();
initAccount();
initSync();
initPresence();
initJam();
initFriends();
initSession(); // last: its first auth event drives sync and the UI
initSearch();
initRadio();
document.getElementById("surprise-btn")!.addEventListener("click", () => void surpriseMe());
document.getElementById("shuffle-library-btn")!.addEventListener("click", () => void shuffleLibrary());
