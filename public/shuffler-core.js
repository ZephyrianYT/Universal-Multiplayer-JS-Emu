// Shuffle engine, shared by the solo Shuffler (shuffle.js) and Shuffle lobbies (app.js, host side).
// Every game runs in its own frame (shuffle-frame.html) with its own EmulatorJS core and is paused while it isn't
// its turn, so a swap is instant and keeps the game exactly where it was. Memory saver: big consoles (N64, PS1,
// DS, PSP…) are kept one at a time; another big game waiting its turn is saved (save state) and its frame closed,
// then booted again and restored when it comes back (a few seconds instead of instant).
(function () {
  "use strict";
  const HEAVY = new Set(["psx", "n64", "nds", "psp", "segaSaturn", "segaCD", "jaguar", "arcade", "ndsnative"]);
  const N = () => window.RH.Input.N;

  // opts: { stage, games: [{ name, system, url, saveName }], cores, min, max (seconds), volume, memorySaver,
  //         tapAudio (bool: mix the games' sound into one track: engine.audioTrack),
  //         onLoad(i, text), onSwap(game, index, prevIndex), onChange(), onWin(stats), onBusy(text|null) }
  function ShuffleEngine(opts) {
    const games = opts.games.map((g, i) => ({ ...g, i, frame: null, emu: null, beaten: false, played: 0, state: null, error: "" }));
    let cur = -1, timer = 0, swapAt = 0, hold = false, swaps = 0, startedAt = 0, activeSince = 0, busy = false, destroyed = false;
    const raw = new Map(), sent = new Map();      // slot -> buttons as pressed / as last sent to the active game
    const saver = !!opts.memorySaver && games.filter(g => HEAVY.has(g.system)).length >= 2;
    let mixCtx = null, mixDest = null;
    if (opts.tapAudio) {
      mixCtx = new AudioContext(); mixCtx.__rhNoTap = true;
      mixDest = mixCtx.createMediaStreamDestination();
      mixCtx.resume?.().catch(() => {});
    }

    // ---- frames
    function bootFrame(g, volume) {
      return new Promise((resolve, reject) => {
        const f = document.createElement("iframe");
        f.className = "sh-frame"; f.src = "/shuffle-frame.html"; f.title = g.name; f.tabIndex = -1;
        f.setAttribute("allow", "autoplay; gamepad; fullscreen");
        g.frame = f;
        opts.stage.appendChild(f);
        f.addEventListener("load", async () => {
          try {
            if (mixDest) tapFrameAudio(f.contentWindow);
            const emu = await f.contentWindow.startGame({ url: g.url, core: opts.cores?.[g.system] || g.system, name: g.saveName, volume });
            g.emu = emu;
            resolve(emu);
          } catch (e) { reject(e); }
        }, { once: true });
      });
    }
    // Copy of netplay.js tapPageAudio for a game frame: whatever the frame plays also goes into the mix.
    function tapFrameAudio(w) {
      const orig = w.AudioNode.prototype.connect;
      w.AudioNode.prototype.connect = function (dest, ...rest) {
        const r = orig.call(this, dest, ...rest);
        try {
          if (dest instanceof w.AudioDestinationNode && !this.context.__rhTap) {
            const ctx = this.context;
            ctx.__rhTap = ctx.createMediaStreamDestination();
            const t = ctx.__rhTap.stream.getAudioTracks()[0];
            if (t) mixCtx.createMediaStreamSource(new MediaStream([t])).connect(mixDest);
          }
          if (dest instanceof w.AudioDestinationNode) orig.call(this, this.context.__rhTap);
        } catch (e) { console.warn("shuffle audio", e); }
        return r;
      };
    }
    function closeFrame(g) { try { g.emu?.pause(); } catch {} g.frame?.remove(); g.frame = null; g.emu = null; }
    const loadedHeavy = () => games.filter(g => g.emu && HEAVY.has(g.system));

    async function boot() {
      for (const g of games) {
        if (destroyed) return;
        if (saver && HEAVY.has(g.system)) { opts.onLoad?.(g.i, "Loads on its turn (memory saver)"); continue; }
        opts.onLoad?.(g.i, "Starting…");
        try { const emu = await bootFrame(g, 0); try { emu.pause(); } catch {} opts.onLoad?.(g.i, "Ready"); }
        catch (e) { g.error = e.message || "Couldn't load."; g.beaten = true; opts.onLoad?.(g.i, "Failed: " + g.error); closeFrame(g); }
      }
    }

    // ---- input: per seat; the active game gets it, the old one is released at every swap
    function push(slot, v) {
      const gm = games[cur]?.emu?.gameManager; if (!gm) return;
      const last = sent.get(slot) || new Array(N()).fill(0);
      for (let i = 0; i < N(); i++) if (v[i] !== last[i]) { try { gm.simulateInput(slot, i, v[i]); } catch {} }
      sent.set(slot, v.slice());
    }
    function releaseAll() { for (const slot of sent.keys()) push(slot, new Array(N()).fill(0)); sent.clear(); }

    // ---- turns
    function pickNext() {
      const open = games.filter(g => !g.beaten).map(g => g.i);
      if (!open.length) return -1;
      const others = open.length > 1 ? open.filter(i => i !== cur) : open;
      return others[Math.floor(Math.random() * others.length)];
    }
    async function swapTo(i) {
      if (busy || destroyed) return;
      clearTimeout(timer);
      if (i < 0) return win();
      const prev = games[cur], next = games[i];
      if (i === cur) { schedule(); opts.onChange?.(); return; }
      busy = true;
      if (prev) {
        releaseAll();
        if (!prev.beaten) prev.played += Date.now() - activeSince;     // a beaten game was already counted
        try { prev.emu?.setVolume?.(0); prev.emu?.pause(); } catch {}
        prev.frame?.classList.remove("on");
      }
      // memory saver: make room for a big game by saving and closing the other big one
      if (saver && HEAVY.has(next.system) && !next.emu) {
        for (const h of loadedHeavy()) {
          if (h === next) continue;
          try { if (!h.beaten) h.state = h.emu.gameManager.getState(); } catch {}
          closeFrame(h);
        }
        opts.onBusy?.(`Loading ${next.name}…`);
        try {
          await bootFrame(next, opts.volume?.() ?? 0.5);
          if (next.state) { try { next.emu.gameManager.loadState(next.state); } catch {} next.state = null; }
        } catch (e) { next.error = e.message; next.beaten = true; closeFrame(next); opts.onBusy?.(null); busy = false; return swapTo(pickNext()); }
        opts.onBusy?.(null);
      }
      if (destroyed) return;
      const was = cur;
      cur = i; activeSince = Date.now();
      if (prev && !prev.beaten) swaps++;
      next.frame.classList.add("on");
      try { next.emu.setVolume?.(opts.volume?.() ?? 0.5); next.emu.play(); } catch {}
      for (const [slot, v] of raw) push(slot, v);             // buttons held through the swap still count
      busy = false;
      opts.onSwap?.(next, i, was);
      schedule();
      opts.onChange?.();
    }
    function schedule() {
      clearTimeout(timer); swapAt = 0;
      if (hold || games.filter(g => !g.beaten).length <= 1) return;      // the last game is played out
      const min = Math.max(5, Number(opts.min) || 15), max = Math.max(min, Number(opts.max) || 45);
      const ms = (min + Math.random() * (max - min)) * 1000;
      swapAt = Date.now() + ms;
      timer = setTimeout(() => swapTo(pickNext()), ms);
    }
    function markBeaten() {
      const g = games[cur]; if (!g || g.beaten || busy) return null;
      g.beaten = true; g.played += Date.now() - activeSince; activeSince = Date.now();
      const n = pickNext();
      if (n < 0) { win(); return g; }
      swapTo(n);
      return g;
    }
    function win() {
      clearTimeout(timer); swapAt = 0;
      releaseAll();
      try { games[cur]?.emu?.pause(); } catch {}
      opts.onWin?.(stats());
      opts.onChange?.();
    }
    const stats = () => ({ total: startedAt ? Date.now() - startedAt : 0, swaps,
      games: games.map(g => ({ name: g.name, system: g.system, beaten: g.beaten, error: g.error, played: g.played + (g.i === cur && !g.beaten ? Date.now() - activeSince : 0) })) });

    return {
      games, boot,
      start() { startedAt = Date.now(); return swapTo(pickNext()); },
      swapNow() { return swapTo(pickNext()); },
      markBeaten,
      setHold(on) { hold = !!on; schedule(); opts.onChange?.(); },
      get hold() { return hold; },
      setTimes(min, max) { opts.min = min; opts.max = max; },
      setVolume(v) { try { games[cur]?.emu?.setVolume?.(v); } catch {} },
      // seat input (RetroPad values); the host's own pads and guests' seats
      input(slot, v) { raw.set(slot, v.slice()); push(slot, v); },
      reapply() { for (const [slot, v] of raw) push(slot, v); },
      release(slot) { raw.delete(slot); push(slot, new Array(N()).fill(0)); },
      active: () => games[cur] || null,
      gm: () => games[cur]?.emu?.gameManager || null,
      canvas: () => games[cur]?.emu?.canvas || null,
      audioTrack: () => mixDest?.stream.getAudioTracks()[0] || null,
      state: () => ({ cur, swaps, hold, swapAt, startedAt, busy, left: games.filter(g => !g.beaten).length, saver }),
      stats,
      destroy() {
        destroyed = true; clearTimeout(timer);
        for (const g of games) closeFrame(g);
        try { mixCtx?.close(); } catch {}
      },
    };
  }
  window.RH = Object.assign(window.RH || {}, { ShuffleEngine, SHUFFLE_HEAVY: HEAVY });
})();
