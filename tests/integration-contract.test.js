const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("manifest and source contain no language-model integration", () => {
  const packageText = [content, bridge, JSON.stringify(manifest)].join("\n");
  assert.doesNotMatch(packageText, /LanguageModel|aiSession|aiRerank|prepareAI/i);
});

test("the card uses Add as positive feedback and exposes no separate Like control", () => {
  assert.match(content, /recordFeedback\(track, 1\)/);
  assert.doesNotMatch(content, /mm-like|Like .*recommendations/);
});

test("playlist edits are reversible and removals carry both required IDs", () => {
  assert.match(content, /state\.added\.get\(track\.videoId\)/);
  assert.match(bridge, /ACTION_REMOVE_VIDEO/);
  assert.match(bridge, /setVideoId, removedVideoId: payload\.videoId/);
});

test("SPA playlist changes invalidate in-flight generation and regenerate", () => {
  assert.match(content, /generationId \+= 1/);
  assert.match(content, /yt-navigate-finish/);
  assert.match(content, /setTimeout\(generate, 650\)/);
});

test("preview coordinates with the main player and uses a calculated window", () => {
  assert.match(content, /bridge\("previewStart"/);
  assert.match(content, /Core\.previewWindow\(track\.duration\)/);
  assert.match(bridge, /pauseVideo/);
  assert.match(bridge, /playVideo/);
});

test("full playlist loading does not fall back to visible DOM rows", () => {
  assert.match(content, /bridge\("playlist"/);
  assert.doesNotMatch(content, /scrapeVisibleTracks/);
  assert.match(bridge, /MuseMintPagination\.collectAll/);
});
