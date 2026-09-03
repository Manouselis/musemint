(() => {
  "use strict";
  if (window.__museMintBridge) return;
  window.__museMintBridge = true;

  const SOURCE = "musemint-extension";

  function config() {
    const get = (name) => window.ytcfg?.get?.(name);
    const context = structuredClone(get("INNERTUBE_CONTEXT") || {});
    const delegatedSessionId = get("DELEGATED_SESSION_ID") || "";
    if (delegatedSessionId) {
      context.user = { ...(context.user || {}), onBehalfOfUser: context.user?.onBehalfOfUser || delegatedSessionId };
    }
    return {
      apiKey: get("INNERTUBE_API_KEY"),
      context,
      clientName: get("INNERTUBE_CLIENT_NAME") || context?.client?.clientName || "WEB_REMIX",
      clientVersion: get("INNERTUBE_CLIENT_VERSION") || context?.client?.clientVersion,
      sessionIndex: String(get("SESSION_INDEX") ?? 0),
      delegatedSessionId
    };
  }

  async function sha1(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-1", bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  async function authHeader() {
    const cookies = Object.fromEntries(document.cookie.split("; ").map((entry) => {
      const index = entry.indexOf("=");
      return index < 0 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
    }));
    const secret = cookies.SAPISID || cookies.__Secure_3PAPISID || cookies["__Secure-3PAPISID"];
    if (!secret) return null;
    const timestamp = Math.floor(Date.now() / 1000);
    return `SAPISIDHASH ${timestamp}_${await sha1(`${timestamp} ${secret} ${location.origin}`)}`;
  }

  async function api(endpoint, body) {
    const cfg = config();
    if (!cfg.apiKey || !cfg.context?.client) throw new Error("YouTube Music is still loading. Try again in a moment.");
    const headers = {
      "Content-Type": "application/json",
      "X-Origin": location.origin,
      "X-Youtube-Client-Name": String(cfg.clientName),
      "X-Youtube-Client-Version": String(cfg.clientVersion || "")
    };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    if (cfg.sessionIndex) headers["X-Goog-AuthUser"] = cfg.sessionIndex;
    if (cfg.delegatedSessionId) headers["X-Goog-PageId"] = cfg.delegatedSessionId;
    const response = await fetch(`/youtubei/v1/${endpoint}?key=${encodeURIComponent(cfg.apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ context: cfg.context, ...body })
    });
    if (!response.ok) throw new Error(`YouTube Music returned ${response.status}. Refresh and try again.`);
    return response.json();
  }

  function collectEndpoints(payload) {
    const related = [];
    const automix = [];
    const seen = new WeakSet();
    function visit(node, relatedContext = false, depth = 0) {
      if (!node || typeof node !== "object" || depth > 35 || seen.has(node)) return;
      seen.add(node);
      const title = node.tabRenderer?.title || node.title;
      const inRelated = relatedContext || (typeof title === "string" && title.toLowerCase() === "related");
      const browse = node.browseEndpoint;
      if (browse?.browseId && (inRelated || String(browse.browseId).startsWith("MPTR"))) {
        related.push({ browseId: browse.browseId, params: browse.params });
      }
      const watchPlaylist = node.watchPlaylistEndpoint;
      if (watchPlaylist?.playlistId && String(watchPlaylist.playlistId).startsWith("RD")) {
        automix.push({ playlistId: watchPlaylist.playlistId, params: watchPlaylist.params });
      }
      const watch = node.watchEndpoint;
      if (watch?.playlistId && String(watch.playlistId).startsWith("RD")) {
        automix.push({ playlistId: watch.playlistId, params: watch.params });
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, inRelated, depth + 1));
        else visit(value, inRelated, depth + 1);
      }
    }
    visit(payload);
    const unique = (items, field) => [...new Map(items.map((item) => [item[field], item])).values()];
    return { related: unique(related, "browseId"), automix: unique(automix, "playlistId") };
  }

  async function neighbors(payload) {
    const initial = await api("next", {
      videoId: payload.videoId,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
      tunerSettingValue: "AUTOMIX_SETTING_NORMAL"
    });
    const endpoints = collectEndpoints(initial);
    const followups = [
      ...endpoints.related.slice(0, 2).map((endpoint) => api("browse", endpoint)),
      ...endpoints.automix.slice(0, 1).map((endpoint) => api("next", {
        playlistId: endpoint.playlistId,
        params: endpoint.params,
        isAudioOnly: true,
        enablePersistentPlaylistPanel: true
      }))
    ];
    const settled = await Promise.allSettled(followups);
    return { initial, expansions: settled.filter((x) => x.status === "fulfilled").map((x) => x.value) };
  }

  async function fullPlaylist(playlistId) {
    const rawId = String(playlistId || "");
    const cleanId = rawId.startsWith("VL") ? rawId.slice(2) : rawId;
    const browseId = `VL${cleanId}`;
    const initial = await api("browse", { browseId });
    const browse = await MuseMintPagination.collectAll(initial, (continuation) => api("browse", { continuation }), 100);
    if (countTrackRows(browse)) return { ...browse, source: "browse" };

    try {
      const queueInitial = await api("next", {
        playlistId: cleanId,
        isAudioOnly: true,
        enablePersistentPlaylistPanel: true
      });
      const queue = await MuseMintPagination.collectAll(queueInitial, (continuation) => api("next", { continuation }), 100);
      if (countTrackRows(queue)) return { ...queue, source: "queue" };
    } catch (_) {}

    const snapshot = pagePlaylistSnapshot();
    if (snapshot.length) {
      return { pages: [{ pagePlaylistSnapshot: snapshot }], complete: true, pageCount: 1, source: "page" };
    }
    return { ...browse, source: "browse", diagnostics: { rendererRows: 0 } };
  }

  function countTrackRows(payload) {
    let count = 0;
    const seen = new WeakSet();
    function visit(node, depth = 0) {
      if (!node || typeof node !== "object" || depth > 35 || seen.has(node)) return;
      seen.add(node);
      if (node.musicResponsiveListItemRenderer || node.playlistPanelVideoRenderer) count++;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
        else visit(value, depth + 1);
      }
    }
    visit(payload);
    return count;
  }

  function pagePlaylistSnapshot() {
    const rows = [];
    const selector = "ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer, ytmusic-player-queue ytmusic-playlist-panel-video-renderer";
    for (const element of document.querySelectorAll(selector)) {
      const data = element.data || element.__data?.data;
      if (!data || typeof data !== "object") continue;
      try {
        rows.push(element.localName === "ytmusic-playlist-panel-video-renderer"
          ? { playlistPanelVideoRenderer: structuredClone(data) }
          : { musicResponsiveListItemRenderer: structuredClone(data) });
      } catch (_) {}
    }
    return rows;
  }

  async function existingPlaylistVideos(playlistId, videoIds = []) {
    const ids = [...new Set(videoIds.filter(Boolean))].slice(0, 30);
    const existingVideoIds = [];
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const videoId = ids[cursor++];
        try {
          const response = await api("playlist/get_add_to_playlist", { videoIds: [videoId] });
          if (MuseMintPagination.playlistOptionSelected(response, playlistId)) existingVideoIds.push(videoId);
        } catch (_) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    return { existingVideoIds, checked: ids.length };
  }

  function playerCommand(type, shouldResume = false) {
    const player = document.querySelector("#movie_player");
    if (!player) return { wasPlaying: false, volume: 50, muted: false };
    if (type === "previewStart") {
      const wasPlaying = player.getPlayerState?.() === 1;
      const volume = Math.max(0, Math.min(100, Number(player.getVolume?.() ?? 50)));
      const muted = Boolean(player.isMuted?.());
      if (wasPlaying) player.pauseVideo?.();
      return { wasPlaying, volume, muted };
    }
    if (type === "previewStop" && shouldResume) player.playVideo?.();
    return { wasPlaying: false, volume: 50, muted: false };
  }

  async function handle(type, payload) {
    if (type === "neighbors") return neighbors(payload);
    if (type === "search") return api("search", { query: payload.query });
    if (type === "playlist") return fullPlaylist(payload.playlistId);
    if (type === "membership") return existingPlaylistVideos(payload.playlistId, payload.videoIds);
    if (type === "previewStart" || type === "previewStop") return playerCommand(type, payload.shouldResume);
    if (type === "add") {
      const playlistId = String(payload.playlistId || "").replace(/^VL/, "");
      const response = await api("browse/edit_playlist", {
        playlistId,
        actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId: payload.videoId }]
      });
      let setVideoId = MuseMintPagination.setVideoIdFrom(response, payload.videoId);
      if (!setVideoId) {
        const playlist = await fullPlaylist(payload.playlistId);
        setVideoId = MuseMintPagination.setVideoIdFrom(playlist, payload.videoId);
      }
      return { response, setVideoId };
    }
    if (type === "remove") {
      const playlistId = String(payload.playlistId || "").replace(/^VL/, "");
      let setVideoId = payload.setVideoId;
      if (!setVideoId && payload.videoId) {
        setVideoId = MuseMintPagination.setVideoIdFrom(await fullPlaylist(payload.playlistId), payload.videoId);
      }
      if (!setVideoId) throw new Error("YouTube Music did not expose this playlist membership. Refresh once and retry.");
      return api("browse/edit_playlist", {
        playlistId,
        actions: [{ action: "ACTION_REMOVE_VIDEO", setVideoId, removedVideoId: payload.videoId }]
      });
    }
    throw new Error("Unknown MuseMint request.");
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== SOURCE || event.data?.channel !== "request") return;
    const { id, type, payload } = event.data;
    if (!id || !type) return;
    try {
      const data = await handle(type, payload || {});
      window.postMessage({ source: SOURCE, channel: "response", id, ok: true, data }, location.origin);
    } catch (error) {
      window.postMessage({ source: SOURCE, channel: "response", id, ok: false, error: error?.message || String(error) }, location.origin);
    }
  });
})();
