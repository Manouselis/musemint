(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseMintCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
  const key = (value = "") => clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
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
      sourceRank: Number.isFinite(raw.sourceRank) ? raw.sourceRank : 50,
      isExplicit: Boolean(raw.isExplicit),
      titleKey: key(title),
      artistKey: key(artist)
    };
  }

  function dedupe(candidates, seeds = []) {
    const existingIds = new Set(seeds.map((x) => x.videoId).filter(Boolean));
    const existingPairs = new Set(seeds.map((x) => `${key(x.title)}|${key(x.artist)}`));
    const byIdentity = new Map();

    for (const raw of candidates) {
      const item = canonicalTrack(raw);
      if (!item.videoId || !item.title || existingIds.has(item.videoId)) continue;
      const identity = `${item.titleKey}|${item.artistKey}`;
      if (existingPairs.has(identity)) continue;
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

  function baseScore(track, context) {
    const { artistCounts, seedReach, familiarity, adventure, feedback, variation } = context;
    const reach = seedReach.get(track.videoId)?.size || 1;
    const rankSignal = 1 - clamp((track.sourceRank - 1) / 50);
    const familiarArtist = artistCounts.has(track.artistKey) ? 1 : 0;
    const consensus = clamp((reach - 1) / 3);
    const obscurity = sigmoid((track.sourceRank - 8) / 5);
    const noveltyTarget = adventure / 100;
    const noveltyFit = 1 - Math.abs(obscurity - noveltyTarget);
    const familiarityFit = familiarArtist * (familiarity / 100) + (1 - familiarArtist) * (1 - familiarity / 100);
    const artistAffinity = clamp(Number(feedback?.artists?.[track.artistKey] || 0) / 3, -1, 1);
    const trackAffinity = Number(feedback?.tracks?.[track.videoId] || 0);
    const remixSignal = variation > 0 ? ((hash(`${track.videoId}|${variation}`) % 1000) / 999 - 0.5) * 0.22 : 0;
    return 0.30 * rankSignal + 0.25 * consensus + 0.21 * noveltyFit + 0.13 * familiarityFit
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
      if (!seedReach.has(raw.videoId)) seedReach.set(raw.videoId, new Set());
      if (raw.seedId) seedReach.get(raw.videoId).add(raw.seedId);
    }
    const context = { artistCounts: stats.artists, seedReach, ...settings };
    const scored = pool.map((track) => ({ ...track, baseScore: baseScore(track, context) }));
    const selected = [];
    const artistUsage = new Map();
    const lambda = 1 - settings.diversity / 220;

    while (selected.length < settings.limit && scored.length) {
      let bestIndex = 0;
      let bestValue = -Infinity;
      for (let i = 0; i < scored.length; i++) {
        const item = scored[i];
        const maxSimilarity = selected.length ? Math.max(...selected.map((x) => similarity(item, x))) : 0;
        const artistRepeat = artistUsage.get(item.artistKey) || 0;
        const value = lambda * item.baseScore - (1 - lambda) * maxSimilarity - artistRepeat * 0.16;
        if (value > bestValue) { bestValue = value; bestIndex = i; }
      }
      const [winner] = scored.splice(bestIndex, 1);
      const reach = seedReach.get(winner.videoId)?.size || 1;
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

  return { canonicalTrack, chooseSeeds, dedupe, hash, key, recommend, similarity };
});
