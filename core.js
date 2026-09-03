(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseMintCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
  const key = (value = "") => clean(value).toLocaleLowerCase().normalize("NFKD")
    .replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function titleIdentity(value = "") {
    const original = key(value);
    const withoutTechnicalSuffix = String(value).replace(
      /\s[-–—|]\s*(?:official|music|audio|video|lyrics?|visuali[sz]er|remaster(?:ed)?|radio edit|single version|album version|live\b|clean|explicit|hd|hq|4k).*$/i,
      " "
    );
    const withoutTaggedBrackets = withoutTechnicalSuffix.replace(/[([{][^\])}]{0,100}[\])}]/g, (part) =>
      /official|audio|video|lyrics?|visuali[sz]er|remaster(?:ed)?|radio edit|single version|album version|live\b|clean|explicit|mono|stereo|feat\.?|ft\.?|featuring|with\b|hd|4k/i.test(part) ? " " : part
    );
    const normalized = key(withoutTaggedBrackets)
      .replace(/\b(?:feat|ft|featuring)\b.*$/g, " ")
      .replace(/\b(?:official|music|audio|video|lyrics?|visualizer|visualiser|remaster|remastered|mono|stereo|hd|hq|4k)\b/g, " ")
      .replace(/\s+/g, " ").trim();
    return normalized || original;
  }
  function artistIdentity(value = "") {
    const original = key(value);
    const withoutFeatures = String(value).replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$/i, " ");
    const normalized = key(withoutFeatures).replace(/\b(?:official|topic|vevo)\b/g, " ").replace(/\s+/g, " ").trim();
    return normalized || original;
  }

  function artistsCompatible(a, b) {
    const left = artistIdentity(a);
    const right = artistIdentity(b);
    if (!left || !right || left === "unknown artist" || right === "unknown artist") return false;
    if (left === right) return true;
    const leftWords = new Set(left.split(" "));
    const rightWords = new Set(right.split(" "));
    const smaller = leftWords.size <= rightWords.size ? leftWords : rightWords;
    const larger = smaller === leftWords ? rightWords : leftWords;
    let shared = 0;
    for (const word of smaller) if (larger.has(word)) shared++;
    return shared >= Math.min(2, smaller.size) && shared / Math.max(1, smaller.size) >= 0.75;
  }

  function excludeShownTitles(candidates, shownTitles = []) {
    const seen = new Set([...shownTitles].map((item) => titleIdentity(typeof item === "string" ? item : item?.title)));
    return candidates.filter((track) => !seen.has(titleIdentity(track.title)));
  }
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function textFromRuns(runs = []) {
    return runs.map((run) => run?.text || "").join("").trim();
  }

  function pageType(run) {
    return run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType || "";
  }

  function findDeep(node, pick, depth = 0, seen = new WeakSet()) {
    if (!node || typeof node !== "object" || depth > 30 || seen.has(node)) return "";
    seen.add(node);
    const selected = pick(node);
    if (selected) return selected;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          const result = findDeep(child, pick, depth + 1, seen);
          if (result) return result;
        }
      } else {
        const result = findDeep(value, pick, depth + 1, seen);
        if (result) return result;
      }
    }
    return "";
  }

  function parseRendererTrack(renderer, seedId = "") {
    const data = renderer?.musicResponsiveListItemRenderer || renderer?.playlistPanelVideoRenderer;
    if (!data) return null;
    const columns = (data.flexColumns || []).map((column) =>
      column.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
    );
    const titleRuns = columns.find((runs) => runs.some((run) => run.navigationEndpoint?.watchEndpoint?.videoId))
      || data.title?.runs || columns[0] || [];
    const artistRuns = columns.find((runs) => runs.some((run) => {
      const type = pageType(run);
      return type === "MUSIC_PAGE_TYPE_ARTIST" || type === "MUSIC_PAGE_TYPE_UNKNOWN" || type === "MUSIC_PAGE_TYPE_USER_CHANNEL";
    })) || columns.find((runs) => runs !== titleRuns && runs.some((run) => run.text))
      || data.longBylineText?.runs || data.shortBylineText?.runs || [];
    const albumRuns = columns.find((runs) => runs.some((run) => ["MUSIC_PAGE_TYPE_ALBUM", "MUSIC_PAGE_TYPE_AUDIOBOOK"].includes(pageType(run)))) || [];
    const menuAction = findDeep(data.menu, (node) => {
      const action = node.playlistEditEndpoint?.actions?.[0];
      return action?.removedVideoId ? action : "";
    });
    const videoId = data.playlistItemData?.videoId
      || data.videoId
      || data.navigationEndpoint?.watchEndpoint?.videoId
      || titleRuns.find((run) => run.navigationEndpoint?.watchEndpoint?.videoId)?.navigationEndpoint.watchEndpoint.videoId
      || data.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
      || menuAction?.removedVideoId
      || findDeep(data, (node) => node.playNavigationEndpoint?.watchEndpoint?.videoId || "");
    const setVideoId = data.playlistItemData?.playlistSetVideoId
      || data.playlistSetVideoId
      || data.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.playlistSetVideoId
      || menuAction?.setVideoId
      || "";
    const title = textFromRuns(titleRuns);
    if (!videoId || !title || title === "Song deleted") return null;
    const artistRun = artistRuns.find((run) => ["MUSIC_PAGE_TYPE_ARTIST", "MUSIC_PAGE_TYPE_UNKNOWN", "MUSIC_PAGE_TYPE_USER_CHANNEL"].includes(pageType(run)))
      || artistRuns.find((run) => run.text);
    const duration = data.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text;
    const durationText = duration?.simpleText || textFromRuns(duration?.runs)
      || columns.flat().find((run) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(run.text || ""))?.text || "";
    const thumbnail = findDeep(data.thumbnail || data, (node) =>
      Array.isArray(node.thumbnails) && node.thumbnails.length ? node.thumbnails.at(-1)?.url : ""
    );
    return {
      videoId,
      title,
      artist: artistRun?.text || "Unknown artist",
      album: textFromRuns(albumRuns),
      duration: durationText,
      thumbnail,
      seedId,
      setVideoId,
      isExplicit: JSON.stringify(data.badges || []).includes("EXPLICIT")
    };
  }

  function canonicalTrack(raw) {
    const title = clean(raw.title);
    const artist = clean(raw.artist || raw.artists?.[0] || "Unknown artist");
    return {
      videoId: clean(raw.videoId),
      title,
      artist,
      album: clean(raw.album),
      duration: clean(raw.duration),
      thumbnail: clean(raw.thumbnail),
      seedId: clean(raw.seedId),
      setVideoId: clean(raw.setVideoId),
      sourceRank: Number.isFinite(raw.sourceRank) ? raw.sourceRank : 50,
      isExplicit: Boolean(raw.isExplicit),
      titleKey: key(title),
      artistKey: key(artist),
      identityTitle: titleIdentity(title),
      identityArtist: artistIdentity(artist)
    };
  }

  function dedupe(candidates, seeds = []) {
    const existingIds = new Set(seeds.map((x) => x.videoId).filter(Boolean));
    const existingPairs = new Set(seeds.map((x) => `${titleIdentity(x.title)}|${artistIdentity(x.artist)}`));
    const existingUnknownTitles = new Set(seeds.filter((x) => artistIdentity(x.artist) === "unknown artist").map((x) => titleIdentity(x.title)));
    const existingArtistPrefixedTitles = new Set(seeds.map((seed) =>
      `${artistIdentity(seed.artist)} ${titleIdentity(seed.title)}`.trim()
    ));
    const existingByTitle = new Map();
    for (const seed of seeds) {
      const title = titleIdentity(seed.title);
      if (!existingByTitle.has(title)) existingByTitle.set(title, []);
      existingByTitle.get(title).push(seed);
    }
    const byIdentity = new Map();

    for (const raw of candidates) {
      const item = canonicalTrack(raw);
      if (!item.videoId || !item.title || existingIds.has(item.videoId)) continue;
      const identity = `${item.identityTitle}|${item.identityArtist}`;
      const sameTitleSeeds = existingByTitle.get(item.identityTitle) || [];
      const distinctiveTitle = item.identityTitle.length >= 16 || item.identityTitle.split(" ").length >= 3;
      const metadataMatch = sameTitleSeeds.some((seed) => artistsCompatible(item.artist, seed.artist)
        || (item.album && seed.album && key(item.album) === key(seed.album)));
      if (existingPairs.has(identity) || existingUnknownTitles.has(item.identityTitle)
        || existingArtistPrefixedTitles.has(item.identityTitle)
        || metadataMatch || (distinctiveTitle && sameTitleSeeds.length)) continue;
      const previous = byIdentity.get(identity);
      if (!previous || item.sourceRank < previous.sourceRank) byIdentity.set(identity, item);
    }
    return [...byIdentity.values()];
  }

  function seedStats(seeds) {
    const artists = new Map();
    for (const seed of seeds) {
      const artist = key(seed.artist);
      if (artist) artists.set(artist, (artists.get(artist) || 0) + 1);
    }
    const max = Math.max(1, ...artists.values());
    return { artists, max };
  }

  function trackIdentity(track) {
    return `${titleIdentity(track.title)}|${artistIdentity(track.artist)}`;
  }

  function baseScore(track, context) {
    const { artistCounts, seedReach, familiarity, adventure, popularity, feedback, variation } = context;
    const reach = seedReach.get(trackIdentity(track))?.size || 1;
    const rankSignal = 1 - clamp((track.sourceRank - 1) / 50);
    const familiarArtist = artistCounts.has(track.artistKey) ? 1 : 0;
    const consensus = clamp((reach - 1) / 3);
    const obscurity = sigmoid((track.sourceRank - 8) / 5);
    const noveltyTarget = adventure / 100;
    const noveltyFit = 1 - Math.abs(obscurity - noveltyTarget);
    const familiarityFit = familiarArtist * (familiarity / 100) + (1 - familiarArtist) * (1 - familiarity / 100);
    const popularityEstimate = clamp(0.72 * rankSignal + 0.28 * consensus);
    const popularityFit = 1 - Math.abs(popularityEstimate - popularity / 100);
    const artistAffinity = clamp(Number(feedback?.artists?.[track.artistKey] || 0) / 3, -1, 1);
    const trackAffinity = Number(feedback?.tracks?.[track.videoId] || 0);
    const remixSignal = variation > 0 ? ((hash(`${track.videoId}|${variation}`) % 1000) / 999 - 0.5) * 0.22 : 0;
    return 0.23 * rankSignal + 0.22 * consensus + 0.18 * noveltyFit + 0.11 * familiarityFit + 0.16 * popularityFit
      + 0.08 * artistAffinity + 0.12 * trackAffinity + remixSignal;
  }

  function similarity(a, b) {
    if (a.artistKey && a.artistKey === b.artistKey) return 1;
    const aw = new Set(`${a.titleKey} ${a.artistKey}`.split(" ").filter(Boolean));
    const bw = new Set(`${b.titleKey} ${b.artistKey}`.split(" ").filter(Boolean));
    let intersection = 0;
    for (const word of aw) if (bw.has(word)) intersection++;
    return intersection / Math.max(1, new Set([...aw, ...bw]).size);
  }

  function recommend(rawCandidates, seeds, options = {}) {
    const settings = {
      adventure: clamp(Number(options.adventure ?? 68), 0, 100),
      familiarity: clamp(Number(options.familiarity ?? 28), 0, 100),
      popularity: clamp(Number(options.popularity ?? 50), 0, 100),
      diversity: clamp(Number(options.diversity ?? 82), 0, 100),
      limit: Math.max(1, Number(options.limit ?? 12)),
      variation: Math.max(0, Number(options.variation ?? 0)),
      feedback: options.feedback || { tracks: {}, artists: {} }
    };
    const pool = dedupe(rawCandidates, seeds).filter((track) => settings.feedback.tracks?.[track.videoId] !== -1);
    const stats = seedStats(seeds);
    const seedReach = new Map();
    for (const raw of rawCandidates) {
      if (!raw.videoId) continue;
      const identity = trackIdentity(raw);
      if (!seedReach.has(identity)) seedReach.set(identity, new Set());
      if (raw.seedId) seedReach.get(identity).add(raw.seedId);
    }
    const context = { artistCounts: stats.artists, seedReach, ...settings };
    const scored = pool.map((track) => ({ ...track, baseScore: baseScore(track, context) }));
    const selected = [];
    const artistUsage = new Map();
    const maxSimilarityById = new Map(scored.map((track) => [track.videoId, 0]));
    const lambda = 1 - settings.diversity / 220;

    while (selected.length < settings.limit && scored.length) {
      let bestIndex = 0;
      let bestValue = -Infinity;
      for (let i = 0; i < scored.length; i++) {
        const item = scored[i];
        const maxSimilarity = maxSimilarityById.get(item.videoId) || 0;
        const artistRepeat = artistUsage.get(item.artistKey) || 0;
        const value = lambda * item.baseScore - (1 - lambda) * maxSimilarity - artistRepeat * 0.16;
        if (value > bestValue) { bestValue = value; bestIndex = i; }
      }
      const [winner] = scored.splice(bestIndex, 1);
      for (const item of scored) {
        maxSimilarityById.set(item.videoId, Math.max(maxSimilarityById.get(item.videoId) || 0, similarity(item, winner)));
      }
      const reach = seedReach.get(trackIdentity(winner))?.size || 1;
      const familiar = stats.artists.has(winner.artistKey);
      const reason = reach > 1
        ? `Connects ${reach} corners of this playlist`
        : familiar
          ? `A deeper cut from a playlist favorite`
          : settings.adventure > 55
            ? `A fresh artist with a strong sonic fit`
            : `Close to your playlist's center of gravity`;
      selected.push({ ...winner, score: Math.round(winner.baseScore * 100), reason });
      artistUsage.set(winner.artistKey, (artistUsage.get(winner.artistKey) || 0) + 1);
    }
    return selected;
  }

  function chooseSeeds(tracks, count = 7) {
    if (tracks.length <= count) return tracks.slice();
    const picks = [];
    const seenArtists = new Set();
    for (let i = 0; i < count * 2 && picks.length < count; i++) {
      const index = Math.round(i * (tracks.length - 1) / Math.max(1, count * 2 - 1));
      const track = tracks[index];
      const artist = key(track.artist);
      if (!seenArtists.has(artist)) { picks.push(track); seenArtists.add(artist); }
    }
    for (const track of tracks) if (picks.length < count && !picks.includes(track)) picks.push(track);
    return picks.slice(0, count);
  }

  function previewWindow(duration) {
    const parts = String(duration || "").split(":").map(Number);
    const valid = parts.length >= 2 && parts.every(Number.isFinite);
    const seconds = valid ? parts.reduce((total, part) => total * 60 + part, 0) : 0;
    if (seconds < 60) return { start: 15, end: 35 };
    const start = Math.round(clamp(seconds * 0.38, 30, Math.max(30, seconds - 25)));
    return { start, end: Math.min(seconds - 2, start + 20) };
  }

  return { artistIdentity, artistsCompatible, canonicalTrack, chooseSeeds, dedupe, excludeShownTitles, hash, key, parseRendererTrack, previewWindow, recommend, similarity, titleIdentity };
});
