const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../core.js');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const record = source.slice(source.indexOf('  function recordFeedback('), source.indexOf('  function dislikeTrack('));

test('feedback changes rankings only for its destination playlist and undo restores affinity', () => {
  const state = { playlistId: 'A', feedbackByPlaylist: {} };
  const context = vm.createContext({ state, Core, saveFeedback() {} });
  vm.runInContext(record + '\nglobalThis.record = recordFeedback;', context);
  const song = { videoId: 'liked', title: 'Liked', artist: 'North' };
  context.record(song, 1, 'B');
  assert.equal(Core.playlistFeedback(state.feedbackByPlaylist, 'A').tracks.liked, undefined);
  const pool = [song, { videoId: 'other', title: 'Other', artist: 'South' }];
  const score = id => Core.recommend(pool, [], { feedback: Core.playlistFeedback(state.feedbackByPlaylist, id) }).find(x => x.videoId === 'liked').baseScore;
  assert.ok(score('B') > score('A'));
  context.record(song, -1, 'B');
  assert.ok(!Core.recommend(pool, [], { feedback: Core.playlistFeedback(state.feedbackByPlaylist, 'B') }).some(x => x.videoId === 'liked'));
  assert.ok(Core.recommend(pool, [], { feedback: Core.playlistFeedback(state.feedbackByPlaylist, 'A') }).some(x => x.videoId === 'liked'));
  context.record(song, 0, 'B');
  assert.equal(score('B'), score('A'));
  for (let i = 0; i < 8; i++) context.record({ ...song, videoId: `v${i}` }, 1, 'B');
  for (let i = 0; i < 8; i++) context.record({ ...song, videoId: `v${i}` }, 0, 'B');
  assert.equal(Core.playlistFeedback(state.feedbackByPlaylist, 'B').artists.north, 0);
});
