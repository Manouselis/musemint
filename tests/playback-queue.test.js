const assert = require('node:assert/strict');
const test = require('node:test');
const Queue = require('../playback-queue.js');

const item = (videoId, playlistId = 'LOFI', index = 0) => ({ playlistPanelVideoRenderer: {
  videoId, title: { runs: [{ text: videoId }] }, selected: true,
  navigationEndpoint: { watchEndpoint: { videoId, playlistId, index } }
} });

function harness(respond = async () => ({ queueDatas: [{ content: item('rouge') }] })) {
  let state = { items: [item('playing')], selectedItemIndex: 0, nextQueueItemId: 1, queueContextParams: 'session' };
  const actions = [], requests = [], frames = [];
  let scrolls = 0;
  const queue = {
    getItems: () => state.items,
    store: { getState: () => ({ queue: state }), dispatch(action) {
      actions.push(action);
      const { type, payload } = action;
      if (type === 'ADD_ITEMS') {
        payload.items.forEach((entry, i) => { entry.playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint.index = payload.nextQueueItemId + i; });
        state = { ...state, items: [...state.items.slice(0, payload.index), ...payload.items, ...state.items.slice(payload.index)], nextQueueItemId: state.nextQueueItemId + payload.items.length };
      } else if (type === 'REMOVE_ITEM') state = { ...state, items: state.items.filter((_, i) => i !== payload) };
      else if (type === 'SET_INDEX') state = { ...state, selectedItemIndex: payload };
      else assert.fail(`Unexpected player action: ${type}`);
    } }
  };
  const document = {
    querySelector: () => ({ queue }),
    querySelectorAll: () => state.items.map(entry => ({ data: entry.playlistPanelVideoRenderer, closest: () => null, scrollIntoView: () => { scrolls++; } }))
  };
  const sync = Queue.create({ document, api: async (...args) => { requests.push(args); return respond(...args); }, afterRender: fn => frames.push(fn) });
  return { sync, queue, actions, requests, state: () => state, replace: update => { state = { ...state, ...update }; },
    frame: () => frames.splice(0).forEach(fn => fn()), scrolls: () => scrolls };
}

test('Rouge enters the actual playback queue without changing the playing song', async () => {
  const h = harness();
  await h.sync.add('VLLOFI', 'rouge');
  assert.deepEqual(h.state().items.map(x => x.playlistPanelVideoRenderer.videoId), ['playing', 'rouge']);
  assert.equal(h.state().selectedItemIndex, 0);
  assert.equal(h.state().items[1].playlistPanelVideoRenderer.selected, false);
  assert.equal(h.state().items[1].playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint.playlistId, 'LOFI');
  assert.deepEqual(h.requests, [['music/get_queue', { videoIds: ['rouge'] }]]);
  assert.deepEqual(h.actions.map(x => x.type), ['ADD_ITEMS']);
  h.frame();
  assert.equal(h.scrolls(), 1);
});

test('an unrelated playing playlist is never changed', async () => {
  const h = harness();
  await h.sync.add('OTHER', 'rouge');
  assert.equal(h.requests.length, 0);
  assert.equal(h.actions.length, 0);
});

test('concurrent and repeated synchronization cannot duplicate a queued song', async () => {
  const h = harness();
  await Promise.all([h.sync.add('LOFI', 'rouge'), h.sync.add('LOFI', 'rouge')]);
  await h.sync.add('LOFI', 'rouge');
  assert.equal(h.actions.length, 1);
});

test('changing the playback session during metadata loading discards the result', async () => {
  let resolve;
  const h = harness(() => new Promise(done => { resolve = done; }));
  const pending = h.sync.add('LOFI', 'rouge');
  h.replace({ queueContextParams: 'new-session' });
  resolve({ queueDatas: [{ content: item('rouge') }] });
  await pending;
  assert.equal(h.actions.length, 0);
});

test('undo while queue metadata is loading prevents a late insertion', async () => {
  let resolve;
  const h = harness(() => new Promise(done => { resolve = done; }));
  const pending = h.sync.add('LOFI', 'rouge');
  h.sync.remove('LOFI', 'rouge');
  resolve({ queueDatas: [{ content: item('rouge') }] });
  await pending;
  assert.equal(h.actions.length, 0);
});

test('undo removes only the entry inserted by MuseMint', async () => {
  const h = harness();
  await h.sync.add('LOFI', 'rouge');
  h.sync.remove('LOFI', 'playing');
  assert.equal(h.state().items.length, 2);
  h.sync.remove('LOFI', 'rouge');
  assert.equal(h.state().items.length, 1);
  h.frame();
  assert.equal(h.scrolls(), 0);
});

test('undo does not interrupt an added song that is already playing', async () => {
  const h = harness();
  await h.sync.add('LOFI', 'rouge');
  h.replace({ selectedItemIndex: 1 });
  h.sync.remove('LOFI', 'rouge');
  assert.equal(h.state().items.length, 2);
  assert.equal(h.state().selectedItemIndex, 1);
});

test('undo before the current item preserves the selected song', async () => {
  const h = harness();
  await h.sync.add('LOFI', 'rouge');
  h.replace({ items: [...h.state().items, item('later', 'LOFI', 2)], selectedItemIndex: 2 });
  h.sync.remove('LOFI', 'rouge');
  assert.equal(h.state().selectedItemIndex, 1);
  assert.equal(h.state().items[1].playlistPanelVideoRenderer.videoId, 'later');
});

test('missing or unrelated metadata cannot create a fake queue entry', async () => {
  for (const response of [{}, { queueDatas: [{ content: item('other') }] }]) {
    const h = harness(async () => response);
    await assert.rejects(h.sync.add('LOFI', 'rouge'), /playback queue entry/);
    assert.equal(h.actions.length, 0);
  }
});
