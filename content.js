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
    added: new Set(),
    rejected: new Set(),
    aiSession: null,
    aiStatus: "Taste graph"
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

  function scrapeVisibleTracks() {
    const rows = [...document.querySelectorAll("ytmusic-responsive-list-item-renderer")];
    return rows.map((row) => {
      const anchor = row.querySelector('a[href*="watch?v="]');
      if (!anchor) return null;
      const url = new URL(anchor.href, location.origin);
      const artists = [...row.querySelectorAll('a[href*="browse/"]')].map((x) => x.textContent.trim()).filter(Boolean);
      const image = row.querySelector("img")?.src || "";
      return { videoId: url.searchParams.get("v"), title: anchor.textContent.trim(), artist: artists[0] || "Unknown artist", thumbnail: image };
    }).filter((x) => x?.videoId && x.title);
  }

  async function getPlaylistTracks(id) {
    const scraped = scrapeVisibleTracks();
    if (scraped.length >= 4) return Core.dedupe(scraped);
    const response = await bridge("playlist", { playlistId: id });
    return Core.dedupe(extractTracks(response));
  }

  async function searchFallback(seeds) {
    const searches = await Promise.allSettled(seeds.slice(0, 5).map((seed) =>
      bridge("search", { query: `${seed.artist} ${seed.title}` }).then((data) => extractTracks(data, seed.videoId))
    ));
    return searches.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  async function prepareAI() {
    if (state.aiSession || !("LanguageModel" in globalThis)) return null;
    try {
      const options = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
      const availability = await LanguageModel.availability(options);
      if (availability === "unavailable") return null;
      state.aiStatus = availability === "available" ? "On-device AI" : "Downloading on-device AI";
      state.aiSession = await LanguageModel.create(options);
      state.aiStatus = "On-device AI + taste graph";
      return state.aiSession;
    } catch (_) {
      state.aiStatus = "Taste graph";
      return null;
    }
  }

  async function aiRerank(items, seeds) {
    const session = state.aiSession;
    if (!session || items.length < 3) return items;
    const compactSeeds = seeds.slice(0, 24).map((x) => `${x.artist} — ${x.title}`).join("\n");
    const compactItems = items.slice(0, 24).map((x) => `${x.videoId}|${x.artist}|${x.title}`).join("\n");
    const prompt = `You are a daring music curator. Rank candidates for coherent taste, surprising bridges, and low obviousness. Do not group the same artist. Playlist:\n${compactSeeds}\nCandidates (id|artist|title):\n${compactItems}\nReturn only JSON: [{"id":"...","reason":"specific reason under 11 words"}]. Include every candidate exactly once.`;
    try {
      const output = await session.prompt(prompt);
      const json = output.slice(output.indexOf("["), output.lastIndexOf("]") + 1);
      const ranked = JSON.parse(json);
      const map = new Map(items.map((item) => [item.videoId, item]));
      const result = [];
      for (const entry of ranked) {
        const item = map.get(entry.id);
        if (item && !result.includes(item)) result.push({ ...item, reason: String(entry.reason || item.reason).slice(0, 90) });
      }
      for (const item of items) if (!result.some((x) => x.videoId === item.videoId)) result.push(item);
      return result;
    } catch (_) {
      return items;
    }
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
          <button class="mm-refresh" aria-label="Refresh recommendations">Remix picks</button>
        </section>
        <section class="mm-status" hidden><span class="mm-spinner"></span><strong>Mapping your taste graph…</strong><small>Sampling distant corners of this playlist</small></section>
        <section class="mm-results" hidden><div class="mm-result-head"><span class="mm-count"></span><span class="mm-engine"></span></div><div class="mm-list"></div></section>
      </div>
      <footer><span>Private by design</span><span>Runs inside YouTube Music</span></footer>
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
      diversity: 84,
      limit: 14
    };
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
    const add = document.createElement("button");
    add.className = "mm-add";
    add.setAttribute("aria-label", `Add ${track.title} to playlist`);
    add.innerHTML = `<span>+</span><em>Add</em>`;
    if (state.added.has(track.videoId)) { add.classList.add("is-added"); add.innerHTML = `<span>✓</span><em>Added</em>`; }
    add.addEventListener("click", () => addTrack(track, add));
    const dismiss = document.createElement("button");
    dismiss.className = "mm-dismiss";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", `Hide ${track.title}`);
    dismiss.addEventListener("click", () => {
      state.rejected.add(track.videoId);
      card.classList.add("is-leaving");
      setTimeout(() => { card.remove(); updateCount(); }, 220);
    });
    card.append(art, copy, add, dismiss);
    return card;
  }

  function updateCount() {
    const count = list.querySelectorAll(".mm-card:not(.is-leaving)").length;
    $(".mm-count").textContent = `${count} ${count === 1 ? "discovery" : "discoveries"}`;
  }

  function render() {
    list.replaceChildren();
    state.recommendations.filter((x) => !state.rejected.has(x.videoId)).forEach((track, i) => list.appendChild(createTrackCard(track, i)));
    $(".mm-engine").textContent = state.aiStatus;
    updateCount();
  }

  async function addTrack(track, button) {
    if (button.disabled || state.added.has(track.videoId)) return;
    button.disabled = true;
    button.classList.add("is-working");
    button.querySelector("em").textContent = "Adding";
    try {
      await bridge("add", { playlistId: state.playlistId, videoId: track.videoId });
      state.added.add(track.videoId);
      button.classList.remove("is-working");
      button.classList.add("is-added");
      button.innerHTML = `<span>✓</span><em>Added</em>`;
      button.title = "Added — syncing the playlist view";
      bridge("sync", { playlistId: state.playlistId }, 5000).catch(() => {});
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
    state.playlistId = playlistId();
    if (!state.playlistId) {
      setMessage("Open one of your playlists first — the URL needs a list ID.", true);
      return;
    }
    state.loading = true;
    const aiPromise = prepareAI();
    hero.hidden = true;
    controls.hidden = true;
    results.hidden = true;
    status.hidden = false;
    try {
      state.tracks = await getPlaylistTracks(state.playlistId);
      if (state.tracks.length < 2) throw new Error("I couldn't read enough tracks. Scroll the playlist once, then retry.");
      const seeds = Core.chooseSeeds(state.tracks, 7);
      $(".mm-status strong").textContent = `Exploring from ${seeds.length} taste anchors…`;
      const settled = await Promise.allSettled(seeds.map((seed) => bridge("neighbors", { videoId: seed.videoId }).then((data) => extractTracks(data, seed.videoId))));
      state.candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      let viable = Core.dedupe(state.candidates, state.tracks);
      if (viable.length < 8) {
        $(".mm-status strong").textContent = "Opening a second discovery route…";
        state.candidates.push(...await searchFallback(seeds));
        viable = Core.dedupe(state.candidates, state.tracks);
      }
      if (viable.length < 1) throw new Error("No new tracks escaped this playlist. Try Remix picks or a different playlist.");
      await aiPromise;
      let ranked = Core.recommend(state.candidates, state.tracks, options());
      ranked = await aiRerank(ranked, state.tracks);
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
      state.loading = false;
    }
  }

  function rerank() {
    if (!state.candidates.length) return generate();
    state.recommendations = Core.recommend(state.candidates, state.tracks, options());
    render();
  }

  launch.addEventListener("click", () => setOpen(true));
  $(".mm-close").addEventListener("click", () => setOpen(false));
  $(".mm-generate").addEventListener("click", generate);
  $(".mm-refresh").addEventListener("click", rerank);
  shell.querySelectorAll('input[type="range"]').forEach((input) => input.addEventListener("change", rerank));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.open) setOpen(false); });
  chrome.runtime.onMessage.addListener((message) => { if (message.type === "MUSEMINT_TOGGLE") setOpen(!state.open); });

  let previousUrl = location.href;
  new MutationObserver(() => {
    if (location.href === previousUrl) return;
    previousUrl = location.href;
    state.playlistId = playlistId();
    state.tracks = [];
    state.candidates = [];
    state.recommendations = [];
    state.rejected.clear();
    hero.hidden = false;
    controls.hidden = true;
    results.hidden = true;
    status.hidden = true;
    setMessage(state.playlistId ? "Ready to map this playlist." : "Open a YouTube Music playlist to begin.");
  }).observe(document.body, { childList: true, subtree: true });
})();
