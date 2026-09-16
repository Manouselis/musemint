(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseMintPlaylistView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create({ document, currentPlaylistId, origin, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const additions = new Map();
    let timer = 0;
    const normalize = (id) => String(id || "").replace(/^VL/, "");
    function containerForPlaylist() {
      // Never use the player queue, a hidden SPA page, or a recommendation carousel.
      for (const page of document.querySelectorAll("ytmusic-browse-response")) {
        if (page.closest("[hidden]")) continue;
        const shelves = [...page.querySelectorAll("ytmusic-playlist-shelf-renderer, ytmusic-shelf-renderer")];
        shelves.sort((a, b) => Number(b.localName === "ytmusic-playlist-shelf-renderer") - Number(a.localName === "ytmusic-playlist-shelf-renderer"));
        for (const shelf of shelves) {
          if (shelf.closest("[hidden]")) continue;
          const firstRow = shelf.querySelector("ytmusic-responsive-list-item-renderer");
          if (!firstRow && shelf.localName !== "ytmusic-playlist-shelf-renderer") continue;
          const container = firstRow?.parentElement || shelf.querySelector("#contents");
          // Polymer wrappers can use display: contents and have no own box.
          // Check the actual list/row instead of rejecting the whole page.
          if (!container || !(container.getClientRects().length || firstRow?.getClientRects().length)) continue;
          const linkedPlaylists = new Set();
          for (const link of container.querySelectorAll("ytmusic-responsive-list-item-renderer a[href]")) {
            try {
              const id = new URL(link.getAttribute("href"), origin).searchParams.get("list");
              if (id) linkedPlaylists.add(normalize(id));
            } catch (_) {}
          }
          if (linkedPlaylists.size && !linkedPlaylists.has(normalize(currentPlaylistId()))) continue;
          return container;
        }
      }
      return null;
    }
    function nativeVideoIds(container) {
      const ids = new Set();
      for (const link of container.querySelectorAll("ytmusic-responsive-list-item-renderer a[href]")) {
        try {
          const id = new URL(link.getAttribute("href"), origin).searchParams.get("v");
          if (id) ids.add(id);
        } catch (_) {}
      }
      return ids;
    }
    function makeRow(track) {
      const row = document.createElement("div");
      row.className = "mm-playlist-added-row";
      row.dataset.videoId = track.videoId;
      const image = document.createElement("img");
      image.alt = "";
      if (track.thumbnail) image.src = track.thumbnail;
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = track.title;
      const artist = document.createElement("span");
      artist.textContent = `${track.artist} · Added by MuseMint`;
      copy.append(title, artist);
      const badge = document.createElement("span");
      badge.className = "mm-playlist-added-badge";
      badge.textContent = "Added";
      row.append(image, copy, badge);
      return row;
    }
    function sync() {
      const playlistId = normalize(currentPlaylistId());
      if (!playlistId || !additions.size) return;
      const container = containerForPlaylist();
      if (!container) return; // The observer retries after a delayed shelf render.
      const nativeIds = nativeVideoIds(container);
      const rows = [...container.querySelectorAll(".mm-playlist-added-row")];
      for (const [id, entry] of additions) {
        if (entry.playlistId !== playlistId) continue;
        const row = rows.find((item) => item.dataset.videoId === id);
        if (nativeIds.has(id)) { row?.remove(); continue; }
        if (row) continue;
        const addedRow = makeRow(entry.track);
        container.appendChild(addedRow);
        if (entry.reveal) {
          entry.reveal = false;
          addedRow.scrollIntoView?.({ block: "nearest", behavior: "auto" });
        }
      }
    }
    function update(track, added, playlistId) {
      if (!added) {
        additions.delete(track.videoId);
        document.querySelectorAll(".mm-playlist-added-row").forEach((row) => {
          if (row.dataset.videoId === track.videoId) row.remove();
        });
      } else {
        additions.set(track.videoId, { track, playlistId: normalize(playlistId), reveal: true });
        sync();
      }
    }
    function schedule() {
      if (!additions.size || timer) return;
      timer = setTimer(() => { timer = 0; sync(); }, 150);
    }
    function clear() {
      clearTimer(timer);
      timer = 0;
      additions.clear();
      document.querySelectorAll(".mm-playlist-added-row").forEach((row) => row.remove());
    }
    return { update, sync, schedule, clear };
  }
  return { create };
});
