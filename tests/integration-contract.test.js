const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "page-bridge.js"), "utf8");
const core = fs.readFileSync(path.join(root, "core.js"), "utf8");
const privacy = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");
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

test("preview inherits the current player volume and mute state", () => {
  assert.match(bridge, /getVolume/);
  assert.match(bridge, /isMuted/);
  assert.match(content, /enablejsapi=1/);
  assert.match(content, /command\("setVolume"/);
  assert.match(content, /playerState\.muted \? "mute" : "unMute"/);
});

test("primary full-playlist loading does not depend on isolated DOM scraping", () => {
  assert.match(content, /bridge\("playlist"/);
  assert.doesNotMatch(content, /scrapeVisibleTracks/);
  assert.match(bridge, /MuseMintPagination\.collectAll/);
});

test("hidden panel sections cannot occupy layout space", () => {
  const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
  assert.match(css, /#musemint-root \[hidden\] \{ display: none !important; \}/);
});

test("a one-track playlist is a valid discovery seed", () => {
  assert.match(content, /state\.tracks\.length < 1/);
  assert.doesNotMatch(content, /state\.tracks\.length < 2/);
});

test("playlist loading preserves brand identity and has independent fallbacks", () => {
  assert.match(bridge, /onBehalfOfUser/);
  assert.match(bridge, /api\("next"/);
  assert.match(bridge, /pagePlaylistSnapshot/);
  assert.match(bridge, /source: "browse"/);
  assert.match(bridge, /source: "queue"/);
  assert.match(bridge, /source: "page"/);
});

test("playlist mutations strip browse-only VL prefixes", () => {
  assert.match(bridge, /replace\(\/\^VL\//);
});

test("shortlisted recommendations are verified against YouTube playlist membership", () => {
  assert.match(bridge, /playlist\/get_add_to_playlist/);
  assert.match(bridge, /MuseMintPagination\.playlistOptionState/);
  assert.match(content, /bridge\("membership"/);
  assert.match(content, /limit: 30/);
  assert.match(content, /existingIds\.has\(track\.videoId\)/);
});

test("membership verification fails closed and removes unchecked candidates", () => {
  assert.match(bridge, /checkedVideoIds/);
  assert.match(bridge, /failedVideoIds/);
  assert.match(bridge, /playlistOptionState/);
  assert.match(content, /if \(!checkedIds\.size\) throw/);
  assert.match(content, /state\.candidates = shortlist\.filter/);
  assert.match(content, /checkedIds\.has\(track\.videoId\) && !existingIds\.has/);
});

test("playlist chooser works by hover, focus, and an explicit keyboard button", () => {
  assert.match(content, /bridge\("playlistOptions"/);
  assert.match(content, /mouseenter/);
  assert.match(content, /focusin/);
  assert.match(content, /aria-haspopup/);
  assert.match(content, /aria-expanded/);
  assert.match(content, /Choose another playlist/);
  assert.match(bridge, /MuseMintPagination\.playlistOptionsFrom/);
});

test("playlist chooser keeps remote text out of HTML parsing", () => {
  assert.match(content, /title\.textContent = option\.title/);
  assert.doesNotMatch(content, /innerHTML = option\.title/);
});

test("diversity ranking caches maximum similarity instead of rescanning selections", () => {
  assert.match(core, /maxSimilarityById/);
  assert.doesNotMatch(core, /selected\.map\(\(x\) => similarity/);
});

test("privacy note discloses the read-only playlist lookup and explicit add boundary", () => {
  assert.match(privacy, /playlist\/get_add_to_playlist/);
  assert.match(privacy, /hover(?:ing)? over or focus(?:ing)?/i);
  assert.match(privacy, /only after.*click/i);
});
