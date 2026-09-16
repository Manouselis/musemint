const assert = require('node:assert/strict');
const test = require('node:test');
const View = require('../playlist-view.js');
function harness({ modern = false, hidden = false, delayed = false, boxless = false } = {}) {
  let current = 'LOFI';
  let ready = !delayed;
  let native = [];
  let rows = [];
  let scheduled;
  let scrolls = 0;
  const makeElement = () => ({ dataset: {}, children: [], append(...children) { this.children.push(...children); },
    remove() { rows = rows.filter(row => row !== this); }, scrollIntoView() { scrolls++; } });
  const container = {
    getClientRects: () => hidden ? [] : [{}],
    appendChild(row) { rows.push(row); },
    querySelectorAll(selector) {
      if (selector === '.mm-playlist-added-row') return rows;
      return native.map(id => ({ getAttribute: () => `/watch?v=${id}&list=LOFI` }));
    }
  };
  const shelf = { localName: modern ? 'ytmusic-shelf-renderer' : 'ytmusic-playlist-shelf-renderer',
    closest: () => null, getClientRects: () => [{}],
    querySelector: selector => selector === '#contents' ? (modern ? null : container) : { parentElement: container } };
  const page = { closest: () => hidden ? {} : null, getClientRects: () => hidden || boxless ? [] : [{}],
    querySelectorAll: () => [shelf] };
  const document = { createElement: makeElement, querySelectorAll(selector) {
    if (selector === '.mm-playlist-added-row') return rows;
    assert.equal(selector, 'ytmusic-browse-response');
    return ready ? [page] : [];
  } };
  const view = View.create({ document, origin: 'https://music.youtube.com', currentPlaylistId: () => current,
    setTimer(callback) { scheduled = callback; return 1; }, clearTimer() { scheduled = null; } });
  const track = { videoId: 'new', title: '<Song>', artist: 'Artist' };
  return { view, track, rows: () => rows, scrolls: () => scrolls, setReady: () => { ready = true; },
    rerender: () => { rows = []; }, setNative: ids => { native = ids; }, setCurrent: id => { current = id; },
    tick: () => { const callback = scheduled; scheduled = null; callback?.(); } };
}
for (const modern of [false, true]) test(`successful add appears immediately in ${modern ? 'modern' : 'legacy'} playlist layout`, () => {
  const h = harness({ modern });
  h.view.update(h.track, true, 'VLLOFI');
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].children[1].children[0].textContent, '<Song>');
  assert.equal(h.scrolls(), 1);
  h.view.sync();
  assert.equal(h.rows().length, 1);
  assert.equal(h.scrolls(), 1);
});
test('delayed shelves and rerenders regain the confirmed row without repeated scrolling', () => {
  const h = harness({ delayed: true });
  h.view.update(h.track, true, 'LOFI');
  assert.equal(h.rows().length, 0);
  h.setReady(); h.view.schedule(); h.tick();
  assert.equal(h.rows().length, 1);
  h.rerender(); h.view.schedule(); h.tick();
  assert.equal(h.rows().length, 1);
  assert.equal(h.scrolls(), 1);
});
test('native row replaces the temporary row without duplicates', () => {
  const h = harness();
  h.view.update(h.track, true, 'LOFI');
  h.setNative(['new']); h.view.sync();
  assert.equal(h.rows().length, 0);
});
test('undo removes the confirmed row and does not reinsert it', () => {
  const h = harness();
  h.view.update(h.track, true, 'LOFI');
  h.view.update(h.track, false, 'LOFI'); h.view.sync();
  assert.equal(h.rows().length, 0);
});
test('hidden pages, other playlists and watch pages cannot receive the row', () => {
  const hidden = harness({ hidden: true });
  hidden.view.update(hidden.track, true, 'LOFI');
  assert.equal(hidden.rows().length, 0);
  const h = harness();
  h.setCurrent('OTHER'); h.view.update(h.track, true, 'LOFI');
  assert.equal(h.rows().length, 0);
  h.setCurrent(''); h.view.sync();
  assert.equal(h.rows().length, 0);
});
test('navigation clears pending updates as well as temporary rows', () => {
  const h = harness();
  h.view.update(h.track, true, 'LOFI'); h.view.schedule(); h.view.clear(); h.tick(); h.view.sync();
  assert.equal(h.rows().length, 0);
});

test('an add finishing during Remix still updates the current playlist', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const state = { playlistId: 'LOFI', generationId: 1, added: new Map(), membership: new Map(), tracks: [] };
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const updates = [];
  const button = { disabled: false, classList: { add() {}, remove() {} }, querySelector: () => ({}), closest: () => null, setAttribute() {} };
  const track = { videoId: 'new', title: 'New' };
  const context = vm.createContext({ state, button, track, bridge: () => pending, recordFeedback() {},
    setCachedPlaylistSelection() {}, syncVisiblePlaylist: (...args) => updates.push(args), setMessage() {} });
  vm.runInContext(source.slice(source.indexOf('  async function togglePlaylistTrack('), source.indexOf('  async function verifyNewCandidates(')), context);
  const add = vm.runInContext('togglePlaylistTrack(track, button)', context);
  state.generationId += 1; // A Remix starts while YouTube processes the add.
  resolve({ setVideoId: 'membership' });
  await add;
  assert.equal(state.added.get('new'), 'membership');
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], true);
  assert.equal(button.disabled, false);
});

test('a boxless page wrapper does not hide a visible playlist from reconciliation', () => {
  const h = harness({ boxless: true });
  h.view.update(h.track, true, 'LOFI');
  assert.equal(h.rows().length, 1);
});

test('playback URLs keep the displayed playlist eligible for immediate additions', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  let config;
  const location = { pathname: '/watch', origin: 'https://music.youtube.com', href: 'https://music.youtube.com/watch?v=original&list=LOFI' };
  const context = vm.createContext({ location, document: {}, playlistId: () => new URL(location.href).searchParams.get('list'),
    MuseMintPlaylistView: { create(options) { config = options; return {}; } } });
  vm.runInContext(source.slice(source.indexOf('  const playlistView'), source.indexOf('  function normalizedPlaylistId')), context);
  assert.equal(config.currentPlaylistId(), 'LOFI');
  location.href = 'https://music.youtube.com/watch?v=original';
  assert.equal(config.currentPlaylistId(), null);
});
