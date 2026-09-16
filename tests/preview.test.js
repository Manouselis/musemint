const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
function harness() {
  let play;
  let resolveStart;
  let removed = 0;
  let created = 0;
  const calls = [];
  const button = { classList: { remove() {}, add() {} }, setAttribute() {} };
  const state = { preview: { frame: { remove() { removed++; } }, timer: 12, button, resumePlayer: true } };
  const context = vm.createContext({ state, clearTimeout() {}, setTimeout() { return 1; }, location: { origin: 'https://music.youtube.com' },
    Core: { previewWindow: () => ({ start: 10, end: 30 }) },
    document: { addEventListener(type, callback, capture) { assert.equal(type, 'play'); assert.equal(capture, true); play = callback; },
      createElement() { created++; return { addEventListener() {}, remove() {} }; }, body: { appendChild() {} } },
    bridge(type) { calls.push(type); return type === 'previewStart' ? new Promise(resolve => { resolveStart = resolve; }) : Promise.resolve(); }
  });
  vm.runInContext(source.slice(source.indexOf('  let previewRequestId'), source.indexOf('  function recordFeedback')), context);
  return { context, state, calls, button, play: (native = true) => play({ target: { localName: 'video', closest: () => native ? {} : null } }),
    removed: () => removed, created: () => created, resolve: () => resolveStart({ wasPlaying: true }) };
}
test('native playback removes preview and clears button without restarting native playback', () => {
  const h = harness();
  h.play();
  assert.equal(h.removed(), 1);
  assert.equal(h.state.preview.frame, null);
  assert.equal(h.button.innerHTML, '▶');
  assert.deepEqual(h.calls, []);
});
test('unrelated media does not stop a preview', () => {
  const h = harness();
  h.play(false);
  assert.equal(h.removed(), 0);
});
test('native playback cancels a preview whose start request is still pending', async () => {
  const h = harness();
  h.context.button = h.button;
  const pending = vm.runInContext('togglePreview({videoId: "new", title: "New"}, button)', h.context);
  await Promise.resolve();
  h.play();
  h.resolve();
  await pending;
  assert.equal(h.created(), 0);
  assert.equal(h.state.preview.frame, null);
});
test('normal preview stop still resumes the original player', async () => {
  const h = harness();
  await vm.runInContext('stopPreview(true)', h.context);
  assert.deepEqual(h.calls, ['previewStop']);
});

for (const dislikedId of ['playing', 'other']) test(`downvoting ${dislikedId} preserves the active preview and end timer`, async () => {
  const Core = require('../core.js');
  const h = harness();
  const playing = { videoId: 'playing', title: 'Playing', artist: 'One' };
  const other = { videoId: 'other', title: 'Other', artist: 'Two' };
  const candidates = [playing, other];
  Object.assign(h.state, { playlistId: 'LOFI', feedbackByPlaylist: {}, candidates,
    recommendations: candidates, tracks: [], rejected: new Set() });
  h.state.preview.videoId = 'playing';
  const frame = h.state.preview.frame;
  const timer = h.state.preview.timer;
  const messages = [];
  const cards = [];
  Object.assign(h.context, { Core, saveFeedback() {}, rememberShownRecommendations() {}, updateCount() {},
    options: () => ({ feedback: Core.playlistFeedback(h.state.feedbackByPlaylist, 'LOFI') }),
    list: { replaceChildren() { cards.length = 0; }, appendChild(card) { cards.push(card); } },
    $: () => ({}), setMessage: (...args) => messages.push(args) });
  const buttonSource = source.slice(source.indexOf('    const preview = document.createElement("button");'), source.indexOf('    const dislike = document.createElement("button");'));
  h.context.document.createElement = () => ({ innerHTML: '', attributes: {}, classList: { add() {}, remove() {} },
    addEventListener() {}, setAttribute(name, value) { this.attributes[name] = value; } });
  h.context.createTrackCard = (track) => {
    h.context.track = track;
    return vm.runInContext(`(() => { ${buttonSource}; return { videoId: track.videoId, button: preview }; })()`, h.context);
  };
  vm.runInContext(source.slice(source.indexOf('  function recordFeedback('), source.indexOf('  const playlistView')), h.context);
  vm.runInContext(source.slice(source.indexOf('  function render('), source.indexOf('  async function togglePlaylistTrack(')), h.context);
  h.context.disliked = candidates.find(track => track.videoId === dislikedId);
  vm.runInContext('dislikeTrack(disliked)', h.context);
  assert.strictEqual(h.state.preview.frame, frame);
  assert.equal(h.state.preview.timer, timer);
  assert.equal(h.state.preview.resumePlayer, true);
  assert.equal(h.removed(), 0);
  assert.deepEqual(h.calls, []);
  assert.ok(cards.every(card => card.videoId !== dislikedId));
  assert.equal(Core.playlistFeedback(h.state.feedbackByPlaylist, 'LOFI').tracks[dislikedId], -1);
  assert.equal(messages[0][2], 4000);
  if (dislikedId === 'other') {
    assert.strictEqual(h.state.preview.button, cards[0].button);
    assert.equal(cards[0].button.innerHTML, '■');
    assert.equal(cards[0].button.attributes['aria-label'], 'Stop preview of Playing');
  } else {
    assert.equal(h.state.preview.button, null);
  }
  // The original timeout still uses this same stop path when the clip ends.
  await vm.runInContext('stopPreview(true)', h.context);
  assert.equal(h.removed(), 1);
  assert.deepEqual(h.calls, ['previewStop']);
});
