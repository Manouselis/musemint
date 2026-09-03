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

  function playlistOptionSelected(payload, playlistId) {
    const target = String(playlistId || "").replace(/^VL/, "");
    let selected = false;
    const seen = new WeakSet();
    function visit(node, depth = 0) {
      if (selected || !node || typeof node !== "object" || depth > 30 || seen.has(node)) return;
      seen.add(node);
      const option = node.playlistAddToOptionRenderer || node.addToPlaylistItemRenderer
        || node.musicResponsiveListItemRenderer || node.musicTwoRowItemRenderer;
      if (option) {
        const optionId = option.playlistId
          || option.serviceEndpoint?.playlistEditEndpoint?.playlistId
          || option.navigationEndpoint?.browseEndpoint?.browseId?.replace(/^VL/, "");
        const checked = option.selected === true || option.checked === true || option.containsSelectedVideos === true
          || option.checkboxRenderer?.checkedState === "CHECKBOX_CHECKED_STATE_CHECKED";
        if (String(optionId || "").replace(/^VL/, "") === target && checked) selected = true;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
        else visit(value, depth + 1);
      }
    }
    visit(payload);
    return selected;
  }

  return { collectAll, continuationToken, playlistOptionSelected, setVideoIdFrom };
});
