// Solo Shuffler page: setup (files / library, swap times, options) and the playing view.
// The games themselves run in RH.ShuffleEngine (shuffler-core.js), shared with Shuffle lobbies.
(function () {
  "use strict";
  const { Settings, Modal, toast, Sfx } = window.RH.UI;
  const { Input, ShuffleEngine, SHUFFLE_HEAVY } = window.RH;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s % 60).padStart(2, "0")}`; };
  const MAX_GAMES = 8;
  const prefs = () => ({ min: 15, max: 45, showTimer: false, sound: true, volume: 0.5, saver: true, ...(Settings.get("shuffle") || {}) });
  let config = null, me = null, library = null, picks = [], engine = null, ticker = 0, detach = [], inputSystem = "";

  // ---------------------------------------------------------------- setup
  async function boot() {
    try { [config, me] = await Promise.all([fetch("/api/config").then(r => r.json()), fetch("/api/me").then(r => r.json())]); }
    catch { return showErr("Couldn't reach the hub."); }
    const p = prefs();
    $("sh-min").value = p.min; $("sh-max").value = p.max; $("sh-showtimer").checked = p.showTimer; $("sh-sound").checked = p.sound;
    $("sh-volume").value = p.volume; $("sh-saver").checked = p.saver;
    if (me.library) {
      $("sh-lib-wrap").hidden = false;
      fetch("/api/library", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(l => { library = (l || []).filter(g => !g.native && !g.app && config.systems[g.system]); renderLib(); }).catch(() => {});
    }
    renderPicks();
  }
  const showErr = t => { $("sh-error").hidden = !t; $("sh-error").textContent = t || ""; };
  const browserSystems = () => Object.keys(config.systems).filter(id => !(config.nativeSystems || []).includes(id));
  function detect(fileName) {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const remembered = (Settings.get("extSys") || {})[ext];
    const sys = remembered || config.detect.ext[ext];
    return sys && !(config.nativeSystems || []).includes(sys) ? sys : "";
  }
  $("sh-files").addEventListener("change", () => {
    for (const f of $("sh-files").files) {
      if (picks.length >= MAX_GAMES) { toast(`Up to ${MAX_GAMES} games.`, { kind: "bad" }); break; }
      picks.push({ name: f.name.replace(/\.[^.]+$/, ""), system: detect(f.name), file: f });
    }
    $("sh-files").value = "";
    renderPicks();
  });
  function renderPicks() {
    const opts = sys => browserSystems().map(id => `<option value="${id}"${id === sys ? " selected" : ""}>${esc(config.systems[id])}</option>`).join("");
    $("sh-games").innerHTML = picks.map((g, i) => `<li><span class="slotnum">${i + 1}</span><span class="pname trunc grow" title="${esc(g.name)}">${esc(g.name)}</span>
      <select data-sys="${i}" aria-label="Console for ${esc(g.name)}"><option value="">Console…</option>${opts(g.system)}</select>
      <button class="small ghost icon" data-rm="${i}" aria-label="Remove ${esc(g.name)}">✕</button></li>`).join("") || '<li class="small muted">No games yet.</li>';
    const missing = picks.filter(g => !g.system).length, heavy = picks.filter(g => SHUFFLE_HEAVY.has(g.system)).length;
    $("sh-count").textContent = picks.length ? `${picks.length} game${picks.length === 1 ? "" : "s"}` : "";
    $("sh-start").disabled = picks.length < 2 || missing > 0;
    $("sh-mem").textContent = missing ? "Pick the console for every game." : picks.length < 2 ? "Add at least 2 games."
      : heavy >= 2 && !$("sh-saver").checked ? `${heavy} big consoles (PS1, N64, DS…) loaded at once use a lot of memory: the memory saver is safer.` : "";
  }
  $("sh-games").addEventListener("change", e => {
    const i = e.target.dataset.sys; if (i == null) return;
    picks[i].system = e.target.value;
    if (picks[i].file) Settings.patch("extSys", { [(picks[i].file.name.split(".").pop() || "").toLowerCase()]: e.target.value });
    renderPicks();
  });
  $("sh-games").addEventListener("click", e => { const i = e.target.closest("[data-rm]")?.dataset.rm; if (i != null) { picks.splice(Number(i), 1); renderPicks(); } });
  function renderLib() {
    const q = $("sh-lib-q").value.trim().toLowerCase();
    const list = (library || []).filter(g => !q || g.name.toLowerCase().includes(q)).slice(0, 40);
    $("sh-lib").innerHTML = list.map(g => `<li><span class="pname trunc grow">${esc(g.name)}</span><span class="small muted">${esc(config.systems[g.system] || g.system)}</span>
      <button class="small" data-add="${esc(g.path)}">Add</button></li>`).join("") || `<li class="small muted">${library ? "No games match." : "Loading…"}</li>`;
  }
  let libT = 0;
  $("sh-lib-q").addEventListener("input", () => { clearTimeout(libT); libT = setTimeout(renderLib, 150); });
  $("sh-lib").addEventListener("click", e => {
    const path = e.target.closest("[data-add]")?.dataset.add; if (!path) return;
    const g = library.find(x => x.path === path); if (!g) return;
    if (picks.length >= MAX_GAMES) return toast(`Up to ${MAX_GAMES} games.`, { kind: "bad" });
    picks.push({ name: g.name, system: g.system, path: g.path });
    renderPicks();
  });
  function savePrefs() {
    const min = Math.max(5, Math.min(600, Number($("sh-min").value) || 15)), max = Math.max(min, Math.min(900, Number($("sh-max").value) || 45));
    $("sh-min").value = min; $("sh-max").value = max;
    Settings.set("shuffle", { ...prefs(), min, max, showTimer: $("sh-showtimer").checked, sound: $("sh-sound").checked, saver: $("sh-saver").checked });
    if (engine) engine.setTimes(min, max);
    renderPicks();
  }
  for (const id of ["sh-min", "sh-max", "sh-showtimer", "sh-sound", "sh-saver"]) $(id).addEventListener("change", savePrefs);

  // ---------------------------------------------------------------- playing
  const pad = new Input.Pad(v => engine?.input(0, v));
  function attachInput(system) {
    if (system === inputSystem) return;
    inputSystem = system;
    detach.forEach(fn => { try { fn(); } catch {} }); detach = [];
    detach.push(Input.attachKeyboard(system, { A: pad }));
    detach.push(Input.attachGamepads(system, order => order === 0 ? pad : null));
  }
  $("sh-start").addEventListener("click", async () => {
    savePrefs(); showErr("");
    Sfx.unlock?.();
    $("sh-setup").hidden = true; $("sh-play").hidden = false; document.body.classList.add("playing");
    $("sh-loading").hidden = false;
    const p = prefs();
    engine = ShuffleEngine({
      stage: $("sh-stage"), cores: config.cores, min: p.min, max: p.max, memorySaver: p.saver,
      volume: () => Number($("sh-volume").value),
      games: picks.map(g => ({ name: g.name, system: g.system,
        url: g.file ? URL.createObjectURL(g.file) : "/roms/" + g.path.split("/").map(encodeURIComponent).join("/"),
        saveName: "shuffle__" + (g.file ? g.file.name : g.path.split("/").pop()) })),
      onLoad: (i, text) => renderLoading(i, text),
      onSwap: (g, i, prev) => { attachInput(g.system); if (prev >= 0) { banner(`🔀 ${g.name}`); if (prefs().sound) Sfx.go(); } },
      onChange: () => { renderHud(); renderStrip(); },
      onWin: s => showWin(s),
      onBusy: text => { if (text) { banner(text, 60000); } else $("sh-banner").hidden = true; },
    });
    renderStrip();
    await engine.boot();
    $("sh-loading").hidden = true;
    if (!engine.games.some(g => !g.beaten)) { toast("None of the games could start.", { kind: "bad", ms: 6000 }); return end(true); }
    clearInterval(ticker); ticker = setInterval(renderHud, 250);
    engine.start();
  });
  const loadText = [];
  function renderLoading(i, text) {
    loadText[i] = text;
    $("sh-load-rows").innerHTML = picks.map((g, k) => `<div class="lrow"><span class="slotnum">${k + 1}</span><span class="pname trunc">${esc(g.name)}</span>
      <span class="small muted">${esc(loadText[k] || "Waiting")}</span></div>`).join("");
  }
  function banner(text, ms = 1800) {
    const b = $("sh-banner"); b.textContent = text; b.hidden = false;
    clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, ms);
  }
  function renderHud() {
    if (!engine) return;
    const st = engine.state(), g = engine.active();
    $("sh-now").textContent = g ? g.name : "";
    $("sh-left").textContent = g ? `${config.systems[g.system] || g.system} · ${st.left} of ${engine.games.length} left${st.saver ? " · memory saver" : ""}` : "";
    $("sh-stats").textContent = st.startedAt ? `${fmt(Date.now() - st.startedAt)} · ${st.swaps} swap${st.swaps === 1 ? "" : "s"}` : "";
    const showT = prefs().showTimer && st.swapAt > 0, t = $("sh-timer");
    t.hidden = !(showT || st.hold || (st.left <= 1 && g));
    t.textContent = st.hold ? "⏸ on hold" : st.left <= 1 ? "last game: no more swaps" : showT ? `swap in ${Math.max(0, Math.ceil((st.swapAt - Date.now()) / 1000))} s` : "";
    $("sh-hold").setAttribute("aria-pressed", String(st.hold)); $("sh-hold").classList.toggle("on", st.hold);
  }
  function renderStrip() {
    if (!engine) return;
    const cur = engine.state().cur;
    $("sh-strip").innerHTML = engine.games.map((g, i) => `<span class="sh-chip${i === cur ? " on" : ""}${g.beaten ? " done" : ""}" title="${esc(g.name)}">${g.beaten ? (g.error ? "✖" : "✓") : i === cur ? "▶" : "·"} ${esc(g.name)}</span>`).join("");
  }
  function beaten() {
    if (!engine) return;
    const g = engine.markBeaten();
    if (g) { toast(`✓ ${g.name} beaten!`, { kind: "ok", ms: 3000 }); const n = engine.active(); if (n && n !== g) banner(`✓ ${g.name} · next: ${n.name}`); }
  }
  function showWin(s) {
    clearInterval(ticker);
    $("sh-win-sub").textContent = `${s.games.filter(g => !g.error).length} games in ${fmt(s.total)} with ${s.swaps} swap${s.swaps === 1 ? "" : "s"}.`;
    $("sh-win-list").innerHTML = s.games.map(g => `<li><span class="pname trunc grow">${esc(g.name)}</span><span class="small muted">${g.error ? "didn't load" : "played " + fmt(g.played)}</span></li>`).join("");
    Sfx.chime();
    Modal.open($("sh-win"), { focus: "#sh-win-again" });
  }
  function end(skipConfirm) {
    if (!skipConfirm && !confirm("End this shuffle? Progress in the games is lost unless you saved in-game.")) return;
    clearInterval(ticker);
    detach.forEach(fn => { try { fn(); } catch {} }); detach = []; inputSystem = "";
    engine?.destroy(); engine = null;
    $("sh-play").hidden = true; $("sh-setup").hidden = false; document.body.classList.remove("playing");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    renderPicks();
  }
  $("sh-beaten").addEventListener("click", beaten);
  $("sh-swap").addEventListener("click", () => engine?.swapNow());
  $("sh-hold").addEventListener("click", () => engine?.setHold(!engine.hold));
  $("sh-end").addEventListener("click", () => end(false));
  $("sh-full").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen(); else $("sh-play").requestFullscreen?.().catch(() => {}); });
  $("sh-volume").addEventListener("input", () => { const v = Number($("sh-volume").value); Settings.set("shuffle", { ...prefs(), volume: v }); engine?.setVolume(v); });
  $("sh-win-close").addEventListener("click", () => Modal.close($("sh-win")));
  $("sh-win-again").addEventListener("click", () => { Modal.close($("sh-win")); end(true); });
  window.addEventListener("keydown", e => {
    if ($("sh-play").hidden || e.repeat || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "F8") { e.preventDefault(); beaten(); }
    else if (e.key === "F9") { e.preventDefault(); engine?.swapNow(); }
    else if (e.key === "F10") { e.preventDefault(); engine?.setHold(!engine.hold); }
  }, true);
  window.addEventListener("beforeunload", e => { if (engine) { e.preventDefault(); e.returnValue = ""; } });
  boot();
})();
