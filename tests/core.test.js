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
