const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../core.js");

const seeds = [
  { videoId: "s1", title: "Red Moon", artist: "Atlas" },
  { videoId: "s2", title: "Glass Roads", artist: "Mara" },
  { videoId: "s3", title: "Wire", artist: "Atlas" }
];

test("dedupe removes playlist tracks, duplicate IDs, and normalized title/artist pairs", () => {
  const pool = [
    { videoId: "s1", title: "Red Moon", artist: "Atlas" },
    { videoId: "a", title: "New  Song", artist: "Else", sourceRank: 9 },
    { videoId: "b", title: "new song", artist: "ELSE", sourceRank: 2 }
  ];
  const result = Core.dedupe(pool, seeds);
  assert.equal(result.length, 1);
  assert.equal(result[0].videoId, "b");
});

test("dedupe blocks an existing playlist song even when YouTube returns another video ID", () => {
  const result = Core.dedupe([
    { videoId: "alternate-upload", title: "  RED moon! ", artist: "ATLAS" },
    { videoId: "new", title: "Actually New", artist: "Else" }
  ], seeds);
  assert.deepEqual(result.map((track) => track.videoId), ["new"]);
});

test("dedupe treats official-audio and Topic variants as the same song", () => {
  const playlist = [{ videoId: "original", title: "Night Drive", artist: "Chromatics" }];
  const result = Core.dedupe([
    { videoId: "official-audio", title: "Night Drive (Official Audio)", artist: "Chromatics - Topic" },
    { videoId: "new", title: "Night Shift", artist: "Chromatics" }
  ], playlist);
  assert.deepEqual(result.map((track) => track.videoId), ["new"]);
});

test("dedupe blocks featured-artist and version-label variants", () => {
  const playlist = [{ videoId: "original", title: "Signal", artist: "North feat. Vale" }];
  const result = Core.dedupe([
    { videoId: "alternate", title: "Signal (Album Version)", artist: "North" },
    { videoId: "new", title: "Signal Fire", artist: "North" }
  ], playlist);
  assert.deepEqual(result.map((track) => track.videoId), ["new"]);
});

test("dedupe blocks a distinctive exact title from an unrelated alternate uploader", () => {
  const playlist = [{ videoId: "original", title: "Everybody Wants to Rule the World", artist: "Tears for Fears" }];
  const result = Core.dedupe([
    { videoId: "fan-upload", title: "Everybody Wants to Rule the World (Official Audio)", artist: "Archive Channel" },
    { videoId: "new", title: "Head Over Heels", artist: "Tears for Fears" }
  ], playlist);
  assert.deepEqual(result.map((track) => track.videoId), ["new"]);
});

test("dedupe keeps short generic titles by genuinely different artists", () => {
  const playlist = [{ videoId: "one-home", title: "Home", artist: "Artist One" }];
  const result = Core.dedupe([{ videoId: "two-home", title: "Home", artist: "Artist Two" }], playlist);
  assert.deepEqual(result.map((track) => track.videoId), ["two-home"]);
});

test("dedupe handles accent differences and artist-prefixed upload titles", () => {
  const playlist = [{ videoId: "original", title: "Déjà Vu", artist: "Beyoncé" }];
  const result = Core.dedupe([
    { videoId: "accentless", title: "Deja Vu", artist: "Beyonce" },
    { videoId: "prefixed", title: "Beyonce - Deja Vu (Official Video)", artist: "Archive Channel" },
    { videoId: "new", title: "Green Light", artist: "Lorde" }
  ], playlist);
  assert.deepEqual(result.map((track) => track.videoId), ["new"]);
});

test("chooseSeeds spans the playlist and avoids artist monoculture", () => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({ videoId: String(i), title: `T${i}`, artist: i < 10 ? "Same" : `A${i}` }));
  const chosen = Core.chooseSeeds(tracks, 5);
  assert.equal(chosen.length, 5);
  assert.ok(new Set(chosen.map((x) => x.artist)).size >= 4);
});

test("recommendations are unique and penalize repeated artists", () => {
  const pool = [
    { videoId: "a", title: "A", artist: "Repeat", sourceRank: 1, seedId: "s1" },
    { videoId: "b", title: "B", artist: "Repeat", sourceRank: 2, seedId: "s2" },
    { videoId: "c", title: "C", artist: "Fresh", sourceRank: 3, seedId: "s1" },
    { videoId: "d", title: "D", artist: "Other", sourceRank: 4, seedId: "s3" }
  ];
  const result = Core.recommend(pool, seeds, { limit: 3, diversity: 100 });
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((x) => x.videoId)).size, 3);
  assert.ok(new Set(result.slice(0, 2).map((x) => x.artist)).size > 1);
});

test("multi-seed consensus receives a stronger score", () => {
  const pool = [
    { videoId: "bridge", title: "Bridge", artist: "New", sourceRank: 8, seedId: "s1" },
    { videoId: "bridge", title: "Bridge", artist: "New", sourceRank: 8, seedId: "s2" },
    { videoId: "single", title: "Single", artist: "Newer", sourceRank: 8, seedId: "s1" }
  ];
  const result = Core.recommend(pool, seeds, { limit: 2 });
  assert.equal(result[0].videoId, "bridge");
  assert.match(result[0].reason, /2 corners/);
});

