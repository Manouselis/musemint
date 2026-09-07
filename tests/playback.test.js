const assert = require("node:assert/strict");
const test = require("node:test");
const { createController, renderer, videoId } = require("../playback.js");

const tracks = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((videoId, index) => ({ videoId, title: `Song ${index + 1}`, artist: "Artist", duration: 180 }));
const row = (id, selected = false) => ({ playlistPanelVideoRenderer: { videoId: id, selected, navigationEndpoint: { watchEndpoint: { videoId: id } } } });

function harness(fetchItems) {
  const events = [];
  const actions = [];
  let time = 0;
  const data = {
    queue: { items: [row("original000", true)], selectedItemIndex: 0, nextQueueItemId: 1, autoplay: true, repeatMode: "NONE" },
    likeStatus: { videos: {} }
  };
  const player = {
    id: "original000", state: 1, time: 42, volume: 27, muted: true,
    getPlayerState() { return this.state; },
    getVideoData() { return { video_id: this.id }; },
    getCurrentTime() { return this.time; },
    getDuration() { return 180; },
    playVideo() { this.state = 1; },
    pauseVideo() { this.state = 2; },
    seekTo(value) { this.time = value; },
    getPlayerResponse() { return { playabilityStatus: { status: this.error || "OK" } }; }
  };
  // Model the public native queue reducer, including selected flags: removing a
  // preceding item preserves the current song; the index field alone does not.
  const element = {
    queue: { store: { store: { getState: () => data } }, continuation: "old-radio" },
    dispatch(action) {
      actions.push(action);
      const q = data.queue;
      if (action.type === "CLEAR") q.items = [];
      if (action.type === "ADD_ITEMS") {
        q.items = [...q.items.slice(0, action.payload.index), ...structuredClone(action.payload.items), ...q.items.slice(action.payload.index)];
        q.nextQueueItemId += action.payload.items.length;
      }
      if (action.type === "REMOVE_ITEM") q.items = q.items.filter((_, index) => index !== action.payload);
      if (action.type === "SET_INDEX") {
        q.selectedItemIndex = action.payload;
        q.items = q.items.map((item, index) => {
          const clone = structuredClone(item);
          renderer(clone).selected = index === action.payload;
          return clone;
        });
        const id = videoId(q.items[action.payload]);
        if (id !== player.id) { player.time = 0; player.id = id; }
      }
      if (action.type === "SET_AUTOPLAY_ENABLED") q.autoplay = action.payload;
      if (action.type === "SET_SHUFFLE_ENABLED") q.shuffleEnabled = action.payload;
      if (action.type === "SET_HEADER") q.header = action.payload;
    }
  };
  Object.setPrototypeOf(element.queue, { get serverQueuesEnabled() { return true; } });
  const controller = createController({ getQueue: () => element, getPlayer: () => player,
    fetchItems: fetchItems || (async (ids) => ({ queueDatas: [...ids].reverse().map((id) => ({ content: row(id) })) })),
    emit: (event) => events.push(event), now: () => time });
  return { controller, element, data, player, events, actions, advance: (value) => { time += value; },
    ids: () => data.queue.items.map(videoId), current: () => data.queue.items.find((item) => renderer(item).selected) };
}

test("start installs only requested songs in ranked order, with native autoplay off", async () => {
  const h = harness();
  let cancelled = 0;
  h.element.queue.pendingFetchItemsRequest = { cancel: () => { cancelled++; } };
  h.element.queue.pendingFetchAutomixItemsRequest = { cancel: () => { cancelled++; } };
  const status = await h.controller.start(tracks);
  assert.deepEqual(h.ids(), tracks.map((track) => track.videoId));
  assert.equal(status.track.title, "Song 1");
  assert.equal(status.next.title, "Song 2");
  assert.equal(h.data.queue.autoplay, false);
  assert.equal(h.element.queue.continuation, undefined);
  assert.equal(cancelled, 2);
  assert.equal(h.element.queue.pendingFetchItemsRequest, null);
  assert.equal(h.element.queue.pendingFetchAutomixItemsRequest, null);
  assert.equal(h.element.queue.serverQueuesEnabled, false);
  assert.equal(h.player.volume, 27);
  assert.equal(h.player.muted, true);
});

test("start can begin at a selected discovery", async () => {
  const h = harness();
  const status = await h.controller.start(tracks, tracks[1].videoId);
  assert.equal(status.index, 1);
  assert.equal(status.track.videoId, tracks[1].videoId);
});

