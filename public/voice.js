// Voice chat helpers: microphone capture, per-player playback with local mute, and level meters.
// Transport lives in netplay.js (voice rides pre-negotiated audio transceivers relayed by the host).
(function () {
  "use strict";
  const { UI } = window.RH;
  let actx = null;
  const ctx = () => { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume().catch(() => {}); return actx; };

  // Measures a track's level (0..1). Never connected to the speakers, so the host's game-audio tap ignores it.
  function meter(track) {
    const a = ctx();
    const src = a.createMediaStreamSource(new MediaStream([track]));
    const an = a.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.6;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    return {
      level() { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.min(1, Math.sqrt(s / buf.length) * 4); },
      stop() { try { src.disconnect(); } catch {} },
    };
  }

  class Voice {
    constructor() {
      this.mic = null;            // local MediaStreamTrack
      this.micMeter = null;
      this.remote = new Map();    // playerKey -> { audio, meter, track }
      this.listeners = new Set();
      this.muted = new Set(UI.Settings.get("mutedKeys") || []);
      this.volume = UI.Settings.get("voiceVolume") ?? 1;
    }
    async enable() {
      if (this.mic) return this.mic;
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.mic = s.getAudioTracks()[0];
      this.micMeter = meter(this.mic);
      this._emit();
      return this.mic;
    }
    disable() {
      this.mic?.stop(); this.micMeter?.stop();
      this.mic = null; this.micMeter = null;
      this._emit();
    }
    // Attach (or replace) the incoming voice track for a player.
    setRemote(key, track) {
      const cur = this.remote.get(key);
      if (cur && cur.track === track) return;
      this.dropRemote(key);
      if (!track) return;
      const audio = new Audio();
      audio.autoplay = true; audio.srcObject = new MediaStream([track]);
      audio.muted = this.muted.has(key); audio.volume = this.volume;
      audio.play().catch(() => {});
      this.remote.set(key, { audio, track, meter: meter(track) });
    }
    dropRemote(key) {
      const r = this.remote.get(key); if (!r) return;
      r.audio.srcObject = null; r.meter.stop(); this.remote.delete(key);
    }
    toggleMute(key) {
      if (this.muted.has(key)) this.muted.delete(key); else this.muted.add(key);
      UI.Settings.set("mutedKeys", [...this.muted]);
      const r = this.remote.get(key); if (r) r.audio.muted = this.muted.has(key);
      this._emit();
      return this.muted.has(key);
    }
    setVolume(v) {
      this.volume = v; UI.Settings.set("voiceVolume", v);
      for (const r of this.remote.values()) r.audio.volume = v;
    }
    level(key, isMe) {
      if (isMe) return this.micMeter ? this.micMeter.level() : 0;
      const r = this.remote.get(key);
      return r && !r.audio.muted ? r.meter.level() : 0;
    }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit() { this.listeners.forEach(fn => { try { fn(); } catch {} }); }
    close() { this.disable(); for (const k of [...this.remote.keys()]) this.dropRemote(k); }
  }

  // Animates every .vu[data-key] element from the voice levels (one rAF loop for the whole page).
  function animateMeters(voice, meKey) {
    let raf = 0;
    const loop = () => {
      document.querySelectorAll(".vu[data-key]").forEach(el => {
        const k = el.dataset.key, lv = voice.level(k, k === meKey);
        el.style.setProperty("--lv", lv.toFixed(3));
        el.classList.toggle("talking", lv > 0.08);
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }

  window.RH = Object.assign(window.RH || {}, { Voice: { Voice, animateMeters } });
})();
