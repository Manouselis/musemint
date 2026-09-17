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
    candidatePool: [],
    candidates: [],
    recommendations: [],
    membership: new Map(),
    shownTitles: new Set(),
    added: new Map(),
    playlistOptions: new Map(),
    playlistOptionRequests: new Map(),
    rejected: new Set(),
    variation: 0,
    feedbackByPlaylist: {},
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

  function parseRenderer(renderer, seedId = "") {
    return Core.parseRendererTrack(renderer, seedId);
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
    <aside class="mm-panel" aria-label="MuseMint recommendations" aria-hidden="true" inert>
      <header class="mm-header">
        <div><div class="mm-eyebrow">PLAYLIST ALCHEMY</div><h2>MuseMint</h2></div>
        <button class="mm-icon mm-close" aria-label="Close">×</button>
      </header>
      <div class="mm-body">
        <section class="mm-hero">
          <div class="mm-orbit"><span></span><i></i><b></b></div>
          <h3>Find your next favorite.</h3>
          <p>Discover songs connected to this playlist. Preview a pick, shape your taste, and add it in one click.</p>
          <button class="mm-generate"><span>Mint discoveries</span><kbd>↗</kbd></button>
        </section>
        <section class="mm-controls" hidden>
          <label><span>Safe <em>Adventure <output class="mm-slider-value" data-value-for="adventure"></output></em> Weird</span><input aria-label="Adventure" name="adventure" type="range" min="0" max="100" value="100"></label>
          <label><span>Familiar <em>Artist novelty <output class="mm-slider-value" data-value-for="familiarity"></output></em> New</span><input aria-label="Artist novelty" name="familiarity" type="range" min="0" max="100" value="50"></label>
          <label><span>Deep cuts <em>Popularity <output class="mm-slider-value" data-value-for="popularity"></output></em> Big hits</span><input aria-label="Popularity" name="popularity" type="range" min="0" max="100" value="100"></label>
          <button class="mm-refresh" aria-label="Refresh recommendations">Remix picks</button>
        </section>
        <section class="mm-status" hidden><span class="mm-spinner"></span><strong>Mapping your taste graph…</strong><small>Sampling distant corners of this playlist</small><button class="mm-cancel">Cancel discovery</button></section>
        <section class="mm-results" hidden><div class="mm-result-head"><span class="mm-count"></span><button class="mm-taste-info" aria-describedby="mm-taste-tip"><span class="mm-engine">Taste graph</span><span id="mm-taste-tip" role="tooltip">Finds songs connected to several parts of this playlist, balances familiar artists with discovery, and learns from your adds and dislikes for this playlist only.</span></button></div><div class="mm-list"></div><div class="mm-empty" hidden><strong>No picks left in this batch</strong><p>Try Remix picks for fresh songs, or show the picks you hid.</p><button class="mm-restore">Show hidden picks</button></div></section>
      </div>
      <div class="mm-hint" role="status" aria-live="polite" aria-atomic="true">Open a YouTube Music playlist to begin.</div>
      <footer><button class="mm-privacy" aria-describedby="mm-privacy-tip">Private by design<span id="mm-privacy-tip" role="tooltip">No analytics or developer server. The chooser reads playlist names from YouTube Music on hover or focus; nothing changes until you click.</span></button><span>Runs inside YouTube Music</span></footer>
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
    panel.inert = !value;
    if (!value) closePlaylistPickers();
    panel.classList.toggle("is-open", value);
    panel.setAttribute("aria-hidden", String(!value));
    launch.classList.toggle("is-hidden", value);
    if (value) $(".mm-close").focus();
    else if (panel.contains(document.activeElement)) launch.focus();
  }

  let messageTimer = 0;
  function setMessage(message, isError = false, duration = 0) {
    clearTimeout(messageTimer);
    const hint = $(".mm-hint");
    hint.textContent = message;
    hint.hidden = !message;
    hint.classList.toggle("is-error", isError);
    if (duration > 0) messageTimer = setTimeout(() => setMessage(""), duration);
  }

  function options() {
    return {
      adventure: Number($('input[name="adventure"]').value),
      familiarity: 100 - Number($('input[name="familiarity"]').value),
      popularity: Number($('input[name="popularity"]').value),
      diversity: 84,
      limit: 14,
      variation: state.variation,
      feedback: playlistFeedback()
    };
  }

  function recommendationTitle(track) {
    return Core.titleIdentity(track.title);
  }

  function rememberShownRecommendations() {
    for (const track of state.recommendations) state.shownTitles.add(recommendationTitle(track));
  }

  function playlistFeedback() {
    return Core.playlistFeedback(state.feedbackByPlaylist, state.playlistId);
  }

  async function loadFeedback() {
    try {
      const stored = await chrome.storage.local.get("musemintPlaylistFeedback");
      if (stored.musemintPlaylistFeedback && typeof stored.musemintPlaylistFeedback === "object") {
        state.feedbackByPlaylist = stored.musemintPlaylistFeedback;
      }
    } catch (_) {}
  }

  function saveFeedback() {
    chrome.storage.local.set({ musemintPlaylistFeedback: state.feedbackByPlaylist }).catch(() => {});
  }

  let previewRequestId = 0;
  let previewStarting = false;
  document.addEventListener("play", (event) => {
    const media = event.target;
    if (!["video", "audio"].includes(media?.localName) || !media.closest?.("#movie_player")) return;
    if (state.preview.frame || previewStarting) stopPreview(false);
  }, true);

  async function stopPreview(resumePlayer = true) {
    previewRequestId += 1;
    previewStarting = false;
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
    const requestId = ++previewRequestId;
    previewStarting = true;
    let playerState = { wasPlaying: false, volume: 50, muted: false };
    try { playerState = await bridge("previewStart", {}, 5000); } catch (_) {}
    if (requestId !== previewRequestId) return;
    previewStarting = false;
    const clip = Core.previewWindow(track.duration);
    const frame = document.createElement("iframe");
    frame.className = "mm-preview-frame";
    frame.title = `Preview of ${track.title}`;
    frame.allow = "autoplay";
    frame.src = `https://www.youtube.com/embed/${encodeURIComponent(track.videoId)}?autoplay=1&controls=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${clip.start}&end=${clip.end}&playsinline=1`;
    const setVolume = () => {
      if (!frame.contentWindow) return;
      const command = (func, args = []) => frame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
      command("setVolume", [Math.max(0, Math.min(100, Number(playerState.volume ?? 50)))]);
      command(playerState.muted ? "mute" : "unMute");
    };
    frame.addEventListener("load", () => {
      for (const delay of [0, 350, 1000]) setTimeout(() => { if (frame.isConnected) setVolume(); }, delay);
    }, { once: true });
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

  function recordFeedback(track, value, targetPlaylistId = state.playlistId) {
    const feedback = Core.playlistFeedback(state.feedbackByPlaylist, targetPlaylistId);
    const current = Number(feedback.tracks[track.videoId] || 0);
    const next = value < 0 && current === value ? 0 : value;
    feedback.tracks[track.videoId] = next;
    const artistKey = Core.key(track.artist);
    const delta = next - current;
    feedback.artists[artistKey] = Number(feedback.artists[artistKey] || 0) + delta;
    saveFeedback();
  }

  function dislikeTrack(track) {
    recordFeedback(track, -1);
    state.recommendations = Core.recommend(state.candidates, state.tracks, options());
    render({ preservePreview: true });
    rememberShownRecommendations();
    setMessage(`Disliked ${track.title}. Your future picks will adapt.`, false, 4000);
  }

  const playlistView = globalThis.MuseMintPlaylistView.create({
    document,
    currentPlaylistId: () => playlistId(),
    origin: location.origin
  });
  function syncVisiblePlaylist(track, added) {
    playlistView.update(track, added, state.playlistId);
  }

  function normalizedPlaylistId(value) {
    return String(value || "").replace(/^VL/, "");
  }

  function setCachedPlaylistSelection(videoId, playlistIdValue, selected) {
    const playlistId = normalizedPlaylistId(playlistIdValue);
    const cached = state.playlistOptions.get(videoId);
    if (!cached) return;
    const option = cached.find((item) => normalizedPlaylistId(item.playlistId) === playlistId);
    if (option) option.selected = selected;
  }

  function closePlaylistPickers(except = null) {
    shell.querySelectorAll(".mm-playlist-picker:not([hidden])").forEach((picker) => {
      if (picker === except) return;
      picker.hidden = true;
      picker.closest(".mm-add-wrap")?.querySelector(".mm-playlist-picker-toggle")?.setAttribute("aria-expanded", "false");
    });
  }

  function renderPlaylistOptions(track, picker, primaryAdd) {
    const menu = picker.querySelector(".mm-playlist-picker-list");
    menu.replaceChildren();
    const currentId = normalizedPlaylistId(state.playlistId);
    const options = [...(state.playlistOptions.get(track.videoId) || [])]
      .sort((a, b) => Number(normalizedPlaylistId(b.playlistId) === currentId) - Number(normalizedPlaylistId(a.playlistId) === currentId));
    if (!options.length) {
      const empty = document.createElement("p");
      empty.className = "mm-playlist-picker-status";
      empty.textContent = "No editable playlists were returned by YouTube Music.";
      menu.appendChild(empty);
      return;
    }
    for (const option of options) {
      const isCurrent = normalizedPlaylistId(option.playlistId) === currentId;
      const selected = option.selected || (isCurrent && state.added.has(track.videoId));
      const row = document.createElement("button");
      row.type = "button";
      row.className = "mm-playlist-option";
      row.setAttribute("role", "menuitem");
      row.disabled = selected || isCurrent;
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = option.title || "Untitled playlist";
      const detail = document.createElement("small");
      detail.textContent = selected ? (isCurrent ? "Current · Already added" : "Already added") : (isCurrent ? "Current · Use the Add button" : option.subtitle || "Add here");
      copy.append(title, detail);
      const mark = document.createElement("b");
      mark.textContent = selected ? "✓" : isCurrent ? "●" : "+";
      row.append(copy, mark);
      row.addEventListener("click", async () => {
        if (row.disabled) return;
        row.disabled = true;
        detail.textContent = "Adding…";
        mark.textContent = "↻";
        try {
          await bridge("add", { playlistId: option.playlistId, videoId: track.videoId }, 90000);
          setCachedPlaylistSelection(track.videoId, option.playlistId, true);
          recordFeedback(track, 1, option.playlistId);
          detail.textContent = "Added";
          mark.textContent = "✓";
          row.classList.add("is-selected");
          primaryAdd.title = `Also added to ${option.title || "another playlist"}`;
        } catch (error) {
          row.disabled = false;
          detail.textContent = "Could not add · Try again";
          mark.textContent = "!";
          row.title = error.message;
        }
      });
      menu.appendChild(row);
    }
  }

  async function loadPlaylistOptions(track, picker, primaryAdd) {
    if (state.playlistOptions.has(track.videoId)) {
      renderPlaylistOptions(track, picker, primaryAdd);
      return;
    }
    const menu = picker.querySelector(".mm-playlist-picker-list");
    const loading = document.createElement("p");
    loading.className = "mm-playlist-picker-status";
    loading.textContent = "Loading your playlists…";
    menu.replaceChildren(loading);
    try {
      let request = state.playlistOptionRequests.get(track.videoId);
      if (!request) {
        request = bridge("playlistOptions", { videoId: track.videoId }, 30000);
        state.playlistOptionRequests.set(track.videoId, request);
        request.finally(() => {
          if (state.playlistOptionRequests.get(track.videoId) === request) state.playlistOptionRequests.delete(track.videoId);
        }).catch(() => {});
      }
      const response = await request;
      state.playlistOptions.set(track.videoId, Array.isArray(response.playlists) ? response.playlists : []);
      if (picker.isConnected) renderPlaylistOptions(track, picker, primaryAdd);
    } catch (error) {
      if (!picker.isConnected) return;
      loading.textContent = "Could not load playlists · Hover to retry";
      loading.title = error.message;
    }
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
    if (state.preview.frame && state.preview.videoId === track.videoId) {
      preview.classList.add("is-playing");
      preview.innerHTML = "■";
      preview.setAttribute("aria-label", `Stop preview of ${track.title}`);
      state.preview.button = preview;
    }
    const dislike = document.createElement("button");
    dislike.className = "mm-vote mm-dislike";
    dislike.textContent = "↓";
    dislike.classList.toggle("is-active", playlistFeedback().tracks[track.videoId] === -1);
    dislike.setAttribute("aria-label", `Dislike ${track.title}; hide it and reduce similar recommendations`);
    dislike.addEventListener("click", () => dislikeTrack(track));
    const add = document.createElement("button");
    add.className = "mm-add";
    add.setAttribute("aria-label", `Add ${track.title} to the open playlist`);
    add.innerHTML = `<span>+</span><em>Add</em>`;
    if (state.added.has(track.videoId)) { add.classList.add("is-added"); add.innerHTML = `<span>✓</span><em>Added</em>`; }
    add.addEventListener("click", () => togglePlaylistTrack(track, add));
    const addWrap = document.createElement("div");
    addWrap.className = "mm-add-wrap";
    const pickerId = `mm-playlist-picker-${index}-${track.videoId.replace(/[^a-z0-9_-]/gi, "")}`;
    const pickerToggle = document.createElement("button");
    pickerToggle.type = "button";
    pickerToggle.className = "mm-playlist-picker-toggle";
    pickerToggle.textContent = "⌄";
    pickerToggle.setAttribute("aria-label", `Choose another playlist for ${track.title}`);
    pickerToggle.setAttribute("aria-haspopup", "menu");
    pickerToggle.setAttribute("aria-expanded", "false");
    pickerToggle.setAttribute("aria-controls", pickerId);
    const picker = document.createElement("div");
    picker.id = pickerId;
    picker.className = "mm-playlist-picker";
    picker.hidden = true;
    const pickerHeading = document.createElement("strong");
    pickerHeading.className = "mm-playlist-picker-heading";
    pickerHeading.textContent = "Add to a playlist";
    const pickerList = document.createElement("div");
    pickerList.className = "mm-playlist-picker-list";
    pickerList.setAttribute("role", "menu");
    pickerList.setAttribute("aria-label", `Playlists for ${track.title}`);
    picker.append(pickerHeading, pickerList);
    addWrap.append(add, pickerToggle, picker);
    let pickerTimer = 0;
    const openPicker = () => {
      clearTimeout(pickerTimer);
      if (!addWrap.isConnected || !state.open) return;
      closePlaylistPickers(picker);
      const anchorBounds = addWrap.getBoundingClientRect();
      const bodyBounds = addWrap.closest(".mm-body")?.getBoundingClientRect();
      picker.classList.toggle("is-below", Boolean(bodyBounds && bodyBounds.bottom - anchorBounds.bottom > anchorBounds.top - bodyBounds.top));
      picker.hidden = false;
      pickerToggle.setAttribute("aria-expanded", "true");
      loadPlaylistOptions(track, picker, add);
    };
    const scheduleOpen = () => { clearTimeout(pickerTimer); pickerTimer = setTimeout(openPicker, 750); };
    const scheduleClose = () => {
      clearTimeout(pickerTimer);
      pickerTimer = setTimeout(() => {
        if (addWrap.matches(":hover") || addWrap.contains(document.activeElement)) return;
        closePlaylistPickers();
      }, 280);
    };
    addWrap.addEventListener("mouseenter", scheduleOpen);
    addWrap.addEventListener("mouseleave", scheduleClose);
    addWrap.addEventListener("focusin", openPicker);
    addWrap.addEventListener("focusout", scheduleClose);
    pickerToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (picker.hidden) openPicker();
      else closePlaylistPickers();
    });
    actions.append(preview, dislike, addWrap);
    const dismiss = document.createElement("button");
    dismiss.className = "mm-dismiss";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", `Hide ${track.title}`);
    dismiss.addEventListener("click", () => {
      state.rejected.add(track.videoId);
      if (state.preview.videoId === track.videoId) stopPreview();
      card.classList.add("is-leaving");
      setTimeout(() => { card.remove(); updateCount(); }, 220);
    });
    card.append(art, copy, actions, dismiss);
    return card;
  }

  function updateCount() {
    const count = list.querySelectorAll(".mm-card:not(.is-leaving)").length;
    $(".mm-count").textContent = `${count} ${count === 1 ? "discovery" : "discoveries"}`;
    $(".mm-empty").hidden = count > 0;
    $(".mm-restore").hidden = !state.rejected.size;
  }

  function render({ preservePreview = false } = {}) {
    if (state.preview.frame && !preservePreview) stopPreview();
    // Cards are rebuilt below; a surviving preview card binds its new button.
    // If the playing song was disliked, its frame and end timer keep running.
    if (preservePreview) state.preview.button = null;
    list.replaceChildren();
    state.recommendations.filter((x) => !state.rejected.has(x.videoId)).forEach((track, i) => list.appendChild(createTrackCard(track, i)));
    $(".mm-engine").textContent = "Taste graph";
    updateCount();
  }

  async function togglePlaylistTrack(track, button) {
    if (button.disabled) return;
    const targetPlaylistId = state.playlistId;
    button.disabled = true;
    button.classList.add("is-working");
    const removing = state.added.has(track.videoId);
    button.querySelector("em").textContent = removing ? "Removing" : "Adding";
    try {
      if (removing) {
        await bridge("remove", { playlistId: targetPlaylistId, videoId: track.videoId, setVideoId: state.added.get(track.videoId) }, 90000);
        recordFeedback(track, 0, targetPlaylistId);
        if (state.playlistId !== targetPlaylistId) return;
        state.added.delete(track.videoId);
        state.membership.set(track.videoId, "new");
        setCachedPlaylistSelection(track.videoId, state.playlistId, false);
        state.tracks = state.tracks.filter((item) => item.videoId !== track.videoId);
        syncVisiblePlaylist(track, false);
        button.classList.remove("is-working", "is-added", "is-error");
        button.innerHTML = `<span>+</span><em>Add</em>`;
        button.title = "Add to playlist";
        button.setAttribute("aria-label", `Add ${track.title} to the open playlist`);
        const picker = button.closest(".mm-add-wrap")?.querySelector(".mm-playlist-picker");
        if (picker && !picker.hidden) renderPlaylistOptions(track, picker, button);
        button.disabled = false;
        return;
      }
      const result = await bridge("add", { playlistId: targetPlaylistId, videoId: track.videoId }, 90000);
      recordFeedback(track, 1, targetPlaylistId);
      if (state.playlistId !== targetPlaylistId) return;
      state.added.set(track.videoId, result.setVideoId || "");
      state.membership.set(track.videoId, "existing");
      setCachedPlaylistSelection(track.videoId, state.playlistId, true);
      if (!state.tracks.some((item) => item.videoId === track.videoId)) state.tracks.push(track);
      syncVisiblePlaylist(track, true);
      // Queue synchronization is separate from the acknowledged playlist edit:
      // a queue failure must not turn a successful add into a duplicate retry.
      bridge("syncPlaybackQueue", { playlistId: targetPlaylistId, videoId: track.videoId }).catch(() => {
        if (state.playlistId === targetPlaylistId && state.added.has(track.videoId)) {
          setMessage(`Added ${track.title} to the playlist, but Up next could not be updated.`, true);
        }
      });
      button.classList.remove("is-working", "is-error");
      button.classList.add("is-added");
      button.innerHTML = `<span>✓</span><em>Added</em>`;
      button.title = "Click again to remove from playlist";
      button.setAttribute("aria-label", `Remove ${track.title} from playlist`);
      const picker = button.closest(".mm-add-wrap")?.querySelector(".mm-playlist-picker");
      if (picker && !picker.hidden) renderPlaylistOptions(track, picker, button);
      button.disabled = false;
    } catch (error) {
      button.disabled = false;
      button.classList.remove("is-working");
      button.classList.add("is-error");
      button.querySelector("em").textContent = "Retry";
      button.title = error.message;
      setMessage(`Could not ${removing ? "remove" : "add"} ${track.title}: ${error.message}`, true);
    }
  }

  async function verifyNewCandidates(shortlist, targetPlaylistId, runId) {
    const unknown = shortlist.filter((track) => !state.membership.has(track.videoId));
    if (unknown.length) {
      const membership = await bridge("membership", {
        playlistId: targetPlaylistId,
        videoIds: unknown.map((track) => track.videoId)
      }, 60000);
      if (runId !== state.generationId) return null;
      const checkedIds = new Set(membership.checkedVideoIds || []);
      const existingIds = new Set(membership.existingVideoIds || []);
      for (const track of unknown) {
        if (existingIds.has(track.videoId)) state.membership.set(track.videoId, "existing");
        else if (checkedIds.has(track.videoId)) state.membership.set(track.videoId, "new");
      }
      for (const track of unknown) {
        if (state.membership.get(track.videoId) === "existing"
          && !state.tracks.some((item) => item.videoId === track.videoId)) state.tracks.push(track);
      }
    }
    return shortlist.filter((track) => state.membership.get(track.videoId) === "new");
  }

  function setBusy(busy) {
    state.loading = busy;
    controls.querySelectorAll("input, button").forEach((control) => { control.disabled = busy; });
    $(".mm-generate").disabled = busy;
    $(".mm-refresh").textContent = busy ? "Finding fresh picks…" : "Remix picks";
  }

  function cancelDiscovery() {
    if (!state.loading) return;
    state.generationId += 1;
    setBusy(false);
    status.hidden = true;
    const hasPicks = state.recommendations.length > 0;
    hero.hidden = hasPicks;
    controls.hidden = !hasPicks;
    results.hidden = !hasPicks;
    setMessage("Discovery canceled. You can try again whenever you're ready.", false, 4000);
    (hasPicks ? $(".mm-refresh") : $(".mm-generate")).focus();
  }

  async function generate() {
    if (state.loading) return;
    const targetPlaylistId = playlistId();
    state.playlistId = targetPlaylistId;
    if (!targetPlaylistId) {
      setMessage("Open one of your playlists first — the URL needs a list ID.", true);
      return;
    }
    setBusy(true);
    const runId = ++state.generationId;
    state.candidatePool = [];
    state.candidates = [];
    state.membership.clear();
    state.shownTitles.clear();
    await feedbackReady;
    if (runId !== state.generationId) return;
    setMessage("");
    hero.hidden = true;
    controls.hidden = true;
    results.hidden = true;
    status.hidden = false;
    try {
      $(".mm-status strong").textContent = "Reading the complete playlist…";
      const tracks = await getPlaylistTracks(targetPlaylistId);
      if (runId !== state.generationId) return;
      state.tracks = tracks;
      if (state.tracks.length < 1) throw new Error("I couldn't read any playable tracks from this playlist. Please retry.");
      const seeds = Core.chooseSeeds(state.tracks, 7);
      $(".mm-status strong").textContent = `Exploring from ${seeds.length} taste anchors…`;
      const settled = await Promise.allSettled(seeds.map((seed) => bridge("neighbors", { videoId: seed.videoId }).then((data) => extractTracks(data, seed.videoId))));
      if (runId !== state.generationId) return;
      state.candidatePool = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      let viable = Core.dedupe(state.candidatePool, state.tracks);
      if (viable.length < 8) {
        $(".mm-status strong").textContent = "Opening a second discovery route…";
        const fallback = await searchFallback(seeds);
        if (runId !== state.generationId) return;
        state.candidatePool.push(...fallback);
        viable = Core.dedupe(state.candidatePool, state.tracks);
      }
      if (viable.length < 1) throw new Error("No new tracks escaped this playlist. Try Remix picks or a different playlist.");
      const shortlist = Core.recommend(state.candidatePool, state.tracks, { ...options(), limit: 30 });
      $(".mm-status strong").textContent = "Checking every pick against this playlist…";
      const verified = await verifyNewCandidates(shortlist, targetPlaylistId, runId);
      if (!verified) return;
      if (!verified.length) throw new Error("I couldn't verify that these songs are new. Please retry in a moment.");
      state.candidates = verified;
      const ranked = Core.recommend(state.candidates, state.tracks, options());
      if (!ranked.length) throw new Error("The discovery pool was empty after duplicate removal. Please retry.");
      state.recommendations = ranked;
      render();
      rememberShownRecommendations();
      status.hidden = true;
      controls.hidden = false;
      results.hidden = false;
      setMessage("");
    } catch (error) {
      if (runId !== state.generationId) return;
      hero.hidden = false;
      status.hidden = true;
      setMessage(error.message || "Something went sideways. Try again.", true);
    } finally {
      if (runId === state.generationId) setBusy(false);
    }
  }

  function rerank() {
    if (state.loading) return;
    if (!state.candidates.length) return generate();
    state.recommendations = Core.recommend(state.candidates, state.tracks, options());
    render();
    rememberShownRecommendations();
  }

  async function remixPicks() {
    if (state.loading) return;
    if (!state.candidatePool.length) return generate();
    setBusy(true);
    const runId = ++state.generationId;
    const refresh = $(".mm-refresh");
    refresh.disabled = true;
    refresh.textContent = "Finding fresh picks…";
    refresh.title = "";
    results.hidden = true;
    status.hidden = false;
    setMessage("");
    $(".mm-status strong").textContent = "Taking a different route through your taste graph…";
    try {
      state.variation += 1;
      const unseenPool = Core.excludeShownTitles(state.candidatePool, state.shownTitles);
      const shortlist = Core.recommend(unseenPool, state.tracks, { ...options(), limit: 30 });
      if (!shortlist.length) throw new Error("You've explored every fresh title in this discovery pool.");
      $(".mm-status strong").textContent = "Verifying the next batch is genuinely new…";
      const verified = await verifyNewCandidates(shortlist, state.playlistId, runId);
      if (!verified) return;
      const ranked = Core.recommend(verified, state.tracks, options());
      if (!ranked.length) throw new Error("No more verified-new titles are available in this discovery pool.");
      state.candidates = verified;
      state.recommendations = ranked;
      render();
      rememberShownRecommendations();
      $(".mm-engine").textContent = "Fresh batch";
    } catch (error) {
      if (runId !== state.generationId) return;
      setMessage(error.message || "No fresh batch was available. Your current picks are still here.", true);
      refresh.title = error.message || "No fresh batch was available.";
      $(".mm-engine").textContent = "No unseen batch found";
    } finally {
      if (runId === state.generationId) {
        setBusy(false);
        status.hidden = true;
        results.hidden = false;
        refresh.disabled = false;
        refresh.textContent = "Remix picks";
      }
    }
  }

  launch.addEventListener("click", () => setOpen(true));
  $(".mm-close").addEventListener("click", () => setOpen(false));
  $(".mm-generate").addEventListener("click", generate);
  $(".mm-refresh").addEventListener("click", remixPicks);
  $(".mm-cancel").addEventListener("click", cancelDiscovery);
  $(".mm-restore").addEventListener("click", () => {
    state.rejected.clear();
    render();
    $(".mm-refresh").focus();
  });
  shell.querySelectorAll('input[type="range"]').forEach((input) => {
    const update = () => {
      shell.querySelector(`[data-value-for="${input.name}"]`).textContent = `${input.value}%`;
      input.setAttribute("aria-valuetext", `${input.value} percent`);
    };
    update();
    input.addEventListener("input", update);
    input.addEventListener("change", rerank);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".mm-add-wrap")) closePlaylistPickers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openPicker = shell.querySelector(".mm-playlist-picker:not([hidden])");
    if (openPicker) {
      closePlaylistPickers();
      openPicker.closest(".mm-add-wrap")?.querySelector(".mm-playlist-picker-toggle")?.focus();
      event.stopPropagation();
    } else if (state.open) setOpen(false);
  });
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
    setBusy(false);
    clearTimeout(state.routeTimer);
    stopPreview(true);
    state.playlistId = nextPlaylistId;
    state.tracks = [];
    state.candidatePool = [];
    state.candidates = [];
    state.recommendations = [];
    state.membership.clear();
    state.shownTitles.clear();
    state.added.clear();
    state.playlistOptions.clear();
    state.playlistOptionRequests.clear();
    playlistView.clear();
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
  new MutationObserver(() => { handleRouteChange(); playlistView.schedule(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(handleRouteChange, 1000);
})();
