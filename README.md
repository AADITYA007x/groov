# Spotify-style search (independent implementation)

A from-scratch search UI inspired by the UX *pattern* observed in Spotify's
desktop app (static analysis of its bundled `xpui.spa` web UI, v1.3.5.3058).
No Spotify code, assets, or API credentials were used — this is original
HTML/CSS/JS, backed by the free iTunes Search API for real catalog data.

## What was observed (evidence, not implementation)

- Two-tier search: a broad overview query returning a "top result" plus a
  handful of items per category, then a separate per-category query when the
  user drills into "See all".
- Categories: songs, artists, albums, playlists (Spotify's real app also
  covers podcasts, episodes, audiobooks, genres — trimmed here to what the
  iTunes Search API exposes: songs, artists, albums).
- Recent searches persisted locally, shown when the input is empty
  (`.length < 1` guard), with a "clear recent searches" action.
- An empty-results state with a "check your spelling" hint.

Exact debounce timing wasn't recoverable from static strings (the utility
lives in a shared vendor chunk); this implementation uses the common 300ms
default.

**Recommendations** were also analyzed, with a different outcome: route
chunks (`xpui-routes-taste-profile.js`, artist-page "fans also like" error
keys, `*-more-like-this.js`) confirm the *surfaces* exist, but unlike search
there's no client-side persisted-query logic to inspect — recommendation
ranking is computed server-side by Spotify's ML systems (collaborative
filtering, audio analysis, NLP on playlists), so there's no algorithm for
client code, or this project, to extract. What's replicated below is the UX
pattern, not the ranking model.

## What was built

- [index.html](index.html) / [style.css](style.css) / [script.js](script.js) / [data.js](data.js) / [config.js](config.js)
- Debounced search-as-you-type (`DEBOUNCE_MS = 300`) against the live
  [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) — free, CORS-open, no key required.
- Scored "top result" (exact > prefix > substring match) across songs,
  artists, and albums.
- Per-category sections with expand/collapse ("See all" fetches a fresh,
  larger result set rather than just revealing cached items).
- Recent searches in `localStorage`, click-to-search, clear-all.
- Empty state and a network-error fallback.
- Stale-request cancellation via `AbortController` so a slow response can't
  clobber a newer search.

## Trending now

Live Apple Music/iTunes top-songs chart — `itunes.apple.com/us/rss/topsongs/...`,
the same free, CORS-open, no-key host as search. Shown on the Home view
(empty search box), above Recommended. No setup needed.

## Recommended for you

A heuristic "More like this," not Spotify's actual ranking (see above) — built
from signals already on hand instead of a new API:

- **"More by \<artist\>"**: the artist(s) with the most tracks across all your
  playlists, expanded via `itunes.apple.com/lookup?id=<artistId>&entity=song`.
- **"Because you like \<Genre\>"**: your most common playlisted genre
  (iTunes' `primaryGenreName`), fed back into a regular search.
- Tracks already in a playlist are filtered out of their own recommendations.
- Empty until you've added at least one song to a playlist — there's no
  signal to recommend from before that.

## Playlists

A left sidebar (Spotify's "Your Library" pattern) holds user-created
playlists, stored in `localStorage` as full track snapshots — not just ids —
so a playlist stays playable after a reload even if that track isn't in a
live search anymore.

- **Create**: the `+` next to "Your Playlists" in the sidebar, or the
  "Create new playlist" field inside the add-to-playlist popover.
- **Add**: hover any song card (or the top result) and click the `+` overlay
  button; a popover lists your playlists (✓ if the track's already in one)
  plus a quick-create field.
- **View / play / remove**: click a playlist in the sidebar for a row list
  with per-track play buttons (same playback engine as search results —
  full-length via YouTube if configured, 30s preview otherwise) and a remove
  (✕) button.
- **Delete**: "Delete playlist" at the top of the playlist view.

Navigating between Search and a playlist never interrupts playback — the
player bar keeps running in the background regardless of which view is open.

## Playback

Hover a song card (or the top result, if it's a song) to reveal a play
button. Two engines, picked automatically per track:

1. **iTunes 30s preview** (default, always available) — zero setup, no
   account, no API key. This is what you get out of the box.
2. **Full-length via YouTube** — used automatically once you add a free
   YouTube Data API v3 key to `config.js`. Falls back to the 30s preview on
   any lookup failure (no key, quota exhausted, no matching video, network
   error), so the app degrades gracefully either way.

### Enabling full-length playback

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   sign in.
2. Create a new project (any name).
3. **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**.
4. **APIs & Services → Credentials → Create Credentials → API key**.
5. Copy the key into `config.js`:
   ```js
   const YOUTUBE_API_KEY = "paste-your-key-here";
   ```

The free tier is 10,000 units/day; each search costs 100 units (~100
searches/day). Found video IDs are cached in `localStorage` so repeat
searches for the same track don't re-spend quota. `config.js` is
git-ignored — copy `config.example.js` if you need a fresh template, and
never commit a real key to a public repo.

Playback itself (once a video ID is known) uses the YouTube IFrame Player
API, which needs no key and is free — only the *search* to find the video
costs quota.

## Run it

```bash
python3 -m http.server 4173 --directory .
```
then open http://localhost:4173.