test("native selection, pause, seek, and shuffle are reflected in status", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.element.dispatch({ type: "SET_INDEX", payload: 1 });
  h.player.time = 57;
  h.player.state = 2;
  h.data.queue.items = [h.data.queue.items[1], h.data.queue.items[2], h.data.queue.items[0]];
  h.controller.tick();
  const status = h.events.at(-1);
  assert.equal(status.index, 0);
  assert.equal(status.track.videoId, tracks[1].videoId);
  assert.equal(status.next.videoId, tracks[2].videoId);
  assert.equal(status.playing, false);
  assert.equal(status.currentTime, 57);
});

test("disliking the playing song removes it and plays the next", async () => {
  const h = harness();
  await h.controller.start(tracks);
  const status = h.controller.command("remove", tracks[0].videoId);
  assert.deepEqual(h.ids(), [tracks[1].videoId, tracks[2].videoId]);
  assert.equal(status.track.videoId, tracks[1].videoId);
  assert.equal(status.playing, true);
});

test("removing a previous or future song does not restart or resume the current one", async () => {
  const h = harness();
  await h.controller.start(tracks, tracks[1].videoId);
  h.player.time = 65;
  h.player.state = 2;
  h.controller.command("remove", tracks[0].videoId);
  const status = h.controller.command("remove", tracks[2].videoId);
  assert.equal(status.track.videoId, tracks[1].videoId);
  assert.equal(status.currentTime, 65);
  assert.equal(status.playing, false);
});

test("native dislike already advancing is not skipped twice and produces local feedback", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.data.likeStatus.videos[tracks[0].videoId] = "DISLIKE";
  h.element.dispatch({ type: "SET_INDEX", payload: 1 });
  h.controller.tick();
  assert.equal(videoId(h.current()), tracks[1].videoId);
  assert.equal(h.events.filter((event) => event.event === "dislike").length, 1);
  h.controller.tick();
  assert.equal(h.events.filter((event) => event.event === "dislike").length, 1);
});

test("native dislike without native advance skips exactly once", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.data.likeStatus.videos[tracks[0].videoId] = "DISLIKE";
  h.controller.tick();
  assert.equal(videoId(h.current()), tracks[1].videoId);
});

test("disliking the last track stops instead of replaying earlier discoveries", async () => {
  const h = harness();
  await h.controller.start(tracks, tracks[2].videoId);
  const status = h.controller.command("remove", tracks[2].videoId);
  assert.equal(status.active, false);
  assert.equal(h.player.state, 2);
  assert.equal(h.data.queue.autoplay, true);
});

test("single-track removal stops cleanly", async () => {
  const h = harness();
  await h.controller.start([tracks[0]]);
  assert.equal(h.controller.command("remove", tracks[0].videoId).active, false);
  assert.deepEqual(h.ids(), []);
});

test("transport supports restart, previous, next, pause, resume, and repeat-all", async () => {
  const h = harness();
  await h.controller.start(tracks, tracks[1].videoId);
  h.player.time = 42;
  h.controller.command("previous");
  assert.equal(h.player.time, 0);
  assert.equal(videoId(h.current()), tracks[1].videoId);
  h.controller.command("previous");
  assert.equal(videoId(h.current()), tracks[0].videoId);
  h.controller.command("next");
  h.controller.command("toggle");
  assert.equal(h.player.state, 2);
  h.controller.command("toggle");
  assert.equal(h.player.state, 1);
  h.controller.command("select", tracks[2].videoId);
  h.data.queue.repeatMode = "ALL";
  h.controller.command("next");
  assert.equal(videoId(h.current()), tracks[0].videoId);
});

test("native end of queue remains ended, with no YouTube autoplay", async () => {
  const h = harness();
  await h.controller.start(tracks, tracks[2].videoId);
  h.player.state = 0;
  const status = h.controller.snapshot();
  assert.equal(status.ended, true);
  assert.equal(status.canNext, false);
  assert.equal(h.data.queue.autoplay, false);
  h.controller.command("toggle");
  assert.equal(h.player.state, 1);
  assert.equal(h.player.time, 0);
});

test("unavailable requested track and network failures preserve the original queue", async () => {
  const h = harness(async () => ({ queueDatas: [] }));
  await assert.rejects(h.controller.start(tracks), /could not load/);
  assert.deepEqual(h.ids(), ["original000"]);
  assert.equal(h.actions.length, 0);
  const failed = harness(async () => { throw new Error("Network failure"); });
  await assert.rejects(failed.controller.start(tracks), /Network failure/);
  assert.equal(failed.actions.length, 0);
});

