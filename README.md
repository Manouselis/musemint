# YouTube Music Playlist Suggester — MuseMint 1.2.0

MuseMint is a local-first Chrome extension that discovers better additions for the YouTube Music playlist you are viewing and adds them in one click.

## Install it

1. Open `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `musemint` folder.
4. Open a playlist at `https://music.youtube.com/playlist?list=...`.
5. Click **Find gems**, then **Mint discoveries**.

Successful adds never navigate away from the current page. The MuseMint panel stays open and marks every added track immediately.

You can also pin MuseMint and click its toolbar icon to open or close the panel.

## Why the recommendations are different

MuseMint does not extend the final track or repeat a single artist cluster. Its taste engine:

- samples up to seven artist-diverse anchors across the whole playlist;
- explores each anchor's separate related-track neighborhood;
- rewards candidates reached from multiple, distant anchors;
- removes tracks already present, normalized duplicates, and repeated artists;
- uses maximal marginal relevance to trade off fit against similarity;
- exposes **Adventure** and **Artist novelty** controls;
- makes **Remix picks** produce a new diversity-preserving variation;
- plays a chorus-biased 20-second preview without leaving the playlist, pausing and restoring current playback;
- matches preview volume and mute state to the active YouTube Music player;
- treats an add as positive taste feedback and learns locally from dislikes;
- reads every playlist continuation page before ranking or duplicate removal;
- reads both legacy and current YouTube Music playlist-row response formats;
- supports discovery from playlists containing just one playable track;
- preserves delegated/brand-account identity when reading private playlists;
- falls back through the playlist queue and the playlist page data when the browse endpoint returns no track rows;
- automatically regenerates when YouTube Music switches playlists without a page reload;
- offers a **Popularity** control from deep cuts to bigger hits.
- verifies shortlisted songs against YouTube's playlist-membership state before displaying them.

MuseMint uses a deterministic, inspectable taste graph. It does not use a language model, cloud model, or API key.

## Privacy and permissions

The extension runs only on `music.youtube.com`. It does not use analytics, a remote server, or remotely hosted code. Playlist contents stay in the browser. It uses your existing YouTube Music session only to read recommendations and perform the add you explicitly click.

Required site access:

- `https://music.youtube.com/*` — show the panel and communicate with YouTube Music.
- `storage` — remember local recommendation feedback. It is never uploaded by MuseMint.

## Verification

Run the pure recommendation-engine tests with Node.js:

```powershell
node --test tests/core.test.js
```

The integration boundary uses YouTube Music's first-party web requests. Because that web application is not a public extension API, a future YouTube UI/API change may require updating `page-bridge.js` or the renderer parser in `content.js`.

## Files

- `manifest.json` — Manifest V3 package definition.
- `content.js` / `content.css` — panel, extraction, ranking workflow, and interaction design.
- `core.js` — deterministic taste-graph ranking engine.
- `pagination.js` — complete playlist continuation and membership-ID utilities.
- `page-bridge.js` — narrow same-origin bridge for related tracks and playlist edits.
- `service-worker.js` — toolbar toggle.
- `tests/core.test.js` — ranking invariant tests.
