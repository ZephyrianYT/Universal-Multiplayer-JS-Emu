// Controller input: keyboard layouts, standard gamepads and the on-screen touch controller.
// Everything produces EmulatorJS input ids (RetroPad numbering):
//   0 B, 1 Y, 2 Select, 3 Start, 4 Up, 5 Down, 6 Left, 7 Right, 8 A, 9 X, 10 L, 11 R, 12 L2, 13 R2, 14 L3, 15 R3,
//   16 LStick right, 17 left, 18 down, 19 up, 20 RStick right, 21 left, 22 down, 23 up.
// On N64 (mupen64plus): 0 A, 1 B, 3 Start, 4-7 D-pad, 10 L, 11 R, 12 Z, 16-19 stick, 20-23 C right/left/down/up.
// Digital ids carry 0/1, stick ids carry 0..32767. When several sources drive one id, the strongest wins.
(function () {
  "use strict";
  const N = 24, MAX = 32767;
  const isAxis = id => id >= 16 && id <= 23;
  const ANALOG_SYSTEMS = new Set(["n64", "psx", "psp", "nds", "ps2", "gc", "wii", "ps3", "xbox360", "wiiu",
    "switch", "xbox", "n3ds", "dreamcast", "pc"]);
  const TRIGGER_SYSTEMS = new Set(["psx", "ps2", "ps3", "xbox360", "wiiu", "switch", "xbox", "pc"]);     // touch controller shows L2 / R2
  const scheme = system => (system === "n64" ? "n64" : "retro");

  // ---------------------------------------------------------------- Pad: merges sources for one player seat
  class Pad {
    constructor(onChange) {
      this.onChange = onChange || (() => {});
      this.sources = new Map();          // name -> Float32Array(N)
      this.values = new Array(N).fill(0);
    }
    set(source, id, v) {
      let s = this.sources.get(source);
      if (!s) this.sources.set(source, s = new Float32Array(N));
      if (s[id] === v) return;
      s[id] = v; this._merge();
    }
    setAll(source, arr) {
      let s = this.sources.get(source);
      if (!s) this.sources.set(source, s = new Float32Array(N));
      let changed = false;
      for (let i = 0; i < N; i++) if (s[i] !== arr[i]) { s[i] = arr[i]; changed = true; }
      if (changed) this._merge();
    }
    clear(source) { if (this.sources.delete(source)) this._merge(); }
    _merge() {
      const next = new Array(N).fill(0);
      for (const s of this.sources.values()) for (let i = 0; i < N; i++) if (s[i] > next[i]) next[i] = s[i];
      let changed = false;
      for (let i = 0; i < N; i++) {
        const v = isAxis(i) ? Math.round(next[i]) : (next[i] > 0 ? 1 : 0);
        if (v !== this.values[i]) { this.values[i] = v; changed = true; }
      }
      if (changed) this.onChange(this.values.slice());
    }
  }

  // ---------------------------------------------------------------- keyboard
  const K = MAX;
  const KEYMAPS = {
    retro: {
      A: { ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyX: 8, KeyZ: 0, KeyS: 9, KeyA: 1,
           KeyQ: 10, KeyW: 11, KeyE: 12, KeyR: 13, Enter: 3, ShiftRight: 2, KeyV: 2 },
      B: { Numpad8: 4, Numpad5: 5, Numpad4: 6, Numpad6: 7, Numpad2: 8, Numpad1: 0, Numpad3: 9, Numpad0: 1,
           Numpad7: 10, Numpad9: 11, NumpadEnter: 3, NumpadAdd: 2 },
    },
    n64: {
      A: { ArrowUp: 19, ArrowDown: 18, ArrowLeft: 17, ArrowRight: 16, KeyX: 0, KeyZ: 1, KeyC: 12, KeyQ: 10, KeyW: 11,
           Enter: 3, KeyI: 23, KeyK: 22, KeyJ: 21, KeyL: 20, KeyT: 4, KeyG: 5, KeyF: 6, KeyH: 7 },
      B: { Numpad8: 19, Numpad5: 18, Numpad4: 17, Numpad6: 16, Numpad2: 0, Numpad1: 1, Numpad0: 12, Numpad7: 10,
           Numpad9: 11, NumpadEnter: 3, NumpadDivide: 23, NumpadMultiply: 20, NumpadSubtract: 21, Numpad3: 22 },
    },
  };
  const KEY_HELP = {
    retro: { A: "Arrows move · X = A · Z = B · S = X · A = Y · Q/W = L/R · Enter = Start · V = Select",
             B: "Numpad 8/4/5/6 move · 2 = A · 1 = B · 3 = X · 0 = Y · 7/9 = L/R · Enter = Start · + = Select" },
    n64:   { A: "Arrows = stick · X = A · Z = B · C = Z · Q/W = L/R · Enter = Start · I/J/K/L = C buttons · T/F/G/H = D-pad",
             B: "Numpad 8/4/5/6 = stick · 2 = A · 1 = B · 0 = Z · 7/9 = L/R · Enter = Start · / * - 3 = C buttons" },
  };

  // ---------------------------------------------------------------- calibration (see calibrate.js)
  // Lag equalization: when several controllers play on one computer, faster devices are delayed to match
  // the slowest calibrated one, so a wired pad doesn't beat a Bluetooth pad on input lag alone.
  const calibration = () => { try { return JSON.parse(localStorage.getItem("rh-calibration") || "{}") || {}; } catch { return {}; } };
  const MAX_EQUALIZE = 120;
  function lagPlan(deviceKeys) {
    const cal = calibration();
    const offs = deviceKeys.map(k => cal[k]?.offsetMs).filter(v => Number.isFinite(v));
    const worst = offs.length > 1 ? Math.max(...offs) : null;
    return key => {
      const o = cal[key]?.offsetMs;
      return worst == null || !Number.isFinite(o) ? 0 : Math.min(MAX_EQUALIZE, Math.max(0, worst - o));
    };
  }
  // Wraps a Pad so updates from one device arrive `ms` later (0 = passthrough).
  function delayed(pad, ms) {
    if (!ms) return pad;
    return {
      set: (...a) => setTimeout(() => pad.set(...a), ms),
      setAll: (src, arr) => { const copy = Array.from(arr); setTimeout(() => pad.setAll(src, copy), ms); },
      clear: src => setTimeout(() => pad.clear(src), ms),
    };
  }

  // layouts: { A: Pad, B: Pad } (either may be missing). opts.lagFor(deviceKey) -> ms delay.
  function attachKeyboard(system, layouts, opts = {}) {
    const sch = scheme(system);
    const maps = [];
    const kbDelay = opts.lagFor ? opts.lagFor("keyboard") : 0;
    for (const [name, pad] of Object.entries(layouts)) if (pad && KEYMAPS[sch][name]) maps.push([KEYMAPS[sch][name], delayed(pad, kbDelay), "kb" + name]);
    const typing = el => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    const onKey = e => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const down = e.type === "keydown";
      let used = false;
      for (const [map, pad, src] of maps) {
        const id = map[e.code];
        if (id === undefined) continue;
        pad.set(src, id, down ? (isAxis(id) ? K : 1) : 0);
        used = true;
      }
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const release = () => maps.forEach(([, pad, src]) => pad.clear(src));
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
      release();
    };
  }

  // ---------------------------------------------------------------- gamepads (standard mapping)
  const GP_BUTTONS = {
    retro: [0, 8, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7],
    n64:   [0, 22, 1, 21, 10, 11, 12, 12, 3, 3, -1, -1, 4, 5, 6, 7],
  };
  const DEAD = 0.18;
  // ---- learned layouts (instruments.js): per device id, which raw button / axis is which RetroPad id.
  // { kind, controls: [{ id, type: "button"|"axis", index, target, rest, analog }] }. Used instead of the
  // standard mapping for that device, so guitars / drum kits with odd layouts (PS3, Wii, Rock Band dongles) work.
  let mapsCache = null;
  const padMaps = () => { if (!mapsCache) { try { mapsCache = JSON.parse(localStorage.getItem("rh-padmaps") || "{}") || {}; } catch { mapsCache = {}; } } return mapsCache; };
  window.addEventListener("rh-padmaps", () => { mapsCache = null; });
  window.addEventListener("storage", e => { if (e.key === "rh-padmaps") mapsCache = null; });
  function readLearned(gp, map, v) {
    for (const c of map.controls || []) {
      if (!(c.id >= 0 && c.id < N)) continue;
      if (c.type === "button") {
        const b = gp.buttons[c.index]; if (!b) continue;
        const val = typeof b === "object" ? (b.pressed || b.value > 0.5) : b > 0.5;
        if (val) v[c.id] = isAxis(c.id) ? MAX : 1;
      } else {
        const a = gp.axes[c.index]; if (a === undefined) continue;
        const span = c.target - c.rest;
        if (!span) continue;
        const k = (a - c.rest) / span;                        // 0 at rest, 1 at the learned position
        if (c.analog) { if (k > 0.08) v[c.id] = Math.max(v[c.id], Math.round(Math.min(1, k) * MAX)); }
        else if (Math.abs(a - c.target) < Math.max(0.12, Math.abs(span) * 0.25)) v[c.id] = isAxis(c.id) ? MAX : 1;   // also D-pad "hats"
      }
    }
  }
  // padFor(gamepadOrder) -> Pad or null. gamepadOrder = 0 for the first connected gamepad, 1 for the next, ...
  // opts.lagFor(deviceKey) -> ms delay (lag equalization). Deadzones come from calibration, per device.
  function attachGamepads(system, padFor, opts = {}) {
    const sch = scheme(system), analog = ANALOG_SYSTEMS.has(system);
    const buttons = GP_BUTTONS[sch];
    let raf = 0, stopped = false;
    const used = new Map(); // gamepad.index -> Pad
    const wrapped = new Map(); // gamepad.index -> { pad, out }
    let cal = calibration();
    const onConn = () => { cal = calibration(); wrapped.clear(); };
    window.addEventListener("gamepadconnected", onConn);
    let lastTick = 0;
    const tick = () => {
      if (stopped) return;
      lastTick = performance.now();
      const list = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean);
      const seen = new Set();
      list.forEach((gp, order) => {
        const base = padFor(order);
        const src = "gp" + gp.index;
        seen.add(gp.index);
        if (!base) return;
        let w = wrapped.get(gp.index);
        if (!w || w.base !== base) wrapped.set(gp.index, w = { base, pad: delayed(base, opts.lagFor ? opts.lagFor(gp.id) : 0) });
        const pad = w.pad;
        used.set(gp.index, pad);
        const c = cal[gp.id] || {};
        const dead = Number.isFinite(c.deadzone) ? c.deadzone : DEAD;
        const tdead = Number.isFinite(c.triggerDeadzone) ? c.triggerDeadzone : 0;
        const v = new Array(N).fill(0);
        const learned = padMaps()[gp.id];
        if (learned) { readLearned(gp, learned, v); pad.setAll(src, v); return; }
        gp.buttons.forEach((b, i) => {
          const id = buttons[i];
          if (id === undefined || id < 0) return;
          let val;
          if (typeof b !== "object") val = b > 0.5 ? 1 : 0;
          else if (i === 6 || i === 7) val = b.value > Math.max(tdead, 0.5) || (b.pressed && b.value > tdead) ? 1 : 0;
          else val = b.pressed || b.value > 0.5 ? 1 : 0;
          if (val) v[id] = 1;
        });
        // Radial deadzone, rescaled so the stick still reaches full deflection.
        const radial = (ix, iy) => {
          const x = gp.axes[ix] || 0, y = gp.axes[iy] || 0, m = Math.hypot(x, y);
          if (m < dead) return [0, 0];
          const k = Math.min(1, (m - dead) / (1 - dead)) / m;
          return [x * k, y * k];
        };
        const stick = ([x, y], base) => {
          if (x > 0) v[base] = Math.max(v[base], x * MAX); else if (x < 0) v[base + 1] = Math.max(v[base + 1], -x * MAX);
          if (y > 0) v[base + 2] = Math.max(v[base + 2], y * MAX); else if (y < 0) v[base + 3] = Math.max(v[base + 3], -y * MAX);
        };
        const left = radial(0, 1);
        if (analog) stick(left, 16);
        else {
          // Consoles without analog sticks: the left stick drives the D-pad.
          if (left[0] > 0.5) v[7] = 1; if (left[0] < -0.5) v[6] = 1;
          if (left[1] > 0.5) v[5] = 1; if (left[1] < -0.5) v[4] = 1;
        }
        if (analog || sch === "n64") stick(radial(2, 3), 20);
        if (sch === "n64") for (let i = 20; i <= 23; i++) v[i] = v[i] > MAX * 0.5 ? MAX : 0;
        pad.setAll(src, v);
      });
      for (const [index, pad] of used) if (!seen.has(index)) { pad.clear("gp" + index); used.delete(index); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // rAF pauses in background tabs, and in a window that's covered even while the page still says "visible":
    // whenever frames stop arriving, keep polling every 50 ms so controllers keep working.
    const bg = setInterval(() => { if (document.hidden || performance.now() - lastTick > 120) { cancelAnimationFrame(raf); tick(); } }, 50);
    return () => { stopped = true; cancelAnimationFrame(raf); clearInterval(bg); window.removeEventListener("gamepadconnected", onConn); for (const [i, p] of used) p.clear("gp" + i); };
  }

  // ---------------------------------------------------------------- touch controller
  function el(cls, text, style) {
    const d = document.createElement("div");
    d.className = cls; if (text) d.textContent = text;
    if (style) Object.assign(d.style, style);
    return d;
  }
  function touchButton(root, pad, id, label, cls, style) {
    const b = el("tp tp-btn " + (cls || ""), label, style);
    const src = "touch" + id + "_" + Math.random().toString(36).slice(2, 6);
    const on = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add("on"); pad.set(src, id, isAxis(id) ? MAX : 1); };
    const off = e => { e.preventDefault(); b.classList.remove("on"); pad.set(src, id, 0); };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("lostpointercapture", off);
    b.addEventListener("contextmenu", e => e.preventDefault());
    root.appendChild(b);
    return b;
  }
  function touchStick(root, pad, ids, style) {
    const area = el("tp tp-stick", "", style);
    const knob = el("tp-knob");
    area.appendChild(knob);
    const R = 50;
    let pid = null, cx = 0, cy = 0;
    const apply = (dx, dy) => {
      const len = Math.hypot(dx, dy), k = len > R ? R / len : 1;
      dx *= k; dy *= k;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const x = dx / R, y = dy / R;
      pad.set("stick", ids.right, x > 0.08 ? x * MAX : 0);
      pad.set("stick", ids.left, x < -0.08 ? -x * MAX : 0);
      pad.set("stick", ids.down, y > 0.08 ? y * MAX : 0);
      pad.set("stick", ids.up, y < -0.08 ? -y * MAX : 0);
    };
    area.addEventListener("pointerdown", e => {
      e.preventDefault(); pid = e.pointerId; area.setPointerCapture?.(pid);
      const r = area.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      apply(e.clientX - cx, e.clientY - cy);
    });
    area.addEventListener("pointermove", e => { if (e.pointerId === pid) { e.preventDefault(); apply(e.clientX - cx, e.clientY - cy); } });
    const end = e => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ""; pad.clear("stick"); };
    area.addEventListener("pointerup", end);
    area.addEventListener("pointercancel", end);
    area.addEventListener("lostpointercapture", end);
    root.appendChild(area);
  }
  function touchDpad(root, pad, ids, style) {
    const d = el("tp tp-dpad", "", style);
    root.appendChild(d);
    const sub = { position: "absolute" };
    touchButton(d, pad, ids.up, "▲", "", { ...sub, left: "48px", top: "0" });
    touchButton(d, pad, ids.down, "▼", "", { ...sub, left: "48px", top: "96px" });
    touchButton(d, pad, ids.left, "◀", "", { ...sub, left: "0", top: "48px" });
    touchButton(d, pad, ids.right, "▶", "", { ...sub, left: "96px", top: "48px" });
  }
  function createTouch(container, system, pad) {
    const root = el("touchpad");
    const sch = scheme(system);
    if (sch === "n64") {
      touchStick(root, pad, { right: 16, left: 17, down: 18, up: 19 }, { left: "24px", bottom: "28px" });
      touchButton(root, pad, 12, "Z", "small", { left: "48px", bottom: "190px" });
      touchButton(root, pad, 10, "L", "pill", { left: "16px", top: "16px" });
      touchButton(root, pad, 11, "R", "pill", { right: "16px", top: "16px" });
      touchButton(root, pad, 0, "A", "", { right: "96px", bottom: "36px" });
      touchButton(root, pad, 1, "B", "", { right: "160px", bottom: "84px" });
      touchButton(root, pad, 23, "C▲", "c", { right: "60px", bottom: "190px" });
      touchButton(root, pad, 22, "C▼", "c", { right: "60px", bottom: "102px" });
      touchButton(root, pad, 21, "C◀", "c", { right: "104px", bottom: "146px" });
      touchButton(root, pad, 20, "C▶", "c", { right: "16px", bottom: "146px" });
      touchButton(root, pad, 3, "START", "pill", { left: "calc(50% - 35px)", bottom: "16px" });
    } else {
      touchDpad(root, pad, { up: 4, down: 5, left: 6, right: 7 }, { left: "20px", bottom: "36px" });
      if (ANALOG_SYSTEMS.has(system)) touchStick(root, pad, { right: 16, left: 17, down: 18, up: 19 }, { left: "24px", bottom: "200px", transform: "scale(.8)", transformOrigin: "left bottom" });
      touchButton(root, pad, 8, "A", "", { right: "20px", bottom: "90px" });
      touchButton(root, pad, 0, "B", "", { right: "84px", bottom: "36px" });
      touchButton(root, pad, 9, "X", "", { right: "84px", bottom: "144px" });
      touchButton(root, pad, 1, "Y", "", { right: "148px", bottom: "90px" });
      touchButton(root, pad, 10, "L", "pill", { left: "16px", top: "16px" });
      touchButton(root, pad, 11, "R", "pill", { right: "16px", top: "16px" });
      if (TRIGGER_SYSTEMS.has(system)) {
        touchButton(root, pad, 12, "L2", "pill", { left: "96px", top: "16px" });
        touchButton(root, pad, 13, "R2", "pill", { right: "96px", top: "16px" });
      }
      touchButton(root, pad, 2, "SELECT", "pill", { left: "calc(50% - 78px)", bottom: "16px" });
      touchButton(root, pad, 3, "START", "pill", { left: "calc(50% + 8px)", bottom: "16px" });
    }
    container.appendChild(root);
    return {
      root,
      show(on) { root.hidden = !on; if (!on) for (const k of [...pad.sources.keys()]) if (k.startsWith("touch") || k === "stick") pad.clear(k); },
      destroy() { root.remove(); },
    };
  }

  window.RH = Object.assign(window.RH || {}, {
    Input: { Pad, attachKeyboard, attachGamepads, createTouch, KEY_HELP, scheme, N, MAX, lagPlan, padMaps },
  });
})();
