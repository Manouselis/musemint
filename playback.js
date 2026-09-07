(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseMintPlayback = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const renderer = (item) => item?.playlistPanelVideoRenderer
    || item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
  const videoId = (item) => renderer(item)?.videoId || "";
  function videoIds(item) {
    return [videoId(item), ...(item?.playlistPanelVideoWrapperRenderer?.counterpart || [])
      .map((part) => part.counterpartRenderer?.playlistPanelVideoRenderer?.videoId)].filter(Boolean);
  }

  // Uses YouTube Music's own queue reducer and player. Keeping actual queue
  // renderers preserves native menus, metadata, shuffle, repeat, and media keys.
  function createController({ getQueue, getPlayer, fetchItems, emit, now = Date.now }) {
    let session = null;
    let revision = 0;
    let lastStatus = "";
    let changing = false;

    function native() {
      const element = getQueue();
      const store = element?.queue?.store?.store;
      const player = getPlayer();
      if (!store?.getState || !element?.dispatch || !player?.getPlayerState) {
        throw new Error("Open YouTube Music’s Up next queue, then try Play discoveries again.");
      }
      return { element, store, player, queue: store.getState().queue };
    }

    function publish(data) {
      const key = JSON.stringify(data);
      if (key !== lastStatus) { lastStatus = key; emit(data); }
      return data;
    }

    function release(message = "", pause = false) {
      revision++;
      if (session) {
        const queue = session.queueApi.store.store.getState().queue;
        if (pause) getPlayer()?.pauseVideo?.();
        // Respect a user who explicitly re-enabled native autoplay meanwhile.
        if (queue.autoplay === false) session.element.dispatch({ type: "SET_AUTOPLAY_ENABLED", payload: session.autoplay });
        if (session.serverQueueDescriptor) Object.defineProperty(session.queueApi, "serverQueuesEnabled", session.serverQueueDescriptor);
        else delete session.queueApi.serverQueuesEnabled;
      }
      session = null;
      return publish({ active: false, message });
    }

    function snapshot() {
      if (!session) return publish({ active: false });
      const { queue, player } = native();
      const items = queue.items || [];
      const index = items.findIndex((item) => renderer(item)?.selected);
      const current = items[index];
      const track = session.tracks.get(videoId(current));
      if (!track) return release("Playback switched to your YouTube Music queue.");
      const actualId = player.getVideoData?.()?.video_id || "";
      const playerState = player.getPlayerState();
      const loading = !videoIds(current).includes(actualId) || playerState === 3 || playerState === -1;
      return publish({
        active: true, track, index, total: items.length, videoIds: items.map(videoId),
        playing: !loading && playerState === 1,
        loading, ended: !loading && playerState === 0,
        currentTime: loading ? 0 : Math.floor(player.getCurrentTime?.() || 0),
        duration: Math.floor(player.getDuration?.() || track.duration || 0),
        next: session.tracks.get(videoId(items[index + 1])) || null,
        canPrevious: index > 0 || queue.repeatMode === "ALL" || (player.getCurrentTime?.() || 0) > 3,
        canNext: index < items.length - 1 || queue.repeatMode === "ALL",
        message: session.message || ""
      });
    }

    async function start(tracks, startId) {
      const token = ++revision;
      const clean = [...new Map((Array.isArray(tracks) ? tracks : [])
        .filter((track) => /^[\w-]{11}$/.test(track?.videoId))
        .slice(0, 30).map((track) => [track.videoId, track])).values()];
      if (!clean.length) throw new Error("There are no discoveries to play yet.");
      const before = native();
      const originalItems = before.queue.items;
      const originalIndex = before.queue.selectedItemIndex;
      const response = await fetchItems(clean.map((track) => track.videoId));
      if (token !== revision) return { cancelled: true };
      const context = native();
      // A slow request must not replace something the listener selected meanwhile.
      if (context.queue.items !== originalItems || context.queue.selectedItemIndex !== originalIndex) {
        throw new Error("Your queue changed while loading. Click Play discoveries to try again.");
      }
      const returned = new Map((response.queueDatas || []).map((entry) => [videoId(entry.content), entry.content]));
      const items = clean.map((track) => returned.get(track.videoId))
        .filter((item) => item && renderer(item)?.unplayable !== true);
      if (!items.length) throw new Error("YouTube Music could not load these songs. Try Remix picks.");
      if (startId && !items.some((item) => videoId(item) === startId)) {
        throw new Error("This song is unavailable. Choose another discovery.");
      }
      const autoplay = session?.autoplay ?? context.queue.autoplay;
      const serverQueueDescriptor = session ? session.serverQueueDescriptor
        : Object.getOwnPropertyDescriptor(context.element.queue, "serverQueuesEnabled");
      const previousSession = session;
      const previousQueue = structuredClone(context.queue);
      const previousContinuation = context.element.queue.continuation;
      const previousServerDescriptor = Object.getOwnPropertyDescriptor(context.element.queue, "serverQueuesEnabled");
      changing = true;
      try {
        // Cancel old radio continuations before installing a finite discovery queue.
        context.element.queue.pendingFetchItemsRequest?.cancel?.("MuseMint discovery queue");
        context.element.queue.pendingFetchAutomixItemsRequest?.cancel?.("MuseMint discovery queue");
        context.element.queue.pendingFetchItemsRequest = null;
        context.element.queue.pendingFetchAutomixItemsRequest = null;
        context.element.queue.continuation = undefined;
        context.element.queue.autoPlaying = false;
        // Native shuffle must operate on this local queue, not the previous
        // server-backed playlist. Restore the original getter on release.
        Object.defineProperty(context.element.queue, "serverQueuesEnabled", { configurable: true, value: false });
        context.element.dispatch({ type: "SET_AUTOPLAY_ENABLED", payload: false });
        context.element.dispatch({ type: "SET_IS_INFINITE", payload: false });
        context.element.dispatch({ type: "SET_IS_GENERATING", payload: false });
        context.element.dispatch({ type: "SET_IS_RAAR_ENABLED", payload: false });
        context.element.dispatch({ type: "CLEAR" });
        context.element.dispatch({ type: "SET_QUEUE_CONTEXT_PARAMS", payload: "" });
        context.element.dispatch({ type: "SET_HEADER", payload: { title: { runs: [{ text: "MuseMint discoveries" }] }, subtitle: { runs: [{ text: "Picked from your playlist’s taste graph" }] }, buttons: [] } });
        context.element.dispatch({ type: "ADD_ITEMS", payload: {
          items, index: 0, nextQueueItemId: context.store.getState().queue.nextQueueItemId,
          shouldAssignIds: true
        } });
        context.element.dispatch({ type: "SET_SHUFFLE_ENABLED", payload: false });
        session = { tracks: new Map(clean.map((track) => [track.videoId, track])), autoplay,
          element: context.element, queueApi: context.element.queue, serverQueueDescriptor,
          likes: { ...context.store.getState().likeStatus?.videos },
          stalledSince: null, message: items.length < clean.length ? "Unavailable songs were left out of this queue." : "" };
        context.element.dispatch({ type: "SET_INDEX", payload: Math.max(0, items.findIndex((item) => videoId(item) === startId)) });
        const installed = context.store.getState().queue;
        if (installed.autoplay !== false || installed.items.length !== items.length
          || !installed.items.some((item) => renderer(item)?.selected)) {
          throw new Error("YouTube Music’s queue interface changed. Your previous queue has been restored.");
        }
        context.player.playVideo?.();
      } catch (error) {
        session = previousSession;
        context.element.queue.continuation = previousContinuation;
        if (previousServerDescriptor) Object.defineProperty(context.element.queue, "serverQueuesEnabled", previousServerDescriptor);
        else delete context.element.queue.serverQueuesEnabled;
        context.element.dispatch({ type: "CLEAR" });
        context.element.dispatch({ type: "ADD_ITEMS", payload: {
          items: previousQueue.items, index: 0, nextQueueItemId: 0, shouldAssignIds: true
        } });
        for (const [type, field] of [["SET_AUTOPLAY_ENABLED", "autoplay"], ["SET_IS_INFINITE", "isInfinite"],
          ["SET_IS_RAAR_ENABLED", "isRaarEnabled"], ["SET_QUEUE_CONTEXT_PARAMS", "queueContextParams"],
          ["SET_HEADER", "header"], ["SET_SHUFFLE_ENABLED", "shuffleEnabled"]]) {
          context.element.dispatch({ type, payload: previousQueue[field] });
        }
        throw error;
      } finally { changing = false; }
      return snapshot();
    }

    function remove(id) {
      if (!session) return snapshot();
      const { element, queue, player } = native();
      const items = queue.items || [];
      const index = items.findIndex((item) => videoIds(item).includes(id));
      if (index < 0) return snapshot();
      const selected = items.findIndex((item) => renderer(item)?.selected);
      const currentId = videoId(items[selected]);
      const nextId = videoId(items[index + 1]);
      changing = true;
      try {
        element.dispatch({ type: "REMOVE_ITEM", payload: index });
        if (items.length === 1 || (index === selected && !nextId)) {
          player.pauseVideo?.();
          return release("Discovery queue finished. Remix picks for a fresh queue.");
        }
        const remaining = native().queue.items;
        const target = index === selected ? nextId : currentId;
        element.dispatch({ type: "SET_INDEX", payload: Math.max(0, remaining.findIndex((item) => videoId(item) === target)) });
        if (index === selected) player.playVideo?.();
      } finally { changing = false; }
      return snapshot();
    }

    function command(action, id) {
      if (action === "stop") return release("Discovery playback stopped.", true);
      if (!session) throw new Error("Start a discovery queue first.");
      if (action === "remove") return remove(id);
      const { element, queue, player } = native();
      const index = queue.items.findIndex((item) => renderer(item)?.selected);
      if (action === "toggle") {
        if (player.getPlayerState() === 1) player.pauseVideo?.();
        else { if (player.getPlayerState() === 0) player.seekTo?.(0, true); player.playVideo?.(); }
      } else if (action === "select") {
        const target = queue.items.findIndex((item) => videoIds(item).includes(id));
        if (target < 0) throw new Error("This song is no longer in the discovery queue.");
        element.queue.autoPlaying = false;
        element.dispatch({ type: "SET_INDEX", payload: target });
        player.playVideo?.();
      } else if (action === "previous" && (player.getCurrentTime?.() || 0) > 3) {
        player.seekTo?.(0, true);
      } else if (action === "next" || action === "previous") {
        const step = action === "next" ? 1 : -1;
        let target = index + step;
        if (queue.repeatMode === "ALL") target = (target + queue.items.length) % queue.items.length;
        if (target >= 0 && target < queue.items.length) {
          element.queue.autoPlaying = false;
          element.dispatch({ type: "SET_INDEX", payload: target });
          player.playVideo?.();
        }
      } else throw new Error("Unknown playback command.");
      return snapshot();
    }

    function tick() {
      if (!session || changing) return;
      try {
        const { store, queue, player } = native();
        const status = snapshot();
        if (!session) return;
        const likes = store.getState().likeStatus?.videos || {};
        for (const item of queue.items || []) {
          if (!session.tracks.has(videoId(item))) continue;
          const id = videoIds(item).find((value) => likes[value] === "DISLIKE" && session.likes[value] !== "DISLIKE");
          if (!id) continue;
          session.likes = { ...likes };
          emit({ event: "dislike", track: session.tracks.get(videoId(item)) });
          remove(id); // Native dislike may already have advanced; never skip twice.
          return;
        }
        session.likes = { ...likes };
        const playability = player.getPlayerResponse?.()?.playabilityStatus?.status;
        const stalled = !player.classList?.contains("ad-showing")
          && (status.loading || ["ERROR", "UNPLAYABLE", "LOGIN_REQUIRED"].includes(playability));
        if (!stalled || session.stalledId !== status.track.videoId) session.stalledSince = null;
        session.stalledId = status.track.videoId;
        if (stalled && session.stalledSince === null) session.stalledSince = now();
        if (stalled && now() - session.stalledSince > 15000) {
          session.message = `Could not play ${status.track.title}. Moving to another discovery.`;
          remove(status.track.videoId);
        }
      } catch (error) {
        // Do not repeatedly fight a replaced or unavailable player.
        try { release(error.message); }
        catch (_) { session = null; revision++; publish({ active: false, message: error.message }); }
      }
    }

    return { start, command, tick, snapshot, release };
  }
  return { createController, renderer, videoId, videoIds };
});
