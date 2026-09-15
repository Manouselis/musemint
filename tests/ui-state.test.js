const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
function harness(existing = []) {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, disabled: false, textContent: '', focus() { this.focused = true; } });
    return nodes.get(key);
  };
  const inputs = [node('slider'), node('.mm-refresh')];
  const state = { loading: false, generationId: 0, recommendations: existing, candidates: [], candidatePool: [],
    membership: new Map(), shownTitles: new Set(), tracks: [], rejected: new Set(), variation: 0 };
  const messages = [];
  let resolve;
  let reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const controls = node('controls');
  controls.querySelectorAll = () => inputs;
  const context = vm.createContext({ state, controls, hero: node('hero'), results: node('results'), status: node('status'),
    $: node, playlistId: () => 'LOFI', feedbackReady: Promise.resolve(), setMessage: (...args) => messages.push(args),
    getPlaylistTracks: () => pending, options: () => ({}), render() {}, rememberShownRecommendations() {},
    Core: { excludeShownTitles: pool => pool, recommend: pool => pool }, verifyNewCandidates: () => pending
  });
  vm.runInContext(source.slice(source.indexOf('  function setBusy('), source.indexOf('  launch.addEventListener')), context);
  return { state, node, context, messages, resolve, reject };
}

test('canceling initial discovery restores the start screen and ignores late failure', async () => {
  const h = harness();
  const run = vm.runInContext('generate()', h.context);
  await new Promise(setImmediate);
  assert.equal(h.node('slider').disabled, true);
  vm.runInContext('cancelDiscovery()', h.context);
  assert.equal(h.state.loading, false);
  assert.equal(h.node('status').hidden, true);
  assert.equal(h.node('hero').hidden, false);
  assert.equal(h.node('.mm-generate').focused, true);
  h.reject(new Error('Late error'));
  await run;
  assert.ok(!h.messages.some(([message]) => message === 'Late error'));
  assert.equal(h.node('slider').disabled, false);
});

test('a canceled remix keeps existing picks and late failure cannot overwrite its notice', async () => {
  const picks = [{ videoId: 'old' }];
  const h = harness(picks);
  h.state.candidatePool = [{ videoId: 'new' }];
  const run = vm.runInContext('remixPicks()', h.context);
  vm.runInContext('cancelDiscovery()', h.context);
  h.reject(new Error('Late remix error'));
  await run;
  assert.strictEqual(h.state.recommendations, picks);
  assert.equal(h.node('results').hidden, false);
  assert.equal(h.node('.mm-refresh').disabled, false);
  assert.equal(h.node('.mm-refresh').focused, true);
  assert.ok(!h.messages.some(([message]) => message === 'Late remix error'));
});

test('a canceled initial request cannot replace tracks after a playlist switch', async () => {
  const h = harness();
  const run = vm.runInContext('generate()', h.context);
  await new Promise(setImmediate);
  vm.runInContext('cancelDiscovery()', h.context);
  h.state.playlistId = 'OTHER';
  h.resolve([{ videoId: 'stale-lofi' }]);
  await run;
  assert.deepEqual(h.state.tracks, []);
});

test('exhausted remix keeps old recommendations and explains failure visibly', async () => {
  const picks = [{ videoId: 'old' }];
  const h = harness(picks);
  h.state.candidatePool = [{ videoId: 'new' }];
  const run = vm.runInContext('remixPicks()', h.context);
  h.resolve([]);
  await run;
  assert.strictEqual(h.state.recommendations, picks);
  assert.equal(h.node('results').hidden, false);
  assert.ok(h.messages.some(([message]) => message.includes('No more verified-new titles')));
});

test('closing the panel removes it from keyboard navigation and returns focus', () => {
  const focused = [];
  const panel = { inert: true, contains: () => true, classList: { toggle() {} }, setAttribute() {} };
  const context = vm.createContext({ state: {}, panel, document: { activeElement: {} }, closePlaylistPickers() {},
    launch: { classList: { toggle() {} }, focus: () => focused.push('launch') }, $: () => ({ focus: () => focused.push('close') }) });
  vm.runInContext(source.slice(source.indexOf('  function setOpen('), source.indexOf('  let messageTimer')), context);
  vm.runInContext('setOpen(true)', context);
  assert.equal(panel.inert, false);
  vm.runInContext('setOpen(false)', context);
  assert.equal(panel.inert, true);
  assert.deepEqual(focused, ['close', 'launch']);
});

test('empty results offer restoring hidden picks and disappear when picks return', () => {
  const h = harness();
  let visible = [];
  h.context.list = { querySelectorAll: () => visible };
  vm.runInContext(source.slice(source.indexOf('  function updateCount('), source.indexOf('  function render(')), h.context);
  h.state.rejected.add('hidden-song');
  vm.runInContext('updateCount()', h.context);
  assert.equal(h.node('.mm-empty').hidden, false);
  assert.equal(h.node('.mm-restore').hidden, false);
  visible = [{}];
  vm.runInContext('updateCount()', h.context);
  assert.equal(h.node('.mm-empty').hidden, true);
  assert.equal(h.node('.mm-count').textContent, '1 discovery');
});