test("queue changes during loading and cancelled requests never overwrite new playback", async () => {
  let resolve;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  const pending = h.controller.start(tracks);
  h.data.queue.items = [row("newchoice00", true)];
  resolve({ queueDatas: tracks.map((track) => ({ content: row(track.videoId) })) });
  await assert.rejects(pending, /queue changed/);
  assert.deepEqual(h.ids(), ["newchoice00"]);
  const cancelled = h.controller.start(tracks);
  h.controller.release();
  resolve({ queueDatas: tracks.map((track) => ({ content: row(track.videoId) })) });
  assert.equal((await cancelled).cancelled, true);
  assert.deepEqual(h.ids(), ["newchoice00"]);
});

test("leaving the discovery queue releases ownership without pausing user's choice", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.data.queue.items = [row("newchoice00", true)];
  h.player.id = "newchoice00";
  h.controller.tick();
  assert.equal(h.events.at(-1).active, false);
  assert.equal(h.player.state, 1);
  assert.equal(h.data.queue.autoplay, true);
  assert.equal(h.element.queue.serverQueuesEnabled, true);
});

test("starting a fresh batch still restores the original settings when stopped", async () => {
  const h = harness();
  await h.controller.start(tracks);
  await h.controller.start(tracks.slice(1));
  h.controller.command("stop");
  assert.equal(h.data.queue.autoplay, true);
  assert.equal(h.element.queue.serverQueuesEnabled, true);
});

test("stalled playback moves on after a grace period without marking a dislike", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.player.state = 3;
  h.controller.tick();
  h.advance(16000);
  h.controller.tick();
  assert.equal(videoId(h.current()), tracks[1].videoId);
  assert.equal(h.events.some((event) => event.event === "dislike"), false);
});

test("audio/video counterpart transitions retain the discovery identity", async () => {
  const h = harness(async () => ({ queueDatas: [{ content: { playlistPanelVideoWrapperRenderer: {
    primaryRenderer: row(tracks[0].videoId), counterpart: [{ counterpartRenderer: row("counterpart") }]
  } } }] }));
  await h.controller.start([tracks[0]]);
  h.player.id = "counterpart";
  const status = h.controller.snapshot();
  assert.equal(status.loading, false);
  assert.equal(status.track.videoId, tracks[0].videoId);
  h.data.likeStatus.videos.counterpart = "DISLIKE";
  h.controller.tick();
  assert.deepEqual(h.ids(), []);
});

test("a broken native autoplay adapter rolls back the queue and settings", async () => {
  const h = harness();
  const dispatch = h.element.dispatch.bind(h.element);
  h.element.dispatch = (action) => { if (action.type !== "SET_AUTOPLAY_ENABLED") dispatch(action); };
  await assert.rejects(h.controller.start(tracks), /queue interface changed/);
  assert.deepEqual(h.ids(), ["original000"]);
  assert.equal(h.data.queue.autoplay, true);
  assert.equal(h.element.queue.serverQueuesEnabled, true);
  assert.equal(h.controller.snapshot().active, false);
});

test("pre-existing autoplay-off preference stays off on stop", async () => {
  const h = harness();
  h.data.queue.autoplay = false;
  await h.controller.start(tracks);
  h.controller.command("stop");
  assert.equal(h.data.queue.autoplay, false);
});

test("ads never trigger unavailable-song skipping", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.player.classList = { contains: () => true };
  h.player.id = "advertisement";
  h.controller.tick();
  h.advance(60000);
  h.controller.tick();
  assert.equal(videoId(h.current()), tracks[0].videoId);
});

test("buffering gets its own grace period after a song has been playing", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.controller.tick();
  h.advance(120000);
  h.player.state = 3;
  h.controller.tick();
  h.advance(5000);
  h.controller.tick();
  assert.equal(videoId(h.current()), tracks[0].videoId);
  h.player.state = 1;
  h.controller.tick();
  h.advance(16000);
  h.controller.tick();
  assert.equal(videoId(h.current()), tracks[0].videoId);
});

test("losing the player releases native settings without a polling error loop", async () => {
  const h = harness();
  await h.controller.start(tracks);
  h.player.getPlayerState = undefined;
  h.controller.tick();
  assert.equal(h.events.at(-1).active, false);
  assert.equal(h.data.queue.autoplay, true);
  assert.equal(h.element.queue.serverQueuesEnabled, true);
  const count = h.events.length;
  h.controller.tick();
  assert.equal(h.events.length, count);
});
