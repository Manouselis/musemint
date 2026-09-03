# YouTube Music Playlist Suggester — MuseMint 1.4.0

MuseMint is a local-first Chrome extension that discovers better additions for the YouTube Music playlist you are viewing and adds them in one click.

## Install it

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `musemint` folder.
4. Open a playlist at `https://music.youtube.com/playlist?list=...`.
5. Click **Find gems**, then **Mint discoveries**.

Click **Add** to add a pick to the playlist you are viewing. Hover over the split Add control, focus it with the keyboard, or click its chevron to choose another existing playlist. Successful adds never navigate away from the current page, and already-added destinations are clearly marked.

You can also pin MuseMint and click its toolbar icon to open or close the panel.

## Why the recommendations are different

MuseMint does not extend the final track or repeat a single artist cluster. Its taste engine:

- samples up to seven artist-diverse anchors across the whole playlist;
- explores each anchor's separate related-track neighborhood;
- rewards song identities reached from multiple, distant anchors, even when YouTube returns alternate upload IDs;
- removes tracks already present across alternate uploads, accents, featured-artist labels, uploader prefixes, and common version labels;
- uses an incrementally cached maximal-marginal-relevance pass to trade off fit against similarity efficiently;
- exposes **Adventure** and **Artist novelty** controls;
- makes **Remix picks** replace the list with a verified batch of normalized titles that have not appeared earlier in the session;
- plays a chorus-biased 20-second preview without leaving the playlist, pausing and restoring current playback;
- matches preview volume and mute state to the active YouTube Music player;
- treats an add as positive taste feedback and learns locally from dislikes;
- reads every playlist continuation page before ranking or duplicate removal;
- reads both legacy and current YouTube Music playlist-row response formats;
- supports discovery from playlists containing just one playable track;
- preserves delegated/brand-account identity when reading private playlists;
- falls back through the playlist queue and the playlist page data when the browse endpoint returns no track rows;
- automatically regenerates when YouTube Music switches playlists without a page reload;
- offers a **Popularity** control from deep cuts to bigger hits;
- verifies every displayed song against YouTube's playlist-membership state, retries transient failures, and excludes anything it cannot positively verify as new.

MuseMint uses a deterministic, inspectable taste graph. It does not use a language model, cloud model, or API key.

## Privacy and permissions

The extension runs only on `music.youtube.com`. It does not use analytics, a developer server, or remotely hosted code. Playlist contents and playlist-destination lookups stay in the active browser tab. Hovering or focusing the split Add control asks YouTube Music for your editable playlist names and the song's existing membership; it does not modify a playlist. MuseMint edits a playlist only after you explicitly click an Add control.

Required site access:

- `https://music.youtube.com/*` — show the panel and communicate with YouTube Music.
- `storage` — remember local recommendation feedback. It is never uploaded by MuseMint.

## Verification

Run the complete test suite with Node.js:

```powershell
node --test tests/*.test.js
```

The integration boundary uses YouTube Music's first-party web requests. Because that web application is not a public extension API, a future YouTube UI/API change may require updating `page-bridge.js` or the renderer parser in `content.js`.

## Files

- `manifest.json` — Manifest V3 package definition.
- `content.js` / `content.css` — panel, extraction, ranking workflow, and interaction design.
- `core.js` — deterministic taste-graph ranking engine.
- `pagination.js` — complete playlist continuation and membership-ID utilities.
- `page-bridge.js` — narrow same-origin bridge for related tracks and playlist edits.
- `service-worker.js` — toolbar toggle.
- `tests/*.test.js` — ranking, parser, privacy, and integration-contract tests.
