const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const Pagination = require('../pagination.js');
function harness(respond) {
  let listener;
  let sequence = 0;
  const results = new Map();
  const requests = [];
  const window = {
    ytcfg: { get: name => ({ INNERTUBE_API_KEY: 'test', INNERTUBE_CONTEXT: { client: { clientName: 'WEB_REMIX' } } })[name] },
    addEventListener: (_, callback) => { listener = callback; },
    postMessage: message => results.set(message.id, message)
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../page-bridge.js'), 'utf8'), {
    window, document: { cookie: '', querySelector: () => null }, location: { origin: 'https://music.youtube.com' }, structuredClone, MuseMintPagination: Pagination,
    MuseMintPlaybackQueue: require('../playback-queue.js'),
    fetch: async (url, options) => {
      const endpoint = url.split('/v1/')[1].split('?')[0];
      const body = JSON.parse(options.body);
      requests.push({ endpoint, body });
      const response = await respond(endpoint, body);
      return { ok: true, json: async () => response };
    }
  });
  return { requests, async add(videoId = 'fresh-remix') {
    const id = String(++sequence);
    await listener({ source: window, origin: 'https://music.youtube.com', data: {
      source: 'musemint-extension', channel: 'request', id, type: 'add', payload: { playlistId: 'VLLOFI', videoId }
    } });
    return results.get(id);
  } };
}
const membership = selected => ({ playlistAddToOptionRenderer: { playlistId: 'LOFI', selected } });

test('acknowledged add succeeds without an undo ID or a full-playlist reload', async () => {
  const h = harness(endpoint => {
    if (endpoint === 'playlist/get_add_to_playlist') return membership(false);
    if (endpoint === 'browse/edit_playlist') return { status: 'STATUS_SUCCEEDED' };
    throw new Error('Playlist reload failed');
  });
  const result = await h.add();
  assert.equal(result.ok, true);
  assert.equal(result.data.setVideoId, '');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.playlistId, 'LOFI');
  assert.equal(h.requests[1].body.actions[0].addedVideoId, 'fresh-remix');
});

test('lost edit response is reconciled and retry does not add the song twice', async () => {
  let selected = false;
  let edits = 0;
  const h = harness(endpoint => {
    if (endpoint === 'playlist/get_add_to_playlist') return membership(selected);
    edits++;
    selected = true;
    throw new Error('Response lost');
  });
  assert.equal((await h.add()).ok, true);
  assert.equal((await h.add()).ok, true);
  assert.equal(edits, 1);
});

test('rejected edits remain retryable and a later successful edit is acknowledged', async () => {
  let edits = 0;
  const h = harness(endpoint => {
    if (endpoint === 'playlist/get_add_to_playlist') return membership(false);
    return ++edits === 1 ? { status: 'STATUS_FAILED' } : { status: 'STATUS_SUCCEEDED' };
  });
  assert.equal((await h.add()).ok, false);
  assert.equal((await h.add()).ok, true);
  assert.equal(edits, 2);
});

test('concurrent Add controls share one edit request', async () => {
  const h = harness(endpoint => endpoint === 'playlist/get_add_to_playlist' ? membership(false) : { status: 'STATUS_SUCCEEDED' });
  const results = await Promise.all([h.add(), h.add()]);
  assert.ok(results.every(result => result.ok));
  assert.equal(h.requests.filter(request => request.endpoint === 'browse/edit_playlist').length, 1);
});

test('unknown destination cannot be treated as a successful edit', async () => {
  const h = harness(() => ({}));
  assert.equal((await h.add()).ok, false);
  assert.equal(h.requests.length, 1);
});

test('undo IDs are distinct from video IDs and must belong to the added song', () => {
  assert.equal(Pagination.setVideoIdFrom({ playlistEditVideoAddedResultData: { videoId: 'song' } }, 'song'), '');
  assert.equal(Pagination.setVideoIdFrom({ playlistEditVideoAddedResultData: { videoId: 'other', setVideoId: 'wrong' } }, 'song'), '');
  assert.equal(Pagination.setVideoIdFrom({ playlistPanelVideoRenderer: { videoId: 'song', playlistSetVideoId: 'membership' } }, 'song'), 'membership');
});
