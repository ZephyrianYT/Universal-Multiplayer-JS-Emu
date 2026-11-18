// 3-beat controller calibration wizard. Up to 4 controllers (keyboard + gamepads) calibrate at the same time:
// any input claims a free slot, a 3-2-1-GO lead-in sets the tempo, then players tap on 3 beats.
// Per device we store the average tap offset (ms, + = late) and auto-measured stick/trigger deadzones.
(function () {
  "use strict";
  const { UI } = window.RH;
  const STORE = "rh-calibration";
  const BPM = 110, PERIOD = 60000 / BPM;      // ~545 ms per beat
  const LEAD = 4;                              // 3, 2, 1, GO!
  const NEED = 3;                              // valid taps per slot
  const MAX_BEATS = 9;                         // 3 beats + room to recover from misses
  const CLAIM_MS = 1200;                       // claim window after the first controller joins
  const GREEN = 40, YELLOW = 150;              // ms windows
  const SLOTS = 4;

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { return {}; } };
  const save = data => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch {} };
  const deviceName = key => key === "keyboard" ? "Keyboard" : key.replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 40) || "Gamepad";
  const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function open({ onDone } = {}) {
    const hasSaved = Object.keys(load()).length > 0;
    const root = document.createElement("div");
    root.className = "calib"; root.hidden = true;
    root.setAttribute("aria-labelledby", "calib-title");
    root.innerHTML = `
      <div class="calib-panel">
        <div class="calib-head">
          <h2 id="calib-title">Controller calibration</h2>
          <span class="spacer"></span>
          <button type="button" class="ghost small" data-close aria-label="Close calibration">✕</button>
        </div>
        <p class="calib-status" aria-live="polite">Press any button on each controller (or any key) to claim a slot.</p>
        <div class="calib-big" aria-hidden="true"></div>
        <div class="calib-slots"></div>
        <div class="calib-foot">
          <span class="small muted">Tap when the ring lands on the target. Leave the sticks centred.</span>
          <span class="spacer"></span>
          <button type="button" class="hold-skip" data-skip><span class="fill"></span><span class="lbl">${hasSaved ? "Hold to skip (keep saved)" : "Hold to skip"}</span></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    const $ = s => root.querySelector(s);
    const status = $(".calib-status"), big = $(".calib-big"), slotsBox = $(".calib-slots");

    const slots = [];
    for (let i = 0; i < SLOTS; i++) {
      const el = document.createElement("div");
      el.className = "cslot";
      el.innerHTML = `<div class="cslot-top"><b>P${i + 1}</b><span class="dev">Press any button</span></div>
        <div class="ringbox"><div class="target"></div><div class="ring"></div><div class="delta" hidden></div></div>
        <div class="pips">${'<i></i>'.repeat(NEED)}</div>`;
      slotsBox.appendChild(el);
      slots.push({ el, ring: el.querySelector(".ring"), delta: el.querySelector(".delta"), pips: el.querySelectorAll(".pips i"),
        dev: el.querySelector(".dev"), key: null, taps: [], lastBeat: -1, done: false, samples: { stick: [], rstick: [], trig: [] } });
    }

    // ---- state
    let phase = "claim";          // claim -> lead -> beats -> done
    let t0 = 0;                   // performance.now() of the first lead-in beat
    let claimTimer = 0, raf = 0, closed = false;
    const prevButtons = new Map();  // gamepad index -> pressed[]
    const slotFor = key => slots.find(s => s.key === key);

    function claim(key) {
      if (slotFor(key) || phase === "done") return slotFor(key);
      const s = slots.find(x => !x.key); if (!s) return null;
      s.key = key; s.el.classList.add("claimed");
      s.dev.textContent = deviceName(key); s.dev.title = key;
      UI.Sfx.tick();
      if (phase === "claim") {
        status.textContent = "Get ready…";
        clearTimeout(claimTimer); claimTimer = setTimeout(startLead, CLAIM_MS);
      } else if (phase === "beats") {
        s.lastBeat = beatIndex(performance.now()) - 1;   // late joiners start from the next beat
      }
      return s;
    }
    function startLead() {
      if (phase !== "claim") return;
      phase = "lead"; t0 = performance.now() + 150;
      status.textContent = "Tap on each beat after GO!";
    }
    const beatTime = k => t0 + (LEAD + k) * PERIOD;     // k = 0.. active beats
    const beatIndex = now => Math.round((now - t0) / PERIOD) - LEAD;

    function tap(key, when) {
      const s = claim(key);
      if (!s || s.done || phase !== "beats") return;
      const k = beatIndex(when);
      if (k < 0 || k <= s.lastBeat || k >= MAX_BEATS) return;
      const d = when - beatTime(k);
      s.lastBeat = k;
      const a = Math.abs(d);
      if (a <= YELLOW) {
        s.taps.push(d);
        flash(s, a <= GREEN ? "good" : "ok", a <= GREEN ? "" : `${d > 0 ? "+" : "−"}${Math.round(a)} ms`);
        if (a <= GREEN) UI.Sfx.chime(); else UI.Sfx.tick();
        if (s.taps.length >= NEED) { s.done = true; s.el.classList.add("done"); }
      } else miss(s);
      renderPips(s);
      maybeFinish();
    }
    function miss(s) {
      s.taps = [];
      flash(s, "miss", "Miss");
      s.el.classList.remove("shake"); void s.el.offsetWidth; s.el.classList.add("shake");
      UI.Sfx.miss();
    }
    function flash(s, cls, text) {
      s.el.classList.remove("good", "ok", "miss"); void s.el.offsetWidth; s.el.classList.add(cls);
      s.delta.textContent = text; s.delta.hidden = !text;
      clearTimeout(s.ft); s.ft = setTimeout(() => s.el.classList.remove("good", "ok", "miss"), 380);
    }
    function renderPips(s) { s.pips.forEach((p, i) => p.classList.toggle("on", i < s.taps.length)); }

    function maybeFinish(now = performance.now()) {
      const active = slots.filter(s => s.key);
      if (!active.length) return;
      const allDone = active.every(s => s.done);
      const out = beatIndex(now - YELLOW) >= MAX_BEATS - 1 && now > beatTime(MAX_BEATS - 1) + YELLOW;
      if (allDone || out) finish();
    }

    // ---- finish: compute and store results, then auto-advance
    function finish() {
      if (phase === "done") return;
      phase = "done";
      const data = load(), results = [];
      for (const s of slots) {
        if (!s.key) continue;
        const prev = data[s.key] || {};
        const r = { ...prev, at: Date.now() };
        if (s.done) r.offsetMs = Math.round(s.taps.reduce((a, b) => a + b, 0) / s.taps.length);
        if (s.key !== "keyboard") {
          const st = s.samples.stick.concat(s.samples.rstick);
          // Sticks should be at rest while tapping; a high reading means the player moved them, so keep the old value.
          const p = pct(st, 0.9);
          if (st.length > 20 && p < 0.45) r.deadzone = +clamp(p * 1.25 + 0.04, 0.05, 0.3).toFixed(3);
          const tr = pct(s.samples.trig, 0.9);
          if (s.samples.trig.length > 20 && tr < 0.5) r.triggerDeadzone = +clamp(tr + 0.05, 0.05, 0.4).toFixed(3);
        }
        data[s.key] = r;
        results.push({ slot: s, key: s.key, ...r, ok: s.done });
        s.dev.textContent = deviceName(s.key);
        s.delta.hidden = false;
        s.delta.textContent = s.done ? `${r.offsetMs >= 0 ? "+" : "−"}${Math.abs(r.offsetMs)} ms` : "Not calibrated";
        s.el.classList.toggle("done", s.done);
      }
      save(data);
      big.textContent = results.some(r => r.ok) ? "✓" : "";
      status.textContent = results.length ? `Saved for ${results.filter(r => r.ok).length} of ${results.length} controller(s). Continuing…` : "Nothing to calibrate.";
      setTimeout(() => close("done", results), results.length ? 1600 : 600);
    }

    // ---- input: keyboard
    const onKey = e => {
      if (e.repeat || e.key === "Escape" || e.key === "Tab") return;
      if (e.target.closest?.("[data-skip],[data-close]") && (e.key === " " || e.key === "Enter")) return;
      e.preventDefault(); e.stopPropagation();
      tap("keyboard", e.timeStamp || performance.now());
    };
    window.addEventListener("keydown", onKey, true);

    // ---- loop: gamepads, rings, lead-in, timeouts
    function loop() {
      if (closed) return;
      const now = performance.now();
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      for (const gp of pads) {
        const key = gp.id || "Gamepad " + gp.index;
        const prev = prevButtons.get(gp.index) || [];
        const cur = gp.buttons.map(b => typeof b === "object" ? b.pressed : b > 0.5);
        const ts = gp.timestamp && Math.abs(now - gp.timestamp) < 200 ? gp.timestamp : now;
        cur.forEach((p, i) => { if (p && !prev[i]) tap(key, ts); });
        prevButtons.set(gp.index, cur);
        const s = slotFor(key);
        if (s && phase !== "claim" && phase !== "done") {
          // silent deadzone sampling while the player is tapping
          s.samples.stick.push(Math.hypot(gp.axes[0] || 0, gp.axes[1] || 0));
          if (gp.axes.length >= 4) s.samples.rstick.push(Math.hypot(gp.axes[2] || 0, gp.axes[3] || 0));
          for (const i of [6, 7]) { const b = gp.buttons[i]; if (b && typeof b === "object") s.samples.trig.push(b.value); }
        }
      }
      if (phase === "lead" || phase === "beats") {
        const n = Math.floor((now - t0) / PERIOD);       // beat number from lead start
        if (n !== loop.lastN && n >= 0) {
          loop.lastN = n;
          if (n < LEAD) { big.textContent = ["3", "2", "1", "GO!"][n]; big.className = "calib-big pop" + (n === 3 ? " go" : ""); n === 3 ? UI.Sfx.go() : UI.Sfx.tick(); }
          else { big.textContent = ""; }
          if (n === LEAD - 1) phase = "beats";
        }
        // A beat that passed without a tap counts as a miss for slots that are still going.
        if (phase === "beats") {
          const kPassed = Math.floor((now - t0 - YELLOW) / PERIOD) - LEAD;
          for (const s of slots) if (s.key && !s.done && kPassed > s.lastBeat && kPassed >= 0 && kPassed < MAX_BEATS) {
            s.lastBeat = kPassed; miss(s); renderPips(s);
          }
          maybeFinish(now);
        }
        // Shrinking rings: from 3x down to the target at each beat.
        for (const s of slots) {
          if (!s.key || s.done) { s.ring.style.opacity = s.done ? "0" : ".25"; s.ring.style.transform = "scale(1)"; continue; }
          const k = Math.ceil((now - t0) / PERIOD - 1e-6) - LEAD;
          if (k < 0) { s.ring.style.opacity = ".25"; s.ring.style.transform = "scale(3)"; continue; }
          const until = beatTime(k) - now;
          s.ring.style.opacity = "1";
          s.ring.style.transform = `scale(${1 + 2 * clamp(until / PERIOD, 0, 1)})`;
        }
      }
      raf = requestAnimationFrame(loop);
    }

    // ---- hold to skip
    const skip = $("[data-skip]");
    let holdStart = 0, holdRaf = 0;
    const HOLD = 800;
    const holdTick = () => {
      const p = clamp((performance.now() - holdStart) / HOLD, 0, 1);
      skip.style.setProperty("--p", p);
      if (p >= 1) return close("skip", []);
      holdRaf = requestAnimationFrame(holdTick);
    };
    const holdOn = e => { if (holdStart) return; e.preventDefault(); holdStart = performance.now(); holdRaf = requestAnimationFrame(holdTick); };
    const holdOff = () => { holdStart = 0; cancelAnimationFrame(holdRaf); skip.style.setProperty("--p", 0); };
    skip.addEventListener("pointerdown", holdOn);
    skip.addEventListener("pointerup", holdOff); skip.addEventListener("pointerleave", holdOff); skip.addEventListener("pointercancel", holdOff);
    skip.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") holdOn(e); });
    skip.addEventListener("keyup", holdOff);
    skip.addEventListener("click", e => e.preventDefault());
    $("[data-close]").addEventListener("click", () => close("cancel", []));

    function close(reason, results) {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf); cancelAnimationFrame(holdRaf); clearTimeout(claimTimer);
      window.removeEventListener("keydown", onKey, true);
      if (UI.Modal.isOpen(root)) UI.Modal.close(root, reason);
      root.remove();
      onDone?.({ reason, results: results || [] });
    }

    UI.Sfx.unlock();
    UI.Modal.open(root, { focus: "[data-skip]", onClose: reason => { if (!closed) close(reason === "escape" ? "cancel" : reason, []); } });
    raf = requestAnimationFrame(loop);
    return { close: () => close("cancel", []) };
  }

  window.RH = Object.assign(window.RH || {}, { Calibrate: { open, load, deviceName } });
})();
