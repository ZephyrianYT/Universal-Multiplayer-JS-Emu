// Jet FX: the pixel-art jet as Retro Hub's loading screen, controller test and screensaver.
//
// Self-contained: it only needs jet-scene.js (window.RH.JetScene, built from retro-hub-loading-screen)
// and, when it is there, RH.Input (the hub's own controller pipeline) and RH.UI.Settings.
// Nothing in here touches the emulator, the WebRTC link or the hub socket.
//
// How the rest of the hub drives it (see README in this folder):
//   const h = RH.JetFX.hold("library", { title: "Scanning the library", progress: null, mount: box });
//   h.update({ status: "1,200 games found", progress: 40 });   // progress null = no percentage (sweeping bar)
//   h.done({ ready: true });                                    // fades out once nothing else holds it
// or, without a reference to this file:
//   window.dispatchEvent(new CustomEvent("rh-load", { detail: { id: "x", state: "start" | "progress" | "end", ... } }))
//   RH.JetFX.openPads()   the controller test       RH.JetFX.close()   skip whatever is showing
//
// One view at a time: a state machine picks what to show (controller test > newest loading hold >
// screensaver), moves the one canvas between places, and tears everything down (rAF, observers,
// gamepad polling, WebGL context, DOM) when nothing is left to show.
(function () {
  "use strict";
  const RH = (window.RH = window.RH || {});
  const DEF = { loading: true, idleMin: 5 };
  const cfg = () => ({ ...DEF, ...(RH.UI?.Settings?.get("jetfx") || {}) });
  const saveCfg = patch => RH.UI?.Settings?.patch("jetfx", { ...cfg(), ...patch });
  const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const TIPS = [
    "Press F on a game (or right-click it) to make it a favourite",
    "Lobby Browser: turn on Alert me to hear when a matching lobby opens",
    "Lobby full? Choose Wait for a seat and you join as soon as one frees up",
    "Shuffler: F8 marks a game beaten, F9 swaps, F10 holds the current one",
    "Add friends by account ID, then invite them straight into your lobby",
    "Reloaded by accident? You get your seat back automatically",
    "Play again starts a rematch without fetching the game again",
    "Select (or I) opens the input tester: check every button before the match",
  ];

  // ================================================================ the scene (kept 45 s after use, it takes ~0.2 s to build)
  let spare = null, spareTimer = 0;
  const timeOfDay = () => { const h = new Date().getHours(); return h >= 7 && h < 17 ? "day" : h >= 17 && h < 20 ? "sunset" : "night"; };
  const sceneParams = () => ({ ...RH.JetScene.DEFAULT_PARAMS, intro: false, stunts: true, wingmen: 2, jetScale: 0.6, altitude: 110,
    clouds: 0.45, flameStyle: "realistic", afterburner: 1, followPointer: false, invertY: false, view: "top", timeOfDay: timeOfDay() });
  function takeScene() {
    clearTimeout(spareTimer);
    const p = sceneParams();
    if (spare) { const s = spare; spare = null; s.setParams(p); return s; }
    return RH.JetScene.createScene(p);
  }
  function giveBack(scene) { spare = scene; clearTimeout(spareTimer); spareTimer = setTimeout(() => { spare = null; }, 45000); }

  // ================================================================ controllers: the hub's own pipeline
  // RetroPad ids (input.js): 0 B (bottom face), 1 Y (left), 2 Select, 3 Start, 4-7 D-pad, 8 A (right), 9 X (top),
  // 10 L, 11 R, 12 L2, 13 R2, 14 L3, 15 R3, 16-19 left stick right/left/down/up, 20-23 right stick.
  const SEES = [[4, "↑"], [5, "↓"], [6, "←"], [7, "→"], [0, "B"], [8, "A"], [1, "Y"], [9, "X"], [10, "L"], [11, "R"],
    [12, "L2"], [13, "R2"], [14, "L3"], [15, "R3"], [2, "Select"], [3, "Start"]];
  const padKind = id => (/054c|dualsense|dualshock|playstation/i.test(id) ? "ps" : /057e|nintendo|switch|joy-con/i.test(id) ? "nin" : "xb");
  const GLYPH = { ps: { boost: "✕", roll: "○", view: "△" }, nin: { boost: "B", roll: "A", view: "X" }, xb: { boost: "A", roll: "B", view: "Y" } };
  // One Pad per controller (in connection order, like the seats), fed by RH.Input.attachGamepads with the
  // calibration deadzones and learned instrument layouts applied: what the drawer shows is what a seat gets.
  function createPads(onChange) {
    const pads = [];
    const padFor = order => pads[order] || (pads[order] = new RH.Input.Pad(() => onChange()));
    const detach = RH.Input ? RH.Input.attachGamepads("psx", padFor) : () => {};   // psx: analog sticks + L2/R2
    return { pads, detach };
  }

  // ================================================================ requests -> what to show
  const holds = [];            // { id, opts, visible, skipped, timer }
  let padsOpen = false, idleOn = false, view = null;
  function wanted() {
    if (padsOpen) return { mode: "pads" };
    for (let i = holds.length - 1; i >= 0; i--) if (holds[i].visible && !holds[i].skipped) return { mode: "loading", hold: holds[i] };
    if (idleOn) return { mode: "idle" };
    return null;
  }
  function sync() {
    const w = wanted();
    if (!w) { if (view) view.close(); return; }
    if (!RH.JetScene) return;
    if (!view) view = createView();
    view.show(w);
  }

  function hold(id, opts = {}) {
    let h = holds.find(x => x.id === id);
    if (h) { h.update(opts); return h; }
    h = { id, opts: { progress: null, panel: true, delay: 0, ...opts }, visible: false, skipped: !cfg().loading, timer: 0,
      update(o) { Object.assign(h.opts, o || {}); if (view?.current?.hold === h) view.refresh(); },
      done({ ready = false } = {}) {
        clearTimeout(h.timer);
        const i = holds.indexOf(h); if (i < 0) return;
        const showing = view?.current?.hold === h && h.opts.panel !== false;
        if (ready && showing && !h.readyShown) {
          h.readyShown = true; h.opts.progress = 100; h.opts.status = "Ready"; view.refresh();
          setTimeout(() => h.done(), 650);
          return;
        }
        holds.splice(i, 1); sync();
      },
    };
    holds.push(h);
    // a short wait first, so a fast load does not flash the screen
    const show = () => { h.visible = true; sync(); };
    if (h.opts.delay > 0) h.timer = setTimeout(show, h.opts.delay); else show();
    return h;
  }
  const end = id => holds.find(x => x.id === id)?.done();
  window.addEventListener("rh-load", e => {
    const d = e.detail || {};
    if (!d.id) return;
    if (d.state === "end") end(d.id); else hold(d.id, d);
  });

  // ================================================================ the view: one canvas, moved between places
  function createView() {
    const root = document.createElement("div");
    root.className = "jfx";
    root.tabIndex = -1;
    root.innerHTML = `
      <canvas class="jfx-px" role="img" aria-label="A pixel-art fighter jet and two wingmen flying over islands"></canvas>
      <canvas class="jfx-fire" aria-hidden="true"></canvas>
      <div class="jfx-shade" aria-hidden="true"></div>
      <header class="jfx-top">
        <div class="jfx-brand"><span class="jfx-dot"></span>Retro Hub</div>
        <p class="jfx-hint" aria-live="off"></p>
        <span class="jfx-badge" title="Controllers connected" hidden></span>
        <button type="button" class="small jfx-pads-btn" aria-expanded="false" title="Input tester (Select / I)">🎮 Inputs</button>
        <button type="button" class="small icon jfx-close" title="Hide (Start / Esc)" aria-label="Hide">✕</button>
      </header>
      <div class="jfx-bottom">
        <section class="jfx-panel" aria-live="polite"></section>
        <p class="jfx-tip" hidden></p>
      </div>
      <aside class="jfx-drawer" hidden aria-label="Input tester"></aside>`;
    const q = s => root.querySelector(s);
    const canvas = q(".jfx-px"), fire = q(".jfx-fire"), ctx = canvas.getContext("2d");
    const hintEl = q(".jfx-hint"), badge = q(".jfx-badge"), panel = q(".jfx-panel"), tipEl = q(".jfx-tip"), drawer = q(".jfx-drawer");
    let scene = null, image = null, layer = null, fireDead = false, raf = 0, last = 0, lastDraw = 0, px = 4;
    let current = null, host = null, closing = 0, destroyed = false, drawerOpen = false;
    let tipI = Math.floor(Math.random() * TIPS.length), tipTimer = 0, idleAt = 0;
    const held = new Map();                // keyboard flying keys: code -> left / right / up / down / boost
    let prevPad = null, padIdleSince = 0, kind = "", wakeRef = null;

    // ---- layout (ResizeObserver on whatever it is mounted in)
    const layout = () => {
      if (!scene) return;
      const cw = root.clientWidth, ch = root.clientHeight;
      if (!cw || !ch) return;
      px = Math.max(3, Math.round(cw / 480));
      const lw = Math.ceil(cw / px), lh = Math.ceil(ch / px);
      if (canvas.width !== lw || canvas.height !== lh) { canvas.width = lw; canvas.height = lh; scene.resize(lw, lh); image = null; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const fw = Math.round(lw * px * dpr), fh = Math.round(lh * px * dpr);
      if (fire.width !== fw || fire.height !== fh) { fire.width = fw; fire.height = fh; }
      for (const c of [canvas, fire]) Object.assign(c.style, { width: lw * px + "px", height: lh * px + "px",
        left: Math.round((cw - lw * px) / 2) + "px", top: Math.round((ch - lh * px) / 2) + "px" });
    };
    const ro = new ResizeObserver(layout);
    const onFireLost = e => { e.preventDefault(); layer = null; fireDead = true; };
    fire.addEventListener("webglcontextlost", onFireLost);

    // ---- controllers (attached only while the view lives)
    const ctl = createPads(() => {});
    const padValue = id => { let v = 0; for (const p of ctl.pads) if (p && p.values[id] > v) v = p.values[id]; return v; };
    const onPadConn = () => { renderDrawer(true); updateBadge(); };
    window.addEventListener("gamepadconnected", onPadConn);
    window.addEventListener("gamepaddisconnected", onPadConn);

    function readControls() {
      // a dialog on top (calibration, the layout wizard) owns the controller meanwhile
      if (document.querySelector("dialog[open], .calib:not([hidden])")) { prevPad = null; return; }
      const MAX = RH.Input?.MAX || 32767;
      const a = id => padValue(id) / MAX;
      const d = id => (padValue(id) > 0 ? 1 : 0);
      const turn = (d(7) - d(6)) + (a(16) - a(17));
      const climb = (d(4) - d(5)) + (a(19) - a(18));
      const boost = !!(d(0) || d(13) || d(11));
      const now = { turn, climb, boost, roll: !!d(8), view: !!d(9), select: !!d(2), start: !!d(3) };
      const any = turn || climb || boost || now.roll || now.view || now.select || now.start;
      const prev = prevPad || now;               // the first reading is the baseline: a held Start does not close at once
      prevPad = now;
      if (any) {
        const gp = Array.from(navigator.getGamepads?.() || []).find(Boolean);
        if (gp && kind !== padKind(gp.id)) { kind = padKind(gp.id); renderHint(); }
        padIdleSince = performance.now();
      }
      if (current?.mode === "idle") { if (any && prev !== now) wake(); return; }
      if (now.start && !prev.start) { skip(); return; }
      if (now.select && !prev.select) toggleDrawer();
      if (now.roll && !prev.roll) scene.roll();
      if (now.view && !prev.view) scene.toggleView();
      sendKeys(now);
      // let go for 4 s: back to autopilot
      if (!any && !held.size && padIdleSince && performance.now() - padIdleSince > 4000) { padIdleSince = 0; scene.pointerMove(0, 0); scene.pointerLeave(); }
    }
    function sendKeys(p = prevPad || {}) {
      let t = p.turn || 0, c = p.climb || 0, b = !!p.boost;
      for (const k of held.values()) {
        if (k === "left") t -= 1; else if (k === "right") t += 1; else if (k === "up") c += 1; else if (k === "down") c -= 1; else if (k === "boost") b = true;
      }
      scene.setKeys(Math.max(-1, Math.min(1, t)), Math.max(-1, Math.min(1, c)), b, 0);
    }

    // ---- frame loop
    const frame = now => {
      raf = requestAnimationFrame(frame);
      if (!scene || !root.isConnected || !root.clientWidth) return;     // mounted somewhere hidden: no work
      if (!scene.width) { layout(); if (!scene.width) return; }        // shown before its first layout
      // under a loading emulator, 30 fps is plenty and leaves the main thread to the boot
      if (current?.hold?.opts.lite && now - lastDraw < 32) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; lastDraw = now;
      readControls();
      if (!scene) return;                                   // skip() may have closed it
      if (!(reduced() && current?.mode !== "pads")) scene.step(dt);
      const bytes = scene.render();
      if (!image) image = new ImageData(bytes, scene.width, scene.height);
      ctx.putImageData(image, 0, 0);
      const flames = scene.flames;
      if (flames.count > 0 && !layer && !fireDead) { layer = RH.JetScene.createFlameLayer(fire); if (!layer) fireDead = true; }
      if (layer) layer.draw(flames.count, flames.data, fire.width / scene.width, now / 1000);
      if (drawerOpen && now - lastDrawer > 66) { lastDrawer = now; renderDrawer(false); }
    };
    let lastDrawer = 0;

    // ---- keyboard (the global listener below forwards here while this view is up)
    const KEYS = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up",
      ArrowDown: "down", KeyS: "down", Space: "boost", ShiftLeft: "boost", ShiftRight: "boost" };
    function key(e) {
      if (!scene) return;
      const full = !host;
      if (current?.mode === "idle") { if (e.type === "keydown") { swallow(e); wake(); } return; }
      // inline (library box): only while it has focus, so the page's own keys keep working
      if (!full && current?.hold?.opts.lite !== true && !root.contains(document.activeElement)) return;
      const down = e.type === "keydown";
      if (down && e.code === "Escape") { swallow(e); skip(); return; }
      if (down && e.code === "KeyI" && !e.repeat) { swallow(e); toggleDrawer(); return; }
      if (down && e.code === "KeyE" && !e.repeat) { scene.roll(); full && swallow(e); return; }
      if (down && e.code === "KeyV" && !e.repeat) { scene.toggleView(); full && swallow(e); return; }
      const k = KEYS[e.code];
      if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
      if (down) held.set(e.code, k); else held.delete(e.code);
      if (kind) { kind = ""; renderHint(); }
      padIdleSince = performance.now();
      sendKeys();
      if (full || e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (full) e.stopPropagation();
    }
    const swallow = e => { e.preventDefault(); e.stopPropagation(); };
    const onBlur = () => { held.clear(); if (scene) sendKeys(); };
    window.addEventListener("blur", onBlur);

    // ---- pointer
    root.addEventListener("pointerdown", e => {
      if (current?.mode === "idle") { swallow(e); wake(); return; }
      if (e.target.closest("button, a, input, select, .jfx-drawer, .jfx-panel")) return;
      root.focus({ preventScroll: true });
      scene?.roll();
    });
    root.addEventListener("pointermove", e => {
      if (current?.mode !== "idle") return;
      if (!wakeRef) wakeRef = [e.clientX, e.clientY];
      else if (Math.hypot(e.clientX - wakeRef[0], e.clientY - wakeRef[1]) > 24) wake();
    });
    q(".jfx-close").onclick = () => skip();
    q(".jfx-pads-btn").onclick = () => toggleDrawer();

    // ---- what the panel says
    function renderHint() {
      const g = GLYPH[kind || "xb"];
      const pad = kind ? `Stick / D-pad steer · ${g.boost} boost · ${g.roll} roll · ${g.view} view · Select inputs · Start hide`
        : "Arrows / WASD steer · Space boost · E roll · V view · I inputs · Esc hide";
      hintEl.textContent = current?.mode === "idle" ? "Press any key or button" : pad;
    }
    function updateBadge() {
      const n = Array.from(navigator.getGamepads?.() || []).filter(Boolean).length;
      badge.hidden = !n; badge.textContent = "🎮 " + n;
    }
    function bar(value, waiting, accent) {
      const n = 24, lit = Math.floor((Math.min(100, Math.max(0, value)) / 100) * n);
      let s = `<div class="jfx-bar${waiting ? " waiting" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${waiting ? "" : ` aria-valuenow="${Math.round(value)}"`} aria-label="Loading" style="--jfx-accent:${accent}">`;
      for (let i = 0; i < n; i++) s += `<span class="${!waiting && i < lit ? "on" : !waiting && i === lit && lit < n ? "head" : ""}"></span>`;
      if (waiting) s += `<b class="jfx-sweep" aria-hidden="true"><span></span><span></span><span></span><span></span></b>`;
      return s + "</div>";
    }
    function refresh() {
      const m = current?.mode;
      root.dataset.mode = m || "";
      renderHint();
      updateBadge();
      if (m === "loading") {
        const o = current.hold.opts;
        panel.hidden = o.panel === false;
        const waiting = o.progress == null;
        const value = waiting ? 0 : Math.max(0, Math.min(100, Number(o.progress) || 0));
        const ready = !waiting && value >= 100;
        const accent = ready ? "var(--ok, #4ade80)" : "var(--accent, #ffd60a)";
        panel.innerHTML = `<div class="jfx-row">
            <img src="/icon.svg" alt="" width="64" height="64" class="jfx-duck${ready ? " still" : ""}" draggable="false">
            <div class="jfx-what">
              <p class="jfx-kicker">${ready ? "Ready" : esc(o.kicker || "Now loading")}</p>
              <h2 class="jfx-title" title="${esc(o.title)}">${esc(o.title || "Retro Hub")}</h2>
              <div class="jfx-chips">${[o.console, o.modeLabel].filter(Boolean).map(c => `<span>${esc(c)}</span>`).join("")}</div>
            </div>
          </div>
          ${bar(value, waiting, accent)}
          <div class="jfx-status"><span class="${ready ? "ready" : "dots"}">${esc(ready ? "Ready" : o.status || "Loading")}</span>${waiting ? "" : `<b>${Math.floor(value)}%</b>`}</div>`;
      } else if (m === "pads") {
        panel.hidden = false;
        const c = cfg();
        panel.innerHTML = `<div class="jfx-row">
            <img src="/icon.svg" alt="" width="64" height="64" class="jfx-duck" draggable="false">
            <div class="jfx-what">
              <p class="jfx-kicker">Controller test</p>
              <h2 class="jfx-title">Fly to check your inputs</h2>
              <p class="jfx-sub">Plug a controller in at any time. The tester shows exactly what your seat sends in a match.</p>
            </div>
          </div>
          <div class="jfx-opts">
            <label class="check small"><input type="checkbox" data-opt="loading"${c.loading ? " checked" : ""}> Jet while games load</label>
            <label class="small">Screensaver <select data-opt="idleMin">${[0, 2, 5, 10, 15].map(v => `<option value="${v}"${+c.idleMin === v ? " selected" : ""}>${v ? v + " min" : "off"}</option>`).join("")}</select></label>
          </div>`;
        panel.querySelector('[data-opt="loading"]').onchange = e => saveCfg({ loading: e.target.checked });
        panel.querySelector('[data-opt="idleMin"]').onchange = e => saveCfg({ idleMin: Number(e.target.value) });
      } else if (m === "idle") {
        panel.hidden = false;
        const t = new Date();
        panel.innerHTML = `<div class="jfx-row"><img src="/icon.svg" alt="" width="64" height="64" class="jfx-duck" draggable="false">
          <div class="jfx-what"><p class="jfx-kicker">Standing by</p><h2 class="jfx-title jfx-clock">${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</h2>
          <p class="jfx-sub">Press any key or button to come back.</p></div></div>`;
      }
      const tips = m === "loading" && current.hold.opts.tips !== false && current.hold.opts.panel !== false;
      tipEl.hidden = !tips;
      if (tips && !tipEl.textContent) showTip();
    }
    function showTip() {
      tipEl.innerHTML = `<span class="jfx-tag">Tip</span><span>${esc(TIPS[tipI++ % TIPS.length])}</span>`;
      tipEl.classList.remove("in"); void tipEl.offsetWidth; tipEl.classList.add("in");
    }

    // ---- input tester drawer
    let drawerSig = "";
    function toggleDrawer(on = !drawerOpen) {
      drawerOpen = on; drawer.hidden = !on;
      q(".jfx-pads-btn").setAttribute("aria-expanded", String(on));
      if (on) renderDrawer(true);
    }
    function renderDrawer(rebuild) {
      const list = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
      const sig = list.map(g => g.index + g.id + g.buttons.length + "/" + g.axes.length).join("|");
      if (rebuild || sig !== drawerSig) {
        drawerSig = sig;
        const maps = RH.Input?.padMaps?.() || {};
        let cal = {}; try { cal = JSON.parse(localStorage.getItem("rh-calibration") || "{}") || {}; } catch {}
        drawer.innerHTML = `<div class="jfx-dh"><b>Input tester</b><span class="grow"></span>
            <button type="button" class="small" data-act="calib" title="Measure lag and stick deadzones">Calibrate</button>
            <button type="button" class="small" data-act="learn" title="Learn a layout for guitars, drums and odd controllers">Learn layout</button></div>` +
          (list.length ? list.map((g, order) => `<div class="jfx-pad" data-gp="${g.index}">
            <div class="jfx-ph"><b>Controller ${order + 1}</b><span class="trunc" title="${esc(g.id)}">${esc(g.id.replace(/\s*\(.*?\)\s*/g, " ").trim() || g.id)}</span>
              ${maps[g.id] ? '<span class="jfx-tag">learned layout</span>' : g.mapping === "standard" ? '<span class="jfx-tag ok">standard</span>' : '<span class="jfx-tag warn" title="The browser does not know this layout: use Learn layout">non-standard</span>'}
              ${cal[g.id] ? '<span class="jfx-tag">calibrated</span>' : ""}</div>
            <div class="jfx-sticks">${[0, 2].filter(i => g.axes.length > i + 1).map(i => `<span class="jfx-stick" data-ax="${i}"><i></i></span>`).join("")}
              <div class="jfx-raw">${g.buttons.map((_, i) => `<i data-b="${i}">${i}</i>`).join("")}</div></div>
            <div class="jfx-axes">${g.axes.map((_, i) => `<span data-a="${i}" title="Axis ${i}"><i></i></span>`).join("")}</div>
            <div class="jfx-sees"><span class="muted">Seat P${order + 1} gets</span>${SEES.map(([id, l]) => `<i data-id="${id}">${l}</i>`).join("")}</div>
          </div>`).join("") : `<p class="jfx-none">No controller yet. Plug one in (or press a button on it: browsers only report a controller after its first press).</p>`) +
          `<p class="jfx-note">Controller 1 plays your seat; with extra local seats, controller 2 plays P2 and so on. Keyboard: ${esc(RH.Input?.KEY_HELP?.retro?.A || "")}</p>`;
        drawer.querySelector('[data-act="calib"]').onclick = () => document.getElementById("calib-btn")?.click();
        drawer.querySelector('[data-act="learn"]').onclick = () => document.querySelector("[data-open-instruments]")?.click();
      }
      list.forEach((g, order) => {
        const box = drawer.querySelector(`[data-gp="${g.index}"]`); if (!box) return;
        g.buttons.forEach((b, i) => {
          const el = box.querySelector(`[data-b="${i}"]`); if (!el) return;
          const v = typeof b === "object" ? b.value : b, on = typeof b === "object" ? b.pressed || v > 0.5 : v > 0.5;
          el.classList.toggle("on", on); el.style.setProperty("--v", String(Math.max(0, Math.min(1, v || 0))));
        });
        g.axes.forEach((v, i) => { const el = box.querySelector(`[data-a="${i}"] i`); if (el) el.style.left = (50 + 50 * Math.max(-1, Math.min(1, v))) + "%"; });
        box.querySelectorAll(".jfx-stick").forEach(st => {
          const i = +st.dataset.ax, x = g.axes[i] || 0, y = g.axes[i + 1] || 0;
          st.firstElementChild.style.transform = `translate(${x * 18}px, ${y * 18}px)`;
        });
        const pad = ctl.pads[order];
        box.querySelectorAll(".jfx-sees [data-id]").forEach(el => el.classList.toggle("on", !!pad && pad.values[+el.dataset.id] > 0));
      });
    }

    // ---- show / move / close
    function mountTo(w) {
      const target = w.mode === "loading" && w.hold.opts.mount ? (typeof w.hold.opts.mount === "string" ? document.querySelector(w.hold.opts.mount) : w.hold.opts.mount) : null;
      if (target !== host || !root.isConnected) {
        if (host) host.classList.remove("jfx-host");
        host = target;
        if (host) host.classList.add("jfx-host");
        (host || document.body).appendChild(root);
        ro.disconnect(); ro.observe(root);
      }
      root.classList.toggle("jfx-full", !host);
      root.classList.toggle("jfx-inline", !!host);
      root.classList.toggle("jfx-lite", !!w.hold?.opts.lite);
    }
    function show(w) {
      if (destroyed) return;
      clearTimeout(closing); closing = 0;
      const modeChanged = !current || current.mode !== w.mode || current.hold !== w.hold;
      current = w;
      mountTo(w);
      if (!scene) {
        // paint the panel first, build the islands on the next frame (~0.2 s the first time)
        requestAnimationFrame(() => {
          if (destroyed || scene) return;
          scene = takeScene(); layout(); last = performance.now();
          raf = requestAnimationFrame(frame);
        });
      }
      if (modeChanged) {
        prevPad = null; wakeRef = null;
        if (w.mode === "pads") toggleDrawer(true);
        else if (w.mode === "idle") toggleDrawer(false);
        clearInterval(tipTimer); tipEl.textContent = "";
        tipTimer = setInterval(() => { if (!tipEl.hidden) showTip(); if (current?.mode === "idle") refresh(); }, 6500);
      }
      refresh();
      requestAnimationFrame(() => root.classList.add("in"));
      if (w.mode !== "loading" || !host) root.focus({ preventScroll: true });
    }
    function close() {
      if (closing || destroyed) return;
      root.classList.remove("in");
      closing = setTimeout(destroy, reduced() ? 0 : 380);    // matches the CSS fade
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf); clearInterval(tipTimer); ro.disconnect();
      ctl.detach();
      window.removeEventListener("gamepadconnected", onPadConn);
      window.removeEventListener("gamepaddisconnected", onPadConn);
      window.removeEventListener("blur", onBlur);
      fire.removeEventListener("webglcontextlost", onFireLost);
      if (layer) { layer.dispose(); layer = null; try { fire.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {} }
      if (host) host.classList.remove("jfx-host");
      root.remove();
      if (scene) giveBack(scene);
      scene = null; image = null;
      if (view === api) view = null;
    }
    function skip() {
      const m = current?.mode;
      if (m === "pads") padsOpen = false;
      else if (m === "idle") { idleOn = false; bumpIdle(); }
      else if (m === "loading") current.hold.skipped = true;
      sync();
    }
    function wake() { idleOn = false; bumpIdle(); sync(); }

    const api = { show, close, refresh, key, get current() { return current; }, get root() { return root; }, get scene() { return scene; } };
    return api;
  }

  // keyboard: registered before app.js, so it sees keys before the emulator's own listeners
  for (const t of ["keydown", "keyup"]) window.addEventListener(t, e => {
    if (!view || !view.current) return;
    const el = e.target;
    if (el && el !== view.root && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return;
    view.key(e);
  }, true);

  // ================================================================ screensaver
  let lastAct = performance.now(), lastSig = "";
  const bumpIdle = () => { lastAct = performance.now(); };
  for (const t of ["pointerdown", "keydown", "wheel", "touchstart", "pointermove"]) window.addEventListener(t, bumpIdle, { capture: true, passive: true });
  setInterval(() => {
    const min = Number(cfg().idleMin) || 0;
    if (!min || view || !RH.JetScene) return;
    // never over a game, a dialog, a hidden tab, or for people who asked for less motion
    if (document.hidden || document.body.classList.contains("playing") || document.querySelector("dialog[open], .calib:not([hidden])") || reduced()) { bumpIdle(); return; }
    const sig = Array.from(navigator.getGamepads?.() || []).filter(Boolean)
      .map(g => g.buttons.map(b => (b.pressed ? 1 : 0)).join("") + g.axes.map(a => Math.round(a * 4)).join(",")).join("|");
    if (sig !== lastSig) { lastSig = sig; bumpIdle(); }
    if (performance.now() - lastAct > min * 60000) { idleOn = true; sync(); }
  }, 1000);
  window.addEventListener("pagehide", () => { holds.length = 0; padsOpen = false; idleOn = false; if (view) { view.close(); } });

  document.addEventListener("click", e => { if (e.target.closest?.("[data-open-pads]")) RH.JetFX.openPads(); });

  RH.JetFX = {
    hold, end,
    openPads() { padsOpen = true; sync(); },
    close() { padsOpen = false; idleOn = false; holds.forEach(h => { h.skipped = true; }); sync(); },
    idleNow() { idleOn = true; sync(); },               // for testing the screensaver
    get state() { return { mode: view?.current?.mode || "off", holds: holds.map(h => ({ id: h.id, visible: h.visible, skipped: h.skipped })), cfg: cfg() }; },
  };
})();
