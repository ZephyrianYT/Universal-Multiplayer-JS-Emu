// Single-player Ghost Mode helpers.
// - crc32File(): fast chunked CRC32 of a local ROM file (works on plain-HTTP LAN addresses too, where
//   crypto.subtle is unavailable). Only the checksum is shared; the ROM never leaves the browser.
// - Compositor: draws other players' ghost videos over the local game, translucent (default 60%), tinted per
//   slot, aligned to the game picture (letterbox bars are detected and cropped), with pointer-events: none so
//   it never blocks the emulator's own controls. Ghosts are visual only: nothing feeds back into anyone's game.
(function () {
  "use strict";

  // ---------------------------------------------------------------- CRC32
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const CHUNK = 4 << 20;
  async function crc32File(blob, onProgress) {
    let crc = 0xFFFFFFFF;
    for (let off = 0; off < blob.size; off += CHUNK) {
      const buf = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
      for (let i = 0; i < buf.length; i++) crc = TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
      onProgress?.(Math.min(1, (off + buf.length) / blob.size));
    }
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }
  const sameRom = (a, b) => !!a && !!b && a.crc === b.crc && a.size === b.size;

  // ---------------------------------------------------------------- colors (per player slot)
  const PALETTE = [
    { hex: "#9dff5c", label: "Lime" }, { hex: "#00e5ff", label: "Cyan" }, { hex: "#ff3df5", label: "Magenta" },
    { hex: "#ffe14d", label: "Yellow" }, { hex: "#ff9a3d", label: "Orange" }, { hex: "", label: "No tint" },
  ];
  const DEFAULT_COLORS = { 0: "#9dff5c", 1: "#00e5ff", 2: "#ff3df5", 3: "#ffe14d" };   // P2 cyan, P3 magenta, P4 yellow
  const OPACITY_MAX = 0.8;

  // ---------------------------------------------------------------- letterbox detection
  // The captured canvas includes the sender's letterbox bars. The game picture is always centred, so we keep a
  // symmetric union of the non-black area seen so far (reset when the video size changes).
  const probe = document.createElement("canvas");
  probe.width = 96; probe.height = 72;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  function detectCrop(video, st) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    if (st.vw !== vw || st.vh !== vh) { st.vw = vw; st.vh = vh; st.x = 0.5; st.y = 0.5; }   // x/y = inset from each edge
    try { pctx.drawImage(video, 0, 0, probe.width, probe.height); } catch { return; }
    const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
    let minX = probe.width, maxX = -1, minY = probe.height, maxY = -1;
    for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) {
      const i = (y * probe.width + x) * 4;
      if (d[i] > 14 || d[i + 1] > 14 || d[i + 2] > 14) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return;
    const ix = Math.min(minX, probe.width - 1 - maxX) / probe.width, iy = Math.min(minY, probe.height - 1 - maxY) / probe.height;
    st.x = Math.min(st.x, ix); st.y = Math.min(st.y, iy);
  }
  // Content rectangle (in video pixels) of a ghost / base video; full frame until we have seen enough of it.
  function cropRect(video, st) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const x = st.x < 0.45 ? st.x : 0, y = st.y < 0.45 ? st.y : 0;
    // Bars only ever exist on one axis: snap the smaller inset to 0.
    const fx = x > y ? x : 0, fy = y > x ? y : 0;
    return { sx: fx * vw, sy: fy * vh, sw: vw * (1 - 2 * fx), sh: vh * (1 - 2 * fy) };
  }
  // Largest rectangle with the given aspect ratio centred in box.
  function fit(box, aspect) {
    if (!aspect || !isFinite(aspect)) return box;
    let w = box.w, h = w / aspect;
    if (h > box.h) { h = box.h; w = h * aspect; }
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  // ---------------------------------------------------------------- compositor
  class Compositor {
    constructor(stage) {
      this.stage = stage;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "ghost-layer";
      this.canvas.setAttribute("aria-hidden", "true");
      stage.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.ghosts = new Map();     // id -> { video, track, slot, name, crop, off }
      this.target = null;          // () => element the local game is drawn in (EJS canvas or a <video>)
      this.base = null;            // optional { video, crop } when the target is a video (spectators)
      this.opts = { enabled: true, opacity: 0.6, tint: false, blend: "normal", colors: { ...DEFAULT_COLORS }, hidden: [] };
      this.running = false; this.lastDraw = 0; this.lastProbe = 0;
      this._tick = this._tick.bind(this);
    }
    setTarget(fn) { this.target = fn; this._kick(); }
    setBase(video) { this.base = video ? { video, crop: {} } : null; this._kick(); }
    setOptions(o) {
      this.opts = { ...this.opts, ...o, colors: { ...this.opts.colors, ...(o.colors || {}) } };
      this.opts.opacity = Math.max(0, Math.min(OPACITY_MAX, Number(this.opts.opacity) || 0));
      this.canvas.style.mixBlendMode = this.opts.blend === "screen" ? "screen" : "normal";
      this._kick();
    }
    // track === null removes the ghost.
    set(id, track, { slot = 0, name = "" } = {}) {
      let g = this.ghosts.get(id);
      if (!track) { if (g) { g.video.srcObject = null; this.ghosts.delete(id); } this._kick(); return; }
      if (!g) {
        const video = document.createElement("video");
        video.muted = true; video.playsInline = true; video.autoplay = true;
        g = { video, track: null, slot, name, crop: {}, off: document.createElement("canvas") };
        this.ghosts.set(id, g);
      }
      g.slot = slot; g.name = name;
      if (g.track !== track) {
        g.track = track; g.crop = {};
        g.video.srcObject = new MediaStream([track]);
        g.video.play().catch(() => {});
      }
      this._kick();
    }
    has(id) { return this.ghosts.has(id); }
    list() { return [...this.ghosts.entries()].map(([id, g]) => ({ id, slot: g.slot, name: g.name, live: g.video.readyState >= 2 })); }
    destroy() { this.running = false; for (const id of [...this.ghosts.keys()]) this.set(id, null); this.canvas.remove(); }

    _kick() { if (!this.running) { this.running = true; requestAnimationFrame(this._tick); } }
    _tick(now) {
      if (!this.running) return;
      if (!this.ghosts.size) { this.running = false; this._clear(); return; }
      requestAnimationFrame(this._tick);
      if (now - this.lastDraw < 1000 / 30) return;   // ghosts arrive at ~20 fps; 30 Hz drawing is plenty
      this.lastDraw = now;
      if (now - this.lastProbe > 1000) {             // letterbox detection once a second
        this.lastProbe = now;
        for (const g of this.ghosts.values()) detectCrop(g.video, g.crop);
        if (this.base) detectCrop(this.base.video, this.base.crop);
      }
      this._draw();
    }
    _clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    // Where the local game picture is, in stage CSS pixels.
    _gameBox(aspectHint) {
      const el = this.target?.();
      const sr = this.stage.getBoundingClientRect();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const box = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
      if (!box.w || !box.h) return null;
      if (el.tagName === "VIDEO" && el.videoWidth) {
        const shown = fit(box, el.videoWidth / el.videoHeight);           // object-fit: contain
        if (this.base && this.base.video === el) {
          const c = cropRect(el, this.base.crop), k = shown.w / el.videoWidth;
          return { x: shown.x + c.sx * k, y: shown.y + c.sy * k, w: c.sw * k, h: c.sh * k };
        }
        return shown;
      }
      return fit(box, aspectHint);                                        // emulator canvas: centred, game aspect
    }
    _draw() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const sr = this.stage.getBoundingClientRect();
      const W = Math.round(sr.width * dpr), H = Math.round(sr.height * dpr);
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      if (!this.opts.enabled || this.opts.opacity <= 0) return;
      const hidden = new Set(this.opts.hidden);
      for (const g of [...this.ghosts.values()].sort((a, b) => a.slot - b.slot)) {
        const v = g.video;
        if (hidden.has(g.slot) || v.readyState < 2 || !v.videoWidth) continue;
        const c = cropRect(v, g.crop);
        const box = this._gameBox(c.sw / c.sh);
        if (!box) return;
        const dw = Math.max(1, Math.round(box.w * dpr)), dh = Math.max(1, Math.round(box.h * dpr));
        const off = g.off;
        if (off.width !== dw || off.height !== dh) { off.width = dw; off.height = dh; }
        const o = off.getContext("2d");
        o.globalCompositeOperation = "source-over"; o.globalAlpha = 1;
        o.drawImage(v, c.sx, c.sy, c.sw, c.sh, 0, 0, dw, dh);
        const color = this.opts.colors[g.slot];
        if (this.opts.tint && color) {
          // Desaturate, then multiply by the slot color: brightness is kept as a monochrome shade of the
          // player's color (white -> full tint), so overlapping ghosts stay distinguishable from the solid
          // local player. ("color" blend alone can't tint white or black pixels.)
          o.globalCompositeOperation = "saturation"; o.fillStyle = "#808080"; o.fillRect(0, 0, dw, dh);
          o.globalCompositeOperation = "multiply"; o.fillStyle = color; o.fillRect(0, 0, dw, dh);
          o.globalCompositeOperation = "source-over";
        }
        ctx.globalAlpha = this.opts.opacity;
        ctx.drawImage(off, Math.round(box.x * dpr), Math.round(box.y * dpr));
        ctx.globalAlpha = 1;
      }
    }
  }

  window.RH = Object.assign(window.RH || {}, { Ghost: { crc32File, sameRom, Compositor, PALETTE, DEFAULT_COLORS, OPACITY_MAX } });
})();
