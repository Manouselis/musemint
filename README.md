<p align="center"><img src="icons/icon-128.png" width="64" height="64" alt="MuseMint icon"></p>
<h1 align="center">MuseMint</h1>
<p align="center">Find your next favorite. Keep it in your playlist.</p>

MuseMint is a Chrome extension for discovering songs connected to the YouTube Music playlist you have open. Preview a suggestion, adjust your discovery settings, and add it to a playlist without leaving the page.

**Version 1.5.1** · No account setup · No API key to supply · No developer server

## Get started

1. Download this repository using **Code → Download ZIP** and extract it, or clone it with Git.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Enable **Developer mode**, select **Load unpacked**, and choose the extracted folder containing `manifest.json`.
4. Open a playlist at `https://music.youtube.com/playlist?list=...`.
5. Select **Find gems → Mint discoveries**. MuseMint reads the playlist, explores related songs, and verifies that its picks are new to that playlist.

Pin MuseMint to the browser toolbar for quick access. Its toolbar button toggles the panel. Press **Escape** to close a playlist chooser or the panel.

**After an update:** click Reload on MuseMint's extension card, then refresh your YouTube Music tab. An already-open tab keeps its previous scripts until refreshed.

## Make a playlist your own

| Control | What it does |
| --- | --- |
| **▶ Preview** | Plays a 20-second excerpt, matching the native player's volume and mute setting. |
| **Add** | Adds the song and shows it immediately in the open playlist without refreshing. Click **Added** to remove that addition and reverse its taste feedback. |
| **⌄ Choose playlist** | Opens your editable playlists. Hovering over Add for 0.75 seconds or focusing the control also opens the chooser. |
| **↓ Dislike** | Removes the song from recommendations and learns for the open playlist. Confirmation disappears after four seconds. |
| **× Hide** | Hides a pick for this tab session without recording a dislike. If the batch becomes empty, **Show hidden picks** restores hidden recommendations. |
| **Remix picks** | Looks for a fresh batch of verified titles you haven't seen in this session. If the pool is exhausted, your current picks remain visible. |
| **Cancel discovery** | Stops waiting for a discovery or remix run and ignores its late results. Requests already sent may still finish in the background. |

Previewing pauses the native player and normally restores it when the preview ends. If you press Play in YouTube Music yourself, MuseMint stops the preview and leaves native playback in control. Some tracks may not permit embedded previews.

Adds teach the **destination playlist**; dislikes teach the **open playlist**. Feedback does not transfer between playlists. The other-playlist chooser marks completed additions but does not provide an undo button; remove those songs in YouTube Music if needed.

## Tune your discoveries

Each slider displays its current percentage. Changes reorder the verified pool; **Remix picks** searches for unseen titles.

| Setting | Lower | Higher | Starting value |
| --- | --- | --- | --- |
| **Adventure** | Closer to the seed's top related tracks | More exploratory picks | 100% |
| **Artist novelty** | More artists already in the playlist | More unfamiliar artists | 50% |
| **Popularity** | Deeper cuts | Bigger-hit preference | 100% |

These are ranking preferences, not guarantees or genre filters. Popularity is estimated from related-track ranking and agreement between playlist anchors, not measured play counts. Slider values last for the current tab session. Hover over or focus **Taste graph** for a short explanation inside the panel.

## How recommendations work

MuseMint samples up to seven anchors across the whole playlist, favoring different artists and including the final track. It requests a song radio for each anchor, rewards songs connected to multiple anchors, and balances fit with artist diversity.

Later anchors receive a small bonus. **Playlist order is the proxy for recency**: manually sorting or reordering a playlist can differ from its actual addition history. YouTube's radio results may themselves be personalized; MuseMint does not read your Liked Music library as a separate recommendation source.

Only playlist track containers become seeds. Unrelated response shelves and the currently playing queue are excluded. MuseMint loads continuation pages, filters duplicate song identities and alternate uploads, then checks candidates against YouTube's playlist-membership state. Unverified candidates are excluded. If radios produce too few candidates, it also searches using the anchor's artist and title.

The ranking engine is deterministic JavaScript. It uses no language model or cloud inference service.

## Troubleshooting

| Symptom | Try this |
| --- | --- |
| Panel or new features are missing | Reload the extension, then refresh YouTube Music. Check that the extension is enabled. |
| No playlist is detected | Open an actual playlist page with a `list=` value in its URL. |
| Discovery takes too long | Large playlists require more requests. Use **Cancel discovery**, then retry when YouTube Music is responsive. |
| No fresh batch is available | The current candidate pool may be exhausted or remaining tracks couldn't be verified. Adjust the sliders to reorder current picks, or open another playlist. |
| Add shows **Retry** | Read the message below the results. Confirm that you can edit the destination in YouTube Music, refresh, and retry. MuseMint checks membership before resending an add to avoid duplicates. |
| A preview is silent | Check the native player's volume and mute state. A song may also block embedded playback. |
| Recommendations feel off | Try less Adventure. Check the actual playlist contents and order; later tracks receive a small preference. |

YouTube Music's web interface is not a supported public extension API. Changes to its response formats can require an extension update. When reporting a bug, include the extension version, the action you took, and the visible error. Avoid sharing private playlist contents or account information.

## Privacy

MuseMint runs only on `music.youtube.com`. It communicates with YouTube and YouTube Music using your active session. There is no analytics, developer server, or remotely hosted extension code.

The `storage` permission keeps track/artist feedback locally, keyed by playlist ID. Playlist names and contents stay in tab memory. Opening the playlist chooser performs a read-only lookup; it does not edit anything. Edits happen only after an explicit click. See [PRIVACY.md](PRIVACY.md) for details.

## Development

No build step or npm install is required to load the extension. Run the tests with Node.js:

```sh
node --test tests/*.test.js
```

| File | Purpose |
| --- | --- |
| `content.js` / `content.css` | Panel, discovery workflow, previews, and interactions |
| `core.js` | Ranking, duplicate detection, and playlist-specific feedback |
| `playlist-view.js` | Immediate playlist-row updates and reconciliation after page rerenders |
| `pagination.js` | Track containers, continuation pages, membership, and edit IDs |
| `page-bridge.js` | Same-origin YouTube Music requests and native-player coordination |
| `manifest.json` / `service-worker.js` | Extension configuration and toolbar toggle |
| `icons/` / `scripts/render-icons.py` | Small-size icon assets and their Pillow renderer |
| `tests/` | Ranking, source isolation, edits, playback handoff, and UI-state regressions |

Tests use simulated responses and player state. They do not replace checking the unpacked extension in a signed-in YouTube Music tab. For UI changes, check keyboard navigation, narrow windows, cancellation, empty results, and native-player access as well as the happy path.
