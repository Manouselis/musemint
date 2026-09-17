(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseMintPlaybackQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const normalize = (id) => String(id || "").replace(/^VL/, "");
  const renderer = (item) => item?.playlistPanelVideoRenderer ||
    item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;

  function create({ document, api, afterRender = (callback) => requestAnimationFrame(callback) }) {
    const inserted = new Map();
    const revisions = new Map();
    const pending = new Map();
    function snapshot(playlistId) {
      const queue = document.querySelector("ytmusic-app")?.queue;
      const state = queue?.store?.getState?.();
      const items = queue?.getItems?.();
      if (!Array.isArray(items) || !state?.queue || typeof queue.store.dispatch !== "function") return null;
      const current = renderer(items[state.queue.selectedItemIndex]);
      // The URL can describe a browsed playlist while a different queue plays.
      if (normalize(current?.navigationEndpoint?.watchEndpoint?.playlistId) !== normalize(playlistId)) return null;
      return { queue, items, state: state.queue };
    }

    async function add(playlistId, videoId) {
      const key = `${normalize(playlistId)}:${videoId}`;
      if (pending.has(key)) return pending.get(key);
      const operation = addOnce(playlistId, videoId, key);
      pending.set(key, operation);
      operation.finally(() => pending.delete(key)).catch(() => {});
      return operation;
    }

    async function addOnce(playlistId, videoId, key) {
      const revision = revisions.get(key);
      const before = snapshot(playlistId);
      if (!before) return { skipped: true };
      if (before.items.some((item) => renderer(item)?.videoId === videoId)) return { alreadyQueued: true };
      // Fetch native, playable metadata without editing the saved playlist again.
      const response = await api("music/get_queue", { videoIds: [videoId] });
      const item = response.queueDatas?.map((data) => data.content)
        .find((item) => renderer(item)?.videoId === videoId);
      const track = renderer(item);
      if (!track?.navigationEndpoint?.watchEndpoint) throw new Error("Could not load the playback queue entry.");
      const after = snapshot(playlistId);
      if (revisions.get(key) !== revision || !after || after.queue !== before.queue ||
          after.state.queueContextParams !== before.state.queueContextParams) return { skipped: true };
      if (after.items.some((item) => renderer(item)?.videoId === videoId)) return { alreadyQueued: true };
      track.selected = false;
      track.navigationEndpoint.watchEndpoint.playlistId = normalize(playlistId);
      // Use the same reducer action as YouTube's native queue insertion. Merely
      // appending a DOM row does not make a song part of playback.
      after.queue.store.dispatch({ type: "ADD_ITEMS", payload: {
        nextQueueItemId: after.state.nextQueueItemId,
        index: after.items.length, items: [item], shouldAssignIds: true
      } });
      if (!after.queue.getItems().some((entry) => renderer(entry)?.videoId === videoId)) {
        throw new Error("YouTube Music did not update the playback queue.");
      }
      inserted.set(key, {
        queue: after.queue, index: track.navigationEndpoint.watchEndpoint.index
      });
      afterRender(() => {
        if (!inserted.has(key) || !snapshot(playlistId)) return;
        for (const row of document.querySelectorAll('ytmusic-player-page[player-page-open] ytmusic-player-queue-item')) {
          if (row.data?.videoId === videoId && !row.closest('[hidden]')) {
            row.scrollIntoView({ block: "nearest", behavior: "auto" });
            break;
          }
        }
      });
      return { queued: true };
    }

    function remove(playlistId, videoId) {
      const key = `${normalize(playlistId)}:${videoId}`;
      revisions.set(key, (revisions.get(key) || 0) + 1);
      const entry = inserted.get(key);
      inserted.delete(key);
      const current = snapshot(playlistId);
      if (!entry || !current || current.queue !== entry.queue) return;
      const index = current.items.findIndex((item) => {
        const track = renderer(item);
        return track?.videoId === videoId && track.navigationEndpoint?.watchEndpoint?.index === entry.index;
      });
      // Removing a saved song should not interrupt that song if it is playing.
      if (index < 0 || index === current.state.selectedItemIndex) return;
      current.queue.store.dispatch({ type: "REMOVE_ITEM", payload: index });
      if (index < current.state.selectedItemIndex) {
        current.queue.store.dispatch({ type: "SET_INDEX", payload: current.state.selectedItemIndex - 1 });
      }
    }
    return { add, remove };
  }
  return { create };
});
