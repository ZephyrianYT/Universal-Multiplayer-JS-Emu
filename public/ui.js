// Shared UI helpers: modal stack (Escape, focus trap, focus restore), 300 ms action guard for network
// buttons, toasts, persistent settings, and small sound effects.
(function () {
  "use strict";

  // ---------------------------------------------------------------- persistent settings
  const KEY = "rh-settings";
  const DEFAULTS = { volume: 1, voiceVolume: 1, filters: { hideFull: false, hideLocked: false, system: "", mode: "" },
    tab: "file", panels: {}, mutedKeys: [], equalizeLag: true, sfx: true, hostMode: "coop",
    stream: { preset: "auto" }, streamCap: 0, localSeats: [],
    ghost: { enabled: true, opacity: 0.6, tint: false, blend: "normal", colors: { 0: "#9dff5c", 1: "#00e5ff", 2: "#ff3df5", 3: "#ffe14d" },
      hidden: [], pip: {} } };
  let cache = null;
  const Settings = {
    all() {
      if (cache) return cache;
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch {}
      const g = saved.ghost || {};
      cache = { ...DEFAULTS, ...saved, filters: { ...DEFAULTS.filters, ...(saved.filters || {}) }, panels: { ...(saved.panels || {}) },
        ghost: { ...DEFAULTS.ghost, ...g, colors: { ...DEFAULTS.ghost.colors, ...(g.colors || {}) }, pip: { ...(g.pip || {}) } } };
      // v2: tint is opt-in (ghosts show in their real colors by default).
      if (saved.ghostRev !== 2) { cache.ghost.tint = false; cache.ghostRev = 2; try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} }
      return cache;
    },
    get(k) { return this.all()[k]; },
    set(k, v) { this.all()[k] = v; try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} },
    patch(k, obj) { this.set(k, { ...this.get(k), ...obj }); },
  };

  // ---------------------------------------------------------------- modal stack
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const stack = [];   // { el, restore, onClose }
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const focusables = el => [...el.querySelectorAll(FOCUSABLE)].filter(visible);

  const Modal = {
    // Opens a <dialog> (as modal) or any overlay element. onClose(reason) runs once when it closes.
    open(el, { onClose, focus } = {}) {
      if (stack.some(s => s.el === el)) return;
      const entry = { el, restore: document.activeElement, onClose };
      stack.push(entry);
      if (el.tagName === "DIALOG") { if (!el.open) el.showModal(); }
      else { el.hidden = false; el.setAttribute("role", el.getAttribute("role") || "dialog"); el.setAttribute("aria-modal", "true"); }
      if (el.tagName === "DIALOG" && !el.__rhBound) {
        el.__rhBound = true;
        el.addEventListener("cancel", e => { e.preventDefault(); Modal.close(el, "escape"); });   // native Escape
        el.addEventListener("close", () => Modal._closed(el, "form"));
      }
      requestAnimationFrame(() => {
        const target = (focus && el.querySelector(focus)) || el.querySelector("[autofocus]") || focusables(el)[0] || el;
        if (target === el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        target.focus?.();
      });
    },
    close(el, reason = "close") {
      if (!el) return;
      if (el.tagName === "DIALOG") { if (el.open) el.close(); Modal._closed(el, reason); }
      else { el.hidden = true; Modal._closed(el, reason); }
    },
    _closed(el, reason) {
      const i = stack.findIndex(s => s.el === el);
      if (i < 0) return;
      const [entry] = stack.splice(i, 1);
      try { entry.onClose?.(reason); } catch (e) { console.error(e); }
      const r = entry.restore;
      if (r && document.contains(r) && typeof r.focus === "function") r.focus();
    },
    top() { return stack[stack.length - 1]?.el || null; },
    isOpen(el) { return stack.some(s => s.el === el); },
  };
  // Escape closes the top overlay; Tab stays inside it.
  document.addEventListener("keydown", e => {
    const top = Modal.top(); if (!top) return;
    if (e.key === "Escape" && top.tagName !== "DIALOG") {
      if (top.dataset.noEscape) return;
      e.preventDefault(); e.stopPropagation(); Modal.close(top, "escape"); return;
    }
    if (e.key !== "Tab") return;
    const f = focusables(top);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  // ---------------------------------------------------------------- action guard (debounce + in-flight lock)
  // guard(button, async fn): ignores repeat clicks within 300 ms and while fn is running; shows a busy state.
  function guard(btn, fn, wait = 300) {
    let last = 0, busy = false;
    const run = async (...args) => {
      const now = performance.now();
      if (busy || now - last < wait) return;
      last = now; busy = true;
      btn?.setAttribute("aria-busy", "true");
      const wasDisabled = btn?.disabled;
      if (btn) btn.disabled = true;
      try { return await fn(...args); }
      finally {
        busy = false;
        btn?.removeAttribute("aria-busy");
        if (btn && !wasDisabled && btn.isConnected) setTimeout(() => { if (!busy) btn.disabled = btn.dataset.lockDisabled === "1"; }, Math.max(0, wait - (performance.now() - now)));
      }
    };
    return run;
  }
  // Plain trailing debounce for inputs (search, filters).
  const debounce = (fn, wait = 300) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; };

  // ---------------------------------------------------------------- toasts
  let toastBox = null;
  // action: { label, run } adds a button (e.g. Undo); clicking it runs the action and closes the toast.
  // Returns { close() } so the caller can dismiss it early.
  function toast(text, { kind = "", ms = 1800, action = null } = {}) {
    if (!toastBox) {
      toastBox = document.createElement("div");
      toastBox.className = "toasts"; toastBox.setAttribute("role", "status"); toastBox.setAttribute("aria-live", "polite");
      document.body.appendChild(toastBox);
    }
    const t = document.createElement("div");
    t.className = "toast " + kind;
    const msg = document.createElement("span"); msg.textContent = text; t.appendChild(msg);
    let timer = 0, closed = false;
    const close = () => {
      if (closed) return; closed = true; clearTimeout(timer);
      t.classList.remove("in"); setTimeout(() => t.remove(), 250);
    };
    if (action) {
      t.classList.add("has-action");
      const b = document.createElement("button");
      b.type = "button"; b.className = "small toast-act"; b.textContent = action.label;
      b.onclick = () => { close(); action.run(); };
      t.appendChild(b);
      // Keep it up while the pointer or keyboard focus is on it, so the button can't vanish mid-reach.
      const hold = () => clearTimeout(timer), resume = () => { if (!closed) timer = setTimeout(close, 1500); };
      t.addEventListener("pointerenter", hold); t.addEventListener("pointerleave", resume);
      b.addEventListener("focus", hold); b.addEventListener("blur", resume);
    }
    toastBox.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    timer = setTimeout(close, ms);
    return { close };
  }
  async function copy(text, label = "Copied!") {
    try { await navigator.clipboard.writeText(text); toast(label, { kind: "ok" }); return true; }
    catch {
      // Clipboard API needs a secure context (plain-HTTP LAN addresses): fall back to a hidden textarea.
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;left:-9999px"; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
      if (ok) toast(label, { kind: "ok" }); else prompt("Copy this:", text);
      return ok;
    }
  }

  // ---------------------------------------------------------------- sound effects (Web Audio, no files)
  let actx = null;
  const ctx = () => {
    try {
      if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.__rhNoTap = true; }   // UI sounds never go to guests
      if (actx.state === "suspended") actx.resume();
    } catch {}
    return actx;
  };
  function beep(freq = 880, ms = 90, { type = "sine", gain = 0.18, when = 0 } = {}) {
    if (!Settings.get("sfx")) return;
    const a = ctx(); if (!a) return;
    const t0 = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + ms / 1000 + 0.02);
  }
  const Sfx = {
    tick: () => beep(660, 80, { type: "square", gain: 0.08 }),
    go: () => { beep(988, 140, { type: "square", gain: 0.1 }); beep(1319, 220, { type: "square", gain: 0.08, when: 0.06 }); },
    chime: () => { beep(1047, 160); beep(1568, 260, { when: 0.05, gain: 0.12 }); },
    warn: () => beep(440, 120, { type: "triangle" }),
    miss: () => beep(180, 200, { type: "sawtooth", gain: 0.08 }),
    unlock: ctx,
  };

  // ---------------------------------------------------------------- latency helpers
  const pingClass = ms => ms == null ? "unk" : ms < 50 ? "good" : ms < 100 ? "mid" : "bad";
  const pingLabel = ms => ms == null ? "— ms" : `${Math.round(ms)} ms`;

  // ---------------------------------------------------------------- links that leave Retro Hub
  // Other sites (speedrun.com, RetroAchievements) get their own look: an "Offsite" tag with the site's name, a
  // dashed border and ↗, so nobody mistakes them for part of the hub. They open in a new tab with no referrer,
  // so the hub's address (maybe a private tunnel) is never passed on.
  const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeHref = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
  function offsite({ href, label, note = "", cls = "" }) {
    const url = safeHref(href), host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
    return `<a class="offsite ${escH(cls)}" href="${escH(url)}" target="_blank" rel="noopener noreferrer" title="Opens ${escH(host)} in a new tab. Not part of Retro Hub.">
      <span class="os-tag">Offsite · ${escH(host)}</span><span class="os-label">${escH(label)} <span aria-hidden="true">↗</span></span>${note ? `<span class="os-note">${escH(note)}</span>` : ""}</a>`;
  }
  // For a link whose address has to be looked up first: the tab opens inside the click (so pop-up blockers allow
  // it), then goes to the address once it's known, or to `fallback`.
  async function openOffsite(resolve, fallback) {
    const w = window.open("", "_blank");
    if (w) { try { w.opener = null; w.document.title = "Opening…"; } catch {} }
    let url = fallback;
    try { url = safeHref(await resolve()) || fallback; } catch {}
    if (w && !w.closed) w.location.replace(url); else window.open(url, "_blank", "noopener,noreferrer");
  }

  window.RH = Object.assign(window.RH || {}, { UI: { Settings, Modal, guard, debounce, toast, copy, Sfx, pingClass, pingLabel, offsite, openOffsite } });
})();
