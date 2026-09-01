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