test("multi-seed consensus survives alternate YouTube upload IDs", () => {
  const pool = [
    { videoId: "upload-a", title: "Signal (Official Audio)", artist: "North - Topic", sourceRank: 7, seedId: "s1" },
    { videoId: "upload-b", title: "Signal", artist: "North", sourceRank: 9, seedId: "s2" },
    { videoId: "single", title: "Solo", artist: "West", sourceRank: 7, seedId: "s1" }
  ];
  const result = Core.recommend(pool, seeds, { limit: 2 });
  assert.equal(result[0].videoId, "upload-a");
  assert.match(result[0].reason, /2 corners/);
});

test("disliked tracks are removed and liked artists receive an affinity boost", () => {
  const pool = [
    { videoId: "liked-artist", title: "Left Field", artist: "Fresh", sourceRank: 8, seedId: "s1" },
    { videoId: "neutral", title: "Center", artist: "Neutral", sourceRank: 2, seedId: "s1" },
    { videoId: "blocked", title: "Never Again", artist: "Blocked", sourceRank: 1, seedId: "s1" }
  ];
  const feedback = { tracks: { blocked: -1 }, artists: { fresh: 5 } };
  const result = Core.recommend(pool, seeds, { limit: 3, feedback });
  assert.ok(!result.some((track) => track.videoId === "blocked"));
  assert.equal(result[0].videoId, "liked-artist");
});

test("remix variation changes ordering without changing the candidate set", () => {
  const pool = Array.from({ length: 12 }, (_, index) => ({
    videoId: `v${index}`, title: `Track ${index}`, artist: `Artist ${index}`, sourceRank: 6, seedId: "s1"
  }));
  const first = Core.recommend(pool, seeds, { limit: 8, variation: 1 }).map((x) => x.videoId);
  const second = Core.recommend(pool, seeds, { limit: 8, variation: 2 }).map((x) => x.videoId);
  assert.notDeepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
  assert.equal(new Set(second).size, second.length);
});

test("excludeShownTitles guarantees a remix batch has new normalized titles", () => {
  const pool = [
    { videoId: "a", title: "Night Drive (Official Audio)", artist: "One" },
    { videoId: "b", title: "New Horizon", artist: "Two" },
    { videoId: "c", title: "Glass Roads", artist: "Three" }
  ];
  const result = Core.excludeShownTitles(pool, new Set(["Night Drive", "Glass Roads"]));
  assert.deepEqual(result.map((track) => track.videoId), ["b"]);
});

test("popularity control moves deep cuts and big hits in opposite directions", () => {
  const pool = [
    { videoId: "hit", title: "Hit", artist: "One", sourceRank: 1, seedId: "s1" },
    { videoId: "deep", title: "Deep", artist: "Two", sourceRank: 45, seedId: "s1" }
  ];
  const hits = Core.recommend(pool, seeds, { limit: 2, popularity: 100, adventure: 0 });
  const deep = Core.recommend(pool, seeds, { limit: 2, popularity: 0, adventure: 100 });
  assert.equal(hits[0].videoId, "hit");
  assert.equal(deep[0].videoId, "deep");
});

test("previewWindow targets the chorus region and stays inside the track", () => {
  assert.deepEqual(Core.previewWindow("4:00"), { start: 91, end: 111 });
  assert.deepEqual(Core.previewWindow("1:00"), { start: 30, end: 50 });
  assert.deepEqual(Core.previewWindow("unknown"), { start: 15, end: 35 });
});

test("playlist parser supports the current play-button response shape", () => {
  const renderer = { musicResponsiveListItemRenderer: {
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: {
      playNavigationEndpoint: { watchEndpoint: { videoId: "modern-video", playlistSetVideoId: "modern-set" } }
    } } } },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Modern Song", navigationEndpoint: { watchEndpoint: { videoId: "modern-video" } } }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Modern Artist", navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } } }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Modern Album", navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } } } } }] } } }
    ],
    fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { simpleText: "3:42" } } }]
  } };
  assert.deepEqual(Core.parseRendererTrack(renderer, "seed"), {
    videoId: "modern-video", title: "Modern Song", artist: "Modern Artist", album: "Modern Album",
    duration: "3:42", thumbnail: "", seedId: "seed", setVideoId: "modern-set", isExplicit: false
  });
});

test("playlist parser recovers unavailable tracks from the remove-menu action", () => {
  const renderer = { musicResponsiveListItemRenderer: {
    menu: { menuRenderer: { items: [{ menuServiceItemRenderer: { serviceEndpoint: { playlistEditEndpoint: {
      actions: [{ action: "ACTION_REMOVE_VIDEO", removedVideoId: "unavailable-video", setVideoId: "unavailable-set" }]
    } } } }] } },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Rare Upload" }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Uploader" }] } } }
    ]
  } };
  const parsed = Core.parseRendererTrack(renderer);
  assert.equal(parsed.videoId, "unavailable-video");
  assert.equal(parsed.setVideoId, "unavailable-set");
  assert.equal(parsed.title, "Rare Upload");
});

test("queue rows preserve the artist for duplicate detection", () => {
  const renderer = { playlistPanelVideoRenderer: {
    videoId: "queue-video",
    title: { runs: [{ text: "Queue Song" }] },
    longBylineText: { runs: [{ text: "Queue Artist" }] },
    lengthText: { runs: [{ text: "2:55" }] }
  } };
  const parsed = Core.parseRendererTrack(renderer);
  assert.equal(parsed.artist, "Queue Artist");
  assert.equal(parsed.videoId, "queue-video");
});
