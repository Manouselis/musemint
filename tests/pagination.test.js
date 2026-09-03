const assert = require("node:assert/strict");
const test = require("node:test");
const Pagination = require("../pagination.js");

test("collectAll follows every continuation in order", async () => {
  const fetched = [];
  const pages = {
    two: { items: [2], continuationCommand: { token: "three" } },
    three: { items: [3] }
  };
  const result = await Pagination.collectAll(
    { items: [1], continuationCommand: { token: "two" } },
    async (token) => { fetched.push(token); return pages[token]; }
  );
  assert.deepEqual(fetched, ["two", "three"]);
  assert.deepEqual(result.pages.flatMap((page) => page.items), [1, 2, 3]);
  assert.equal(result.complete, true);
});

test("collectAll stops repeated continuation tokens", async () => {
  let calls = 0;
  const result = await Pagination.collectAll(
    { continuationCommand: { token: "repeat" } },
    async () => { calls++; return { continuationCommand: { token: "repeat" } }; }
  );
  assert.equal(calls, 1);
  assert.equal(result.complete, true);
});

test("collectAll reports truncation at its explicit page safety limit", async () => {
  let index = 1;
  const result = await Pagination.collectAll(
    { continuationCommand: { token: "1" } },
    async () => ({ continuationCommand: { token: String(++index) } }),
    3
  );
  assert.equal(result.pageCount, 3);
  assert.equal(result.complete, false);
});

test("playlist continuation wins over unrelated shelf continuations", () => {
  const payload = {
    header: { continuationCommand: { token: "unrelated" } },
    body: { musicPlaylistShelfRenderer: { continuations: [{ nextContinuationData: { continuation: "playlist-next" } }] } }
  };
  assert.equal(Pagination.continuationToken(payload), "playlist-next");
});

test("setVideoIdFrom reads the add response membership ID", () => {
  const response = { playlistEditResults: [{ playlistEditVideoAddedResultData: { videoId: "set-123" } }] };
  assert.equal(Pagination.setVideoIdFrom(response, "song-1"), "set-123");
});

test("setVideoIdFrom falls back to matching a playlist renderer", () => {
  const response = { pages: [{ musicResponsiveListItemRenderer: { playlistItemData: {
    videoId: "song-1", playlistSetVideoId: "set-from-playlist"
  } } }] };
  assert.equal(Pagination.setVideoIdFrom(response, "song-1"), "set-from-playlist");
});

test("setVideoIdFrom supports current play-button and menu response fields", () => {
  const response = { pages: [{ musicResponsiveListItemRenderer: {
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: {
      playNavigationEndpoint: { watchEndpoint: { videoId: "song-2", playlistSetVideoId: "set-from-play" } }
    } } } },
    menu: { menuRenderer: { items: [{ menuServiceItemRenderer: { serviceEndpoint: { playlistEditEndpoint: {
      actions: [{ removedVideoId: "song-2", setVideoId: "set-from-menu" }]
    } } } }] } }
  } }] };
  assert.equal(Pagination.setVideoIdFrom(response, "song-2"), "set-from-play");
});

test("playlistOptionSelected detects every supported selected-state shape", () => {
  assert.equal(Pagination.playlistOptionSelected({ playlistAddToOptionRenderer: {
    playlistId: "PLTARGET", containsSelectedVideos: true
  } }, "PLTARGET"), true);
  assert.equal(Pagination.playlistOptionSelected({ addToPlaylistItemRenderer: {
    selected: true, serviceEndpoint: { playlistEditEndpoint: { playlistId: "PLTARGET" } }
  } }, "VLPLTARGET"), true);
  assert.equal(Pagination.playlistOptionSelected({ musicResponsiveListItemRenderer: {
    navigationEndpoint: { browseEndpoint: { browseId: "VLPLTARGET" } },
    checkboxRenderer: { checkedState: "CHECKBOX_CHECKED_STATE_CHECKED" }
  } }, "PLTARGET"), true);
});

test("playlistOptionSelected does not confuse a different or unchecked playlist", () => {
  const response = { addToPlaylistRenderer: { contents: [
    { playlistAddToOptionRenderer: { playlistId: "PLOTHER", containsSelectedVideos: true } },
    { playlistAddToOptionRenderer: { playlistId: "PLTARGET", containsSelectedVideos: false } }
  ] } };
  assert.equal(Pagination.playlistOptionSelected(response, "PLTARGET"), false);
});

test("playlistOptionsFrom extracts titles, canonical IDs, and selected state", () => {
  const response = { addToPlaylistRenderer: { contents: [
    { playlistAddToOptionRenderer: {
      playlistId: "PLONE", title: { runs: [{ text: "Road trip" }] }, containsSelectedVideos: true
    } },
    { addToPlaylistItemRenderer: {
      title: { simpleText: "Late night" }, subtitle: { simpleText: "Private" },
      serviceEndpoint: { playlistEditEndpoint: { playlistId: "PLTWO" } }
    } },
    { musicResponsiveListItemRenderer: {
      navigationEndpoint: { browseEndpoint: { browseId: "VLPLTHREE" } },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Running" }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "42 songs" }] } } }
      ],
      checkboxRenderer: { checkedState: "CHECKBOX_CHECKED_STATE_CHECKED" }
    } }
  ] } };
  assert.deepEqual(Pagination.playlistOptionsFrom(response), [
    { playlistId: "PLONE", title: "Road trip", subtitle: "", selected: true },
    { playlistId: "PLTWO", title: "Late night", subtitle: "Private", selected: false },
    { playlistId: "PLTHREE", title: "Running", subtitle: "42 songs", selected: true }
  ]);
});

test("playlistOptionsFrom deduplicates playlist renderers and preserves a later checked state", () => {
  const response = { contents: [
    { playlistAddToOptionRenderer: { playlistId: "PLONE", title: { simpleText: "One" } } },
    { addToPlaylistItemRenderer: { playlistId: "PLONE", selected: true, title: { simpleText: "Duplicate" } } }
  ] };
  assert.deepEqual(Pagination.playlistOptionsFrom(response), [
    { playlistId: "PLONE", title: "One", subtitle: "", selected: true }
  ]);
});
