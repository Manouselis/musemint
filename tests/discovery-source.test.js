const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const Pagination = require('../pagination.js');
const Core = require('../core.js');
const row = (id) => ({ musicResponsiveListItemRenderer: {
  playlistItemData: { videoId: id, playlistSetVideoId: `set-${id}` },
  flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: id }] } } }]
} });
const queueRow = (id) => ({ playlistPanelVideoRenderer: { videoId: id, title: { runs: [{ text: id }] } } });

function bridgeHarness(respond) {
  let listener;
  let result;
  const requests = [];
  const window = {
    ytcfg: { get: (name) => ({ INNERTUBE_API_KEY: 'test', INNERTUBE_CONTEXT: { client: { clientName: 'WEB_REMIX' } } })[name] },
    addEventListener: (_, callback) => { listener = callback; },
    postMessage: (message) => { result = message; }
  };
  const context = vm.createContext({ window, document: { cookie: '' }, location: { origin: 'https://music.youtube.com' },
    structuredClone, MuseMintPagination: Pagination,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return { ok: true, json: async () => respond(url, body) };
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../page-bridge.js'), 'utf8'), context);
  return { requests, async request(type, payload) {
    await listener({ source: window, origin: 'https://music.youtube.com', data: { source: 'musemint-extension', channel: 'request', id: 'test', type, payload } });
    return result;
  } };
}

test('LOFI playlist excludes rock recommendation shelves and their continuations', async () => {
  const harness = bridgeHarness((url, body) => body.continuation ? {
    continuationContents: { musicPlaylistShelfContinuation: { contents: [row('lofi-two')] } },
    recommendations: { musicShelfRenderer: { contents: [row('liked-rock-two')] } }
  } : {
    contents: { musicPlaylistShelfRenderer: { contents: [row('lofi-one')], continuations: [{ nextContinuationData: { continuation: 'lofi-next' } }] } },
    recommendations: { musicShelfRenderer: { contents: [row('liked-rock')], continuations: [{ nextContinuationData: { continuation: 'rock-next' } }] } }
  });
  const result = await harness.request('playlist', { playlistId: 'LOFI' });
  assert.equal(result.ok, true);
  assert.equal(result.data.complete, true);
  assert.deepEqual(result.data.pages.flatMap((page) => page.contents.map((item) => Core.parseRendererTrack(item).videoId)), ['lofi-one', 'lofi-two']);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.requests[1].body.continuation, 'lofi-next');
});

test('anchor requests use explicit song radio and exclude personal automix and shelves', async () => {
  const harness = bridgeHarness(() => ({
    contents: { playlistPanelRenderer: { playlistId: 'RDAMVMlofi', contents: [queueRow('lofi'), queueRow('quiet-neighbor')] } },
    personal: { musicShelfRenderer: { contents: [row('liked-rock')] }, watchPlaylistEndpoint: { playlistId: 'RDpersonal' } }
  }));
  const result = await harness.request('neighbors', { videoId: 'lofi' });
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].body.videoId, 'lofi');
  assert.equal(harness.requests[0].body.playlistId, 'RDAMVMlofi');
  assert.deepEqual(result.data.contents.map((item) => Core.parseRendererTrack(item).videoId), ['lofi', 'quiet-neighbor']);
});

test('playlist fallback rejects a different playlist queue and does not scrape the player', async () => {
  const harness = bridgeHarness(() => ({ playlistPanelRenderer: { playlistId: 'ROCK', contents: [queueRow('rock')] } }));
  const result = await harness.request('playlist', { playlistId: 'LOFI' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not read this playlist/);
});

test('playlist continuation actions retain membership rows, not recommendation rows', () => {
  const unrelated = row('rock');
  delete unrelated.musicResponsiveListItemRenderer.playlistItemData.playlistSetVideoId;
  const page = Pagination.trackPage({ appendContinuationItemsAction: { continuationItems: [row('lofi'), unrelated] } }, 'playlist', 'LOFI');
  assert.deepEqual(page.contents.map((item) => Core.parseRendererTrack(item).videoId), ['lofi']);
});

test('rock feedback does not change LOFI rankings and survives returning to ROCK', () => {
  const feedback = {};
  const rock = Core.playlistFeedback(feedback, 'ROCK');
  rock.artists.rocker = 5;
  rock.tracks.rock = 1;
  rock.tracks.quiet = -1;
  const lofi = Core.playlistFeedback(feedback, 'LOFI');
  const candidates = [{ videoId: 'rock', title: 'Rock', artist: 'Rocker', sourceRank: 8 },
    { videoId: 'quiet', title: 'Quiet', artist: 'Calm', sourceRank: 1 }];
  assert.deepEqual(Core.recommend(candidates, [], { feedback: lofi }), Core.recommend(candidates, []));
  assert.strictEqual(Core.playlistFeedback(feedback, 'VLROCK'), rock);
  assert.equal(Core.recommend(candidates, [], { feedback: rock }).length, 1);
});

test('unrecognized continuation data is not accepted as a complete partial playlist', async () => {
  const harness = bridgeHarness((url, body) => url.includes('/browse?') && !body.continuation ? {
    musicPlaylistShelfRenderer: { contents: [row('lofi')], continuations: [{ nextContinuationData: { continuation: 'next' } }] }
  } : { musicShelfRenderer: { contents: [row('personal-rock')] } });
  const result = await harness.request('playlist', { playlistId: 'LOFI' });
  assert.equal(result.ok, false);
});
