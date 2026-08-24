# MuseMint 0.9.2

MuseMint is a local-first Chrome extension that discovers better additions for the YouTube Music playlist you are viewing and adds them in one click.

## Install it

1. Open `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `musemint` folder.
4. Open a playlist at `https://music.youtube.com/playlist?list=...`.
5. Click **Find gems**, then **Mint discoveries**.

After a successful add, MuseMint refreshes the current playlist through YouTube Music's client-side router. The page does not perform a full reload and the MuseMint panel stays open.

You can also pin MuseMint and click its toolbar icon to open or close the panel.

## Why the recommendations are different

MuseMint does not extend the final track or repeat a single artist cluster. Its taste engine:

- samples up to seven artist-diverse anchors across the whole playlist;
- explores each anchor's separate related-track neighborhood;
- rewards candidates reached from multiple, distant anchors;
- removes tracks already present, normalized duplicates, and repeated artists;
- uses maximal marginal relevance to trade off fit against similarity;
- exposes **Adventure** and **Artist novelty** controls;
- optionally asks Chrome's on-device language model to rerank the shortlist for mood, texture, and surprising bridges.

The graph ranking always works without an AI model download. If Chrome's `LanguageModel` API is available, the panel labels the engine **On-device AI + taste graph**. No API key is required.

## Privacy and permissions

The extension runs only on `music.youtube.com`. It does not use analytics, a remote server, or remotely hosted code. Playlist contents stay in the browser. It uses your existing YouTube Music session only to read recommendations and perform the add you explicitly click.

Required site access:

- `https://music.youtube.com/*` — show the panel and communicate with YouTube Music.

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
- `page-bridge.js` — narrow same-origin bridge for related tracks and playlist edits.
- `service-worker.js` — toolbar toggle.
- `tests/core.test.js` — ranking invariant tests.
