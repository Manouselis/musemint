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

  async function neighbors(payload) {
    // Request a radio tied explicitly to this anchor, never a personal automix
    // endpoint discovered elsewhere in the response.
    const radioId = `RDAMVM${payload.videoId}`;
    const response = await api("next", {
      videoId: payload.videoId,
      playlistId: radioId,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true
    });
    return MuseMintPagination.trackPage(response, "queue", radioId);
  }

  async function fullPlaylist(playlistId) {
    const cleanId = String(playlistId || "").replace(/^VL/, "");
    const collect = async (endpoint, body, kind) => {
      const initial = MuseMintPagination.trackPage(await api(endpoint, body), kind, cleanId);
      return MuseMintPagination.collectAll(initial, async (continuation) => {
        const page = MuseMintPagination.trackPage(await api(endpoint, { continuation }), kind, cleanId);
        if (!page.contents.length) throw new Error("Could not verify all playlist pages. Please retry.");
        return page;
      }, 100);
    };
    try {
      const browse = await collect("browse", { browseId: `VL${cleanId}` }, "playlist");
      if (browse.pages.some((page) => page.contents.length)) return { ...browse, source: "browse" };
    } catch (_) {}
    const queue = await collect("next", {
      playlistId: cleanId,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true
    }, "queue");
    if (queue.pages.some((page) => page.contents.length)) return { ...queue, source: "queue" };
    throw new Error("Could not read this playlist's tracks. Refresh YouTube Music and retry.");
  }

  async function existingPlaylistVideos(playlistId, videoIds = []) {
    const ids = [...new Set(videoIds.filter(Boolean))].slice(0, 30);
    const existingVideoIds = [];
    const checkedVideoIds = [];
    const failedVideoIds = [];
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const videoId = ids[cursor++];
        let verified = false;
        for (let attempt = 0; attempt < 2 && !verified; attempt++) {
          try {
            const response = await api("playlist/get_add_to_playlist", { videoIds: [videoId] });
            const membership = MuseMintPagination.playlistOptionState(response, playlistId);
            if (!membership.found) continue;
            checkedVideoIds.push(videoId);
            if (membership.selected) existingVideoIds.push(videoId);
            verified = true;
          } catch (_) {}
        }
        if (!verified) failedVideoIds.push(videoId);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    return { existingVideoIds, checkedVideoIds, failedVideoIds, checked: checkedVideoIds.length };
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
    if (type === "playlistOptions") {
      const response = await api("playlist/get_add_to_playlist", { videoIds: [payload.videoId] });
      return { playlists: MuseMintPagination.playlistOptionsFrom(response) };
    }
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
