(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseMintPagination = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function continuationToken(payload, used = new Set()) {
    function find(requirePlaylistContext) {
      let token = "";
      const seen = new WeakSet();
      function visit(node, playlistContext = false, depth = 0) {
        if (token || !node || typeof node !== "object" || depth > 35 || seen.has(node)) return;
        seen.add(node);
        const inPlaylist = playlistContext || Boolean(node.musicPlaylistShelfRenderer || node.musicPlaylistShelfContinuation);
        const candidate = node.continuationCommand?.token || node.nextContinuationData?.continuation;
        if (candidate && !used.has(candidate) && (!requirePlaylistContext || inPlaylist)) { token = candidate; return; }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach((item) => visit(item, inPlaylist, depth + 1));
          else visit(value, inPlaylist, depth + 1);
        }
      }
      visit(payload);
      return token;
    }
    return find(true) || find(false);
  }

  async function collectAll(initial, fetchPage, maxPages = 100) {
    const pages = [initial];
    const used = new Set();
    while (pages.length < maxPages) {
      const token = continuationToken(pages.at(-1), used);
      if (!token) return { pages, complete: true, pageCount: pages.length };
      used.add(token);
      pages.push(await fetchPage(token));
    }
    return { pages, complete: !continuationToken(pages.at(-1), used), pageCount: pages.length };
  }

  function setVideoIdFrom(payload, addedVideoId = "") {
    let result = "";
    const seen = new WeakSet();
    function visit(node, depth = 0) {
      if (result || !node || typeof node !== "object" || depth > 35 || seen.has(node)) return;
      seen.add(node);
      if (node.playlistEditVideoAddedResultData?.videoId) {
        result = node.playlistEditVideoAddedResultData.videoId;
        return;
      }
      const item = node.musicResponsiveListItemRenderer || node.playlistPanelVideoRenderer;
      if (item) {
        const menuAction = item.menu?.menuRenderer?.items?.map((entry) =>
          entry.menuServiceItemRenderer?.serviceEndpoint?.playlistEditEndpoint?.actions?.[0]
        ).find((action) => action?.removedVideoId === addedVideoId);
        const playEndpoint = item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
          ?.playNavigationEndpoint?.watchEndpoint;
        const itemVideoId = item.playlistItemData?.videoId || playEndpoint?.videoId || menuAction?.removedVideoId;
        if (itemVideoId === addedVideoId) {
          result = item.playlistItemData?.playlistSetVideoId || item.playlistSetVideoId
            || playEndpoint?.playlistSetVideoId || menuAction?.setVideoId || "";
        }
        if (result) return;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => visit(child, depth + 1));
        else visit(value, depth + 1);
      }
    }
    visit(payload);
    return result;
  }

  function textFrom(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText.trim();
    if (Array.isArray(value.runs)) return value.runs.map((run) => run?.text || "").join("").trim();
    return "";
  }

  function playlistOptionsFrom(payload) {
    const playlists = new Map();
    const seen = new WeakSet();
    function visit(node, depth = 0) {
      if (!node || typeof node !== "object" || depth > 30 || seen.has(node)) return;
      seen.add(node);
      const option = node.playlistAddToOptionRenderer || node.addToPlaylistItemRenderer
        || node.musicMultiSelectMenuItemRenderer || node.musicResponsiveListItemRenderer || node.musicTwoRowItemRenderer;
      if (option) {
        const playlistId = String(option.playlistId
          || option.serviceEndpoint?.playlistEditEndpoint?.playlistId
          || option.defaultServiceEndpoint?.playlistEditEndpoint?.playlistId
          || option.toggledServiceEndpoint?.playlistEditEndpoint?.playlistId
          || option.navigationEndpoint?.browseEndpoint?.browseId
          || "").replace(/^VL/, "");
        const selectedValues = [
          option.selected, option.checked, option.containsSelectedVideos, option.containsAllVideos,
          option.checkboxRenderer?.checkedState, option.checkbox?.checkedState, option.status
        ];
        const selected = selectedValues.some((value) => {
          if (value === true) return true;
          if (typeof value !== "string") return false;
          const state = value.toUpperCase();
          return !/(?:UNCHECKED|UNSELECTED|NOT_SELECTED|NONE)/.test(state) && /(?:CHECKED|SELECTED|CONTAINS)/.test(state);
        });
        const columns = option.flexColumns || [];
        const columnTexts = columns.map((column) => textFrom(column.musicResponsiveListItemFlexColumnRenderer?.text)).filter(Boolean);
        const title = textFrom(option.title) || columnTexts[0] || "Untitled playlist";
        const subtitle = textFrom(option.subtitle) || columnTexts.slice(1).join(" · ");
        if (playlistId && !playlists.has(playlistId)) {
          playlists.set(playlistId, { playlistId, title, subtitle, selected });
        } else if (playlistId && selected && !playlists.get(playlistId).selected) {
          playlists.get(playlistId).selected = true;
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
        else visit(value, depth + 1);
      }
    }
    visit(payload);
    return [...playlists.values()];
  }

  function playlistOptionSelected(payload, playlistId) {
    return playlistOptionState(payload, playlistId).selected;
  }

  function playlistOptionState(payload, playlistId) {
    const target = String(playlistId || "").replace(/^VL/, "");
    const option = playlistOptionsFrom(payload).find((item) => item.playlistId === target);
    return { found: Boolean(option), selected: Boolean(option?.selected) };
  }

  return { collectAll, continuationToken, playlistOptionSelected, playlistOptionState, playlistOptionsFrom, setVideoIdFrom };
});
