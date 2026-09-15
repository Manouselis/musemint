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
