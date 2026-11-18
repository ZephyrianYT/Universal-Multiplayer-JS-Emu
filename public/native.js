// Native emulators (PS2, GameCube, Wii, PS3, Xbox 360, Wii U), host side.
// The hub server launches the emulator on this computer; this page captures its window and hands the tracks to
// the normal netplay stream (HostNet), and forwards guests' controller state to the server's input bridge,
// which turns it into virtual gamepads. Only works for the owner, in a browser on the hub's own computer.
(function () {
  "use strict";
  const N = 24, FRAME = 2 + N * 2;
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "native" },
    body: JSON.stringify(body || {}), keepalive: true }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  });

  const status = () => fetch("/api/native", { cache: "no-store" }).then(r => r.json());
  const launch = (path, system, opts = {}) => post("/api/native/launch", { path, ...(system ? { system } : {}), headless: !!opts.headless,
    ...(opts.coop ? { coop: { hack: opts.coop.hack, variant: opts.coop.variant } } : {}),
    ...(opts.gba ? { gba: { players: opts.gba.players } } : {}) });
  const showWindow = show => post("/api/native/window", { show });
  const stop = () => post("/api/native/stop").catch(() => {});

  // Window capture. Must be called from a click. Audio: browsers only share system audio when a whole screen
  // (Chrome/Edge on Windows: tick "Share system audio") or a tab is picked, so a window share is video-only.
  // headless: keep focus on this page after the window is picked (Chrome / Edge 124+), since the emulator is off-screen.
  async function capture({ headless } = {}) {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This browser can't capture other windows. Use Chrome, Edge or Firefox.");
    let controller = null;
    if (headless && typeof window.CaptureController === "function") {
      controller = new CaptureController();
      try { controller.setFocusBehavior("no-focus-change"); } catch {}
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      ...(controller ? { controller } : {}),
      video: { frameRate: { ideal: 60, max: 60 }, displaySurface: "window", cursor: "never" },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, restrictOwnAudio: true },
      systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include", monitorTypeSurfaces: "include",
    });
    const v = stream.getVideoTracks()[0];
    try { v.contentHint = "motion"; } catch {}
    return stream;
  }

  // Guest controller state -> server -> virtual gamepads. slots: the online seats (in order) that get a pad.
  class Bridge {
    constructor(slots, { onState } = {}) {
      this.slots = slots.slice().sort((a, b) => a - b);
      this.onState = onState || (() => {});
      this.last = new Map();        // slot -> last values (re-sent after a reconnect)
      this.closed = false; this.ws = null; this.retry = 1000;
      this._connect();
    }
    _connect() {
      const ws = this.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/native-input?slots=${this.slots.join(",")}`);
      ws.binaryType = "arraybuffer";
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === "ready") { this.retry = 1000; this.onState("ready", m.backend); for (const [s, v] of this.last) this._send(s, v); }
      };
      ws.onclose = e => {
        if (this.closed) return;
        this.onState(e.code === 4000 ? "unavailable" : "retrying", e.reason || "");
        if (e.code === 4000) return;             // the bridge can't run (missing library / driver): don't hammer it
        setTimeout(() => { if (!this.closed) this._connect(); }, this.retry);
        this.retry = Math.min(this.retry * 2, 10000);
      };
    }
    _send(slot, values) {
      if (this.ws?.readyState !== 1) return;
      const buf = new ArrayBuffer(FRAME), dv = new DataView(buf);
      dv.setUint8(0, slot); dv.setUint8(1, 1);
      for (let i = 0; i < N; i++) dv.setUint16(2 + i * 2, Math.max(0, Math.min(32767, Math.round(Number(values[i]) || 0))), true);
      try { this.ws.send(buf); } catch {}
    }
    send(slot, values) {
      if (!this.slots.includes(slot)) return;
      this.last.set(slot, values.slice());
      this._send(slot, values);
    }
    release(slot) { this.send(slot, new Array(N).fill(0)); }
    close() { this.closed = true; try { this.ws?.close(); } catch {} }
  }

  window.RH = Object.assign(window.RH || {}, { Native: { status, launch, stop, capture, showWindow, Bridge } });
})();
