(() => {
  "use strict";
  if (window.__museMintLoaded) return;
  window.__museMintLoaded = true;

  const Core = globalThis.MuseMintCore;
  const state = {
    open: false,
    loading: false,
    playlistId: "",
    tracks: [],
    candidates: [],
    recommendations: [],
    added: new Map(),
    rejected: new Set(),
    variation: 0,
    feedback: { tracks: {}, artists: {} },
    preview: { videoId: "", frame: null, timer: 0, button: null, resumePlayer: false },
    generationId: 0,
    routeTimer: 0
  };
  const pending = new Map();

  function playlistId() {
    return new URL(location.href).searchParams.get("list") || "";
  }

  function bridge(type, payload, timeout = 20000) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("YouTube Music took too long to respond."));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ source: "musemint-extension", channel: "request", id, type, payload }, location.origin);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "musemint-extension" || event.data?.channel !== "response") return;
    const result = event.data;
    const request = pending.get(result.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(result.id);
    result.ok ? request.resolve(result.data) : request.reject(new Error(result.error));
  });

  function textFromRuns(runs = []) {
    return runs.map((run) => run.text || "").join("").trim();
  }

  function thumbnailFrom(renderer) {
    const stack = [renderer];
    while (stack.length) {
      const node = stack.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.thumbnails) && node.thumbnails.length) return node.thumbnails.at(-1)?.url || "";
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return "";
  }

  function parseRenderer(renderer, seedId = "") {
    const data = renderer.musicResponsiveListItemRenderer || renderer.playlistPanelVideoRenderer;
    if (!data) return null;
    const videoId = data.playlistItemData?.videoId || data.videoId || data.navigationEndpoint?.watchEndpoint?.videoId;
    const columns = data.flexColumns || [];
    const columnRuns = columns.map((column) => column.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
    const titleRuns = columnRuns[0] || data.title?.runs || [];
    const detailRuns = columnRuns[1] || data.longBylineText?.runs || data.shortBylineText?.runs || [];
    const artistRun = detailRuns.find((run) => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ARTIST") || detailRuns[0];
    const albumRun = (columnRuns[2] || []).find((run) => run.text);
    const duration = data.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || data.lengthText?.runs?.[0]?.text || "";
    if (!videoId || !textFromRuns(titleRuns)) return null;
    return {
      videoId,
      title: textFromRuns(titleRuns),
      artist: artistRun?.text || "Unknown artist",
      album: albumRun?.text || "",
      duration,
      thumbnail: thumbnailFrom(data),
      seedId,
      setVideoId: data.playlistItemData?.playlistSetVideoId || data.playlistSetVideoId || "",
      isExplicit: JSON.stringify(data.badges || []).includes("EXPLICIT")
    };
  }

  function extractTracks(payload, seedId = "") {
    const found = [];
    const seenObjects = new WeakSet();
    function visit(node, depth = 0) {
      if (!node || typeof node !== "object" || depth > 30 || seenObjects.has(node)) return;
      seenObjects.add(node);
      if (node.musicResponsiveListItemRenderer || node.playlistPanelVideoRenderer) {
        const track = parseRenderer(node, seedId);
        if (track) found.push(track);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
        else visit(value, depth + 1);
      }
    }
    visit(payload);
    return found.map((track, index) => ({ ...track, sourceRank: index + 1 }));
  }

  async function getPlaylistTracks(id) {
    const response = await bridge("playlist", { playlistId: id }, 90000);
    if (!response.complete) throw new Error("This playlist is too large to load completely. Please retry.");
    return Core.dedupe(extractTracks(response));
  }

  async function searchFallback(seeds) {
    const searches = await Promise.allSettled(seeds.slice(0, 5).map((seed) =>
      bridge("search", { query: `${seed.artist} ${seed.title}` }).then((data) => extractTracks(data, seed.videoId))
    ));
    return searches.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  const shell = document.createElement("div");
  shell.id = "musemint-root";
  shell.innerHTML = `
    <button class="mm-launch" aria-label="Open MuseMint"><span class="mm-mark">M</span><span>Find gems</span></button>
    <aside class="mm-panel" aria-label="MuseMint recommendations" aria-hidden="true">
      <header class="mm-header">
        <div><div class="mm-eyebrow">PLAYLIST ALCHEMY</div><h2>MuseMint</h2></div>
        <button class="mm-icon mm-close" aria-label="Close">×</button>
      </header>
      <div class="mm-body">
        <section class="mm-hero">
          <div class="mm-orbit"><span></span><i></i><b></b></div>
          <h3>Your playlist has hidden exits.</h3>
          <p>Follow several at once. The taste graph rewards connective tissue, not chart gravity.</p>
          <button class="mm-generate"><span>Mint discoveries</span><kbd>↗</kbd></button>
          <div class="mm-hint">Open a YouTube Music playlist to begin.</div>
        </section>
        <section class="mm-controls" hidden>
          <label><span>Safe <em>Adventure</em> Weird</span><input name="adventure" type="range" min="0" max="100" value="68"></label>
          <label><span>Familiar <em>Artist novelty</em> New</span><input name="familiarity" type="range" min="0" max="100" value="72"></label>
          <label><span>Deep cuts <em>Popularity</em> Big hits</span><input name="popularity" type="range" min="0" max="100" value="50"></label>
          <button class="mm-refresh" aria-label="Refresh recommendations">Remix picks</button>
        </section>
        <section class="mm-status" hidden><span class="mm-spinner"></span><strong>Mapping your taste graph…</strong><small>Sampling distant corners of this playlist</small></section>
        <section class="mm-results" hidden><div class="mm-result-head"><span class="mm-count"></span><span class="mm-engine"></span></div><div class="mm-list"></div></section>
      </div>
      <footer><button class="mm-privacy" aria-describedby="mm-privacy-tip">Private by design<span id="mm-privacy-tip" role="tooltip">No analytics or remote server. Playlist analysis and preference learning stay in this browser.</span></button><span>Runs inside YouTube Music</span></footer>
    </aside>`;
  document.documentElement.appendChild(shell);

  const $ = (selector) => shell.querySelector(selector);
  const panel = $(".mm-panel");
  const launch = $(".mm-launch");
  const hero = $(".mm-hero");
  const controls = $(".mm-controls");
  const status = $(".mm-status");
  const results = $(".mm-results");
  const list = $(".mm-list");

  function setOpen(value) {
    state.open = value;
    panel.classList.toggle("is-open", value);
    panel.setAttribute("aria-hidden", String(!value));
    launch.classList.toggle("is-hidden", value);
  }

  function setMessage(message, isError = false) {
    const hint = $(".mm-hint");
    hint.textContent = message;
    hint.classList.toggle("is-error", isError);
  }

  function options() {
    return {
      adventure: Number($('input[name="adventure"]').value),
      familiarity: 100 - Number($('input[name="familiarity"]').value),
      popularity: Number($('input[name="popularity"]').value),
      diversity: 84,
      limit: 14,
      variation: state.variation,
      feedback: state.feedback
    };
  }

  async function loadFeedback() {
    try {
      const stored = await chrome.storage.local.get("musemintFeedback");
      const feedback = stored.musemintFeedback;
      if (feedback?.tracks && feedback?.artists) state.feedback = feedback;
    } catch (_) {}
  }

  function saveFeedback() {
    chrome.storage.local.set({ musemintFeedback: state.feedback }).catch(() => {});
  }

  async function stopPreview(resumePlayer = true) {
    const shouldResume = resumePlayer && state.preview.resumePlayer;
    clearTimeout(state.preview.timer);
    state.preview.frame?.remove();
    if (state.preview.button) {
      state.preview.button.classList.remove("is-playing");
      state.preview.button.innerHTML = "▶";
      state.preview.button.setAttribute("aria-label", "Play 20-second preview");
    }
    state.preview = { videoId: "", frame: null, timer: 0, button: null, resumePlayer: false };
    if (shouldResume) bridge("previewStop", { shouldResume: true }, 5000).catch(() => {});
  }

  async function togglePreview(track, button) {
    if (state.preview.videoId === track.videoId) return stopPreview(true);
    const resumePlayer = state.preview.resumePlayer;
    await stopPreview(false);
    let playerState = { wasPlaying: false };
    try { playerState = await bridge("previewStart", {}, 5000); } catch (_) {}
    const window = Core.previewWindow(track.duration);
    const frame = document.createElement("iframe");
    frame.className = "mm-preview-frame";
    frame.title = `Preview of ${track.title}`;
    frame.allow = "autoplay";
    frame.src = `https://www.youtube.com/embed/${encodeURIComponent(track.videoId)}?autoplay=1&controls=0&start=${window.start}&end=${window.end}&playsinline=1`;
    document.body.appendChild(frame);
    button.classList.add("is-playing");
    button.innerHTML = "■";
    button.setAttribute("aria-label", `Stop preview of ${track.title}`);
    state.preview = {
      videoId: track.videoId,
      frame,
      button,
      resumePlayer: resumePlayer || playerState.wasPlaying,
      timer: setTimeout(() => stopPreview(true), 20000)
    };
  }

  function recordFeedback(track, value) {
    const current = Number(state.feedback.tracks[track.videoId] || 0);
    const next = value < 0 && current === value ? 0 : value;
    state.feedback.tracks[track.videoId] = next;
    const artistKey = Core.key(track.artist);
    const delta = next - current;
    state.feedback.artists[artistKey] = Math.max(-5, Math.min(5, Number(state.feedback.artists[artistKey] || 0) + delta));
    saveFeedback();
  }

  function dislikeTrack(track) {
    recordFeedback(track, -1);
    state.recommendations = Core.recommend(state.candidates, state.tracks, options());
    render();
  }

  function syncVisiblePlaylist(track, added) {
    const existing = document.querySelector(`.mm-playlist-added-row[data-video-id="${CSS.escape(track.videoId)}"]`);
    if (!added) { existing?.remove(); return; }
    if (existing) return;
    const firstRow = document.querySelector("ytmusic-responsive-list-item-renderer");
    const container = document.querySelector("ytmusic-playlist-shelf-renderer #contents")
      || document.querySelector("ytmusic-player-queue #contents")
      || firstRow?.closest("ytmusic-playlist-shelf-renderer")?.querySelector("#contents");
    if (!container) return;
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
    container.appendChild(row);
  }

  function createTrackCard(track, index) {
    const card = document.createElement("article");
    card.className = "mm-card";
    card.style.setProperty("--delay", `${Math.min(index * 35, 350)}ms`);
    const art = document.createElement("div");
    art.className = "mm-art";
    if (track.thumbnail) art.style.backgroundImage = `url("${track.thumbnail.replace(/"/g, "%22")}")`;
    art.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span>`;
    const copy = document.createElement("div");
    copy.className = "mm-copy";
    const title = document.createElement("strong");
    title.textContent = track.title;
    const artist = document.createElement("span");
    artist.textContent = track.artist;
    const why = document.createElement("small");
    why.textContent = track.reason;
    copy.append(title, artist, why);
    const actions = document.createElement("div");
    actions.className = "mm-actions";
    const preview = document.createElement("button");
    preview.className = "mm-preview";
    preview.innerHTML = "▶";
    preview.setAttribute("aria-label", `Play 20-second preview of ${track.title}`);
    preview.addEventListener("click", () => togglePreview(track, preview));
    const dislike = document.createElement("button");
    dislike.className = "mm-vote mm-dislike";
    dislike.textContent = "↓";
    dislike.classList.toggle("is-active", state.feedback.tracks[track.videoId] === -1);
    dislike.setAttribute("aria-label", `Dislike ${track.title}; hide it and reduce similar recommendations`);
    dislike.addEventListener("click", () => dislikeTrack(track));
    const add = document.createElement("button");
    add.className = "mm-add";
    add.setAttribute("aria-label", `Add ${track.title} to playlist`);
    add.innerHTML = `<span>+</span><em>Add</em>`;
    if (state.added.has(track.videoId)) { add.classList.add("is-added"); add.innerHTML = `<span>✓</span><em>Added</em>`; }
    add.addEventListener("click", () => togglePlaylistTrack(track, add));
    actions.append(preview, dislike, add);
    const dismiss = document.createElement("button");
    dismiss.className = "mm-dismiss";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", `Hide ${track.title}`);
    dismiss.addEventListener("click", () => {
      state.rejected.add(track.videoId);
      card.classList.add("is-leaving");
      setTimeout(() => { card.remove(); updateCount(); }, 220);
    });
    card.append(art, copy, actions, dismiss);
    return card;
  }

  function updateCount() {
    const count = list.querySelectorAll(".mm-card:not(.is-leaving)").length;
    $(".mm-count").textContent = `${count} ${count === 1 ? "discovery" : "discoveries"}`;
  }

  function render() {
    if (state.preview.frame) stopPreview();
    list.replaceChildren();
    state.recommendations.filter((x) => !state.rejected.has(x.videoId)).forEach((track, i) => list.appendChild(createTrackCard(track, i)));
    $(".mm-engine").textContent = "Taste graph";
    updateCount();
  }

  async function togglePlaylistTrack(track, button) {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("is-working");
    const removing = state.added.has(track.videoId);
    button.querySelector("em").textContent = removing ? "Removing" : "Adding";
    try {
      if (removing) {
        await bridge("remove", { playlistId: state.playlistId, videoId: track.videoId, setVideoId: state.added.get(track.videoId) }, 90000);
        state.added.delete(track.videoId);
        state.tracks = state.tracks.filter((item) => item.videoId !== track.videoId);
        recordFeedback(track, 0);
        syncVisiblePlaylist(track, false);
        button.classList.remove("is-working", "is-added", "is-error");
        button.innerHTML = `<span>+</span><em>Add</em>`;
        button.title = "Add to playlist";
        button.setAttribute("aria-label", `Add ${track.title} to playlist`);
        button.disabled = false;
        return;
      }
      const result = await bridge("add", { playlistId: state.playlistId, videoId: track.videoId }, 90000);
      state.added.set(track.videoId, result.setVideoId || "");
      if (!state.tracks.some((item) => item.videoId === track.videoId)) state.tracks.push(track);
      recordFeedback(track, 1);
      syncVisiblePlaylist(track, true);
      button.classList.remove("is-working");
      button.classList.add("is-added");
      button.innerHTML = `<span>✓</span><em>Added</em>`;
      button.title = "Click again to remove from playlist";
      button.setAttribute("aria-label", `Remove ${track.title} from playlist`);
      button.disabled = false;
    } catch (error) {
      button.disabled = false;
      button.classList.remove("is-working");
      button.classList.add("is-error");
      button.querySelector("em").textContent = "Retry";
      button.title = error.message;
    }
  }

  async function generate() {
    if (state.loading) return;
    const targetPlaylistId = playlistId();
    state.playlistId = targetPlaylistId;
    if (!targetPlaylistId) {
      setMessage("Open one of your playlists first — the URL needs a list ID.", true);
      return;
    }
    state.loading = true;
    const runId = ++state.generationId;
    await feedbackReady;
    hero.hidden = true;
    controls.hidden = true;
    results.hidden = true;
    status.hidden = false;
    try {
      $(".mm-status strong").textContent = "Reading the complete playlist…";
      const tracks = await getPlaylistTracks(targetPlaylistId);
      if (runId !== state.generationId) return;
      state.tracks = tracks;
      if (state.tracks.length < 2) throw new Error("I couldn't read enough tracks from this playlist. Please retry.");
      const seeds = Core.chooseSeeds(state.tracks, 7);
      $(".mm-status strong").textContent = `Exploring from ${seeds.length} taste anchors…`;
      const settled = await Promise.allSettled(seeds.map((seed) => bridge("neighbors", { videoId: seed.videoId }).then((data) => extractTracks(data, seed.videoId))));
      if (runId !== state.generationId) return;
      state.candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      let viable = Core.dedupe(state.candidates, state.tracks);
      if (viable.length < 8) {
        $(".mm-status strong").textContent = "Opening a second discovery route…";
        state.candidates.push(...await searchFallback(seeds));
        if (runId !== state.generationId) return;
        viable = Core.dedupe(state.candidates, state.tracks);
      }
      if (viable.length < 1) throw new Error("No new tracks escaped this playlist. Try Remix picks or a different playlist.");
      const ranked = Core.recommend(state.candidates, state.tracks, options());
      if (!ranked.length) throw new Error("The discovery pool was empty after duplicate removal. Please retry.");
      state.recommendations = ranked;
      render();
      status.hidden = true;
      controls.hidden = false;
      results.hidden = false;
    } catch (error) {
      hero.hidden = false;
      status.hidden = true;
      setMessage(error.message || "Something went sideways. Try again.", true);
    } finally {
      if (runId === state.generationId) state.loading = false;
    }
  }

  function rerank(isRemix = false) {
    if (!state.candidates.length) return generate();
    if (isRemix) state.variation += 1;
    state.recommendations = Core.recommend(state.candidates, state.tracks, options());
    render();
  }

  launch.addEventListener("click", () => setOpen(true));
  $(".mm-close").addEventListener("click", () => setOpen(false));
  $(".mm-generate").addEventListener("click", generate);
  $(".mm-refresh").addEventListener("click", () => rerank(true));
  shell.querySelectorAll('input[type="range"]').forEach((input) => input.addEventListener("change", rerank));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.open) setOpen(false); });
  chrome.runtime.onMessage.addListener((message) => { if (message.type === "MUSEMINT_TOGGLE") setOpen(!state.open); });
  const feedbackReady = loadFeedback();

  let observedPlaylistId = playlistId();
  state.playlistId = observedPlaylistId;
  function handleRouteChange() {
    const nextPlaylistId = playlistId();
    if (nextPlaylistId === observedPlaylistId) return;
    const shouldRegenerate = state.recommendations.length > 0 || state.loading;
    observedPlaylistId = nextPlaylistId;
    state.generationId += 1;
    state.loading = false;
    clearTimeout(state.routeTimer);
    stopPreview(true);
    state.playlistId = nextPlaylistId;
    state.tracks = [];
    state.candidates = [];
    state.recommendations = [];
    state.added.clear();
    document.querySelectorAll(".mm-playlist-added-row").forEach((row) => row.remove());
    state.rejected.clear();
    hero.hidden = false;
    controls.hidden = true;
    results.hidden = true;
    status.hidden = true;
    setMessage(nextPlaylistId ? "Playlist changed — mapping its taste next." : "Open a YouTube Music playlist to begin.");
    if (shouldRegenerate && nextPlaylistId) state.routeTimer = setTimeout(generate, 650);
  }
  document.addEventListener("yt-navigate-finish", handleRouteChange);
  window.addEventListener("popstate", handleRouteChange);
  new MutationObserver(handleRouteChange).observe(document.body, { childList: true, subtree: true });
  setInterval(handleRouteChange, 1000);
})();
