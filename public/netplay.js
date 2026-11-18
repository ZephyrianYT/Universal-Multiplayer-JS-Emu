// WebRTC netplay. The host's browser runs the game and streams video + audio to every guest;
// guests send their controller state back over a data channel. Signaling goes through the hub's /ws.
//
// Voice chat rides VOICE_SLOTS audio transceivers that are negotiated with every connection up front, so a
// mic can be switched on or off with replaceTrack() and no renegotiation. Slot 0 carries the guest's mic up
// and the host's mic down; slots 1.. carry the other guests' voices, relayed by the host. A reliable "ctl"
// data channel tells each guest which player is on which slot.
//
// Ghost mode (every player runs their own ROM) uses the same trick for video: GHOST_SLOTS video transceivers.
// Slot 0 carries the guest's own ghost up and the host's ghost down; slots 1.. carry the other players' ghosts,
// relayed by the host. Ghost video is low-rate (about 20 fps, ~500 kbps, max 640 px) so it never competes with
// anyone's local game.
(function () {
  "use strict";
  const VOICE_SLOTS = 6;
  const GHOST_SLOTS = 4;
  const GHOST_FPS = 20, GHOST_BITRATE = 500_000, GHOST_MAX_PX = 640;
  // Encoder limits for a ghost sender (only possible once the connection has negotiated its encodings).
  function tuneGhost(sender) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) return;
      const st = sender.track?.getSettings?.() || {};
      const big = Math.max(st.width || 0, st.height || 0);
      // "balanced": under pressure give up some framerate as well as resolution, so a ghost shown in a
      // picture-in-picture window stays readable.
      params.degradationPreference = "balanced";
      params.encodings[0].maxBitrate = GHOST_BITRATE;
      params.encodings[0].maxFramerate = GHOST_FPS;
      params.encodings[0].scaleResolutionDownBy = big > GHOST_MAX_PX ? big / GHOST_MAX_PX : 1;
      sender.setParameters(params).catch(() => {});
    } catch {}
  }

  // ---- game stream quality (co-op host -> guests), changed live with setParameters (no renegotiation)
  const QUALITY_DEFAULT = { maxKbps: 6000, fps: 60, maxHeight: 0, prefer: "smooth", audioKbps: 96, codec: "auto" };
  // Video codec preference for the game stream. Only the order changes: every codec stays in the offer, so a guest
  // whose browser can't decode the preferred one falls back to the next codec both sides support.
  const CODEC_MIME = { h264: "video/h264", vp9: "video/vp9", av1: "video/av1", vp8: "video/vp8" };
  const videoCaps = () => { try { return RTCRtpSender.getCapabilities?.("video")?.codecs || []; } catch { return []; } };
  const supportedVideoCodecs = () => Object.keys(CODEC_MIME).filter(k => videoCaps().some(c => c.mimeType.toLowerCase() === CODEC_MIME[k]));
  function setCodecPref(tx, pref) {
    if (!tx || typeof tx.setCodecPreferences !== "function") return false;
    try {
      if (!CODEC_MIME[pref]) { tx.setCodecPreferences([]); return true; }          // auto: the browser's own order
      let caps = []; try { caps = RTCRtpReceiver.getCapabilities?.("video")?.codecs || []; } catch {}
      if (!caps.length) caps = videoCaps();
      const want = caps.filter(c => c.mimeType.toLowerCase() === CODEC_MIME[pref]);
      if (!want.length) return false;
      tx.setCodecPreferences([...want, ...caps.filter(c => !want.includes(c))]);
      return true;
    } catch { return false; }
  }
  const PREFER = { smooth: "maintain-framerate", sharp: "maintain-resolution", balanced: "balanced" };
  function cleanQuality(q) {
    const n = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
    q = q || {};
    return { maxKbps: n(q.maxKbps, 300, 30000, QUALITY_DEFAULT.maxKbps), fps: [24, 30, 60].includes(Number(q.fps)) ? Number(q.fps) : 60,
      maxHeight: [0, 360, 480, 720, 1080].includes(Number(q.maxHeight)) ? Number(q.maxHeight) : 0,
      prefer: PREFER[q.prefer] ? q.prefer : "smooth", audioKbps: n(q.audioKbps, 32, 256, QUALITY_DEFAULT.audioKbps),
      codec: CODEC_MIME[q.codec] ? q.codec : "auto" };
  }
  // Applies encoder limits to one sender, skipping it when nothing changed. Firefox doesn't know
  // degradationPreference, so a rejected call is retried without it.
  function applyEncoding(sender, enc, pref) {
    const key = JSON.stringify([enc, pref]);
    if (sender.__rhKey === key) return;
    sender.__rhKey = key;
    const set = withPref => {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) { sender.__rhKey = null; return Promise.resolve(); }
      Object.assign(params.encodings[0], enc);
      if (withPref && pref) params.degradationPreference = pref; else delete params.degradationPreference;
      return sender.setParameters(params);
    };
    set(true).catch(() => set(false).catch(() => { sender.__rhKey = null; }));
  }
  // Opus is mono in WebRTC unless the receiver asks for stereo in its answer. Game audio is stereo.
  function stereoOpus(sdp) {
    const opus = new Set([...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000\/2/gi)].map(m => m[1]));
    return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt, params) =>
      opus.has(pt) && !/stereo=1/.test(params) ? `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1` : line);
  }
  // One stats sample -> rates since the previous sample of the same report (kept on `memo`).
  function rate(memo, key, bytes, ts) {
    const prev = memo[key]; memo[key] = { bytes, ts };
    return prev && ts > prev.ts && bytes >= prev.bytes ? Math.round((bytes - prev.bytes) * 8 / (ts - prev.ts)) : null;   // kbps (ts in ms)
  }
  function pairInfo(report) {
    let pair = null; const cands = {};
    report.forEach(s => {
      if (s.type === "candidate-pair" && (s.nominated || s.selected) && s.state === "succeeded") pair = s;
      if (s.type === "local-candidate" || s.type === "remote-candidate") cands[s.id] = s;
    });
    if (!pair) return {};
    const local = cands[pair.localCandidateId], remote = cands[pair.remoteCandidateId];
    return { rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
      availKbps: pair.availableOutgoingBitrate ? Math.round(pair.availableOutgoingBitrate / 1000) : null,
      relay: local?.candidateType === "relay" || remote?.candidateType === "relay" };
  }
  const codecName = (report, id) => { const c = id && report.get(id); return c ? String(c.mimeType || "").split("/")[1] || null : null; };

  // ---- untrusted peer data
  // Everything a peer sends is treated as hostile. Controller input is a fixed-size binary frame
  // (no JSON, no dynamic objects): [u8 opcode=1][u8 version=1][u16 0][u32 seq][24 x u16 button/axis 0..32767].
  // Text messages (pings, maps) are size-capped before JSON.parse and checked field by field.
  const OP_INPUT = 1, INPUT_VER = 1, INPUT_N = 24, INPUT_BYTES = 8 + INPUT_N * 2;
  const MAX_TEXT = 4096;              // longest text message accepted on any channel
  const RATE_MAX = 600;               // messages per second per channel before excess is dropped (normal: under 150)
  const BAD_MAX = 20;                 // malformed messages per second before it counts as a strike
  const STRIKES_MAX = 5;              // strikes within 30 s -> the peer is cut off
  // Save-state sharing (co-op host -> guests) on a third, reliable "state" channel:
  // {t:"begin", id, size} text, then binary chunks of up to STATE_CHUNK bytes, then {t:"end", id}.
  const STATE_CHUNK = 64 * 1024, STATE_MAX = 64 << 20;
  // Sends bytes over a reliable channel in chunks, waiting whenever the send buffer is full.
  async function sendChunked(ch, bytes, id) {
    const drain = () => new Promise(res => {
      if (ch.bufferedAmount < 1 << 20) return res();
      ch.bufferedAmountLowThreshold = 256 * 1024;
      const done = () => { ch.removeEventListener("bufferedamountlow", done); ch.removeEventListener("close", done); res(); };
      ch.addEventListener("bufferedamountlow", done); ch.addEventListener("close", done);
    });
    ch.send(JSON.stringify({ t: "begin", id, size: bytes.length }));
    for (let o = 0; o < bytes.length; o += STATE_CHUNK) {
      if (ch.readyState !== "open") throw new Error("closed");
      await drain();
      ch.send(bytes.slice(o, o + STATE_CHUNK));
    }
    ch.send(JSON.stringify({ t: "end", id }));
  }
  // Receives one transfer at a time; size-capped, and the byte count must match exactly.
  function stateReceiver(onDone) {
    let cur = null;
    return e => {
      if (typeof e.data === "string") {
        const m = parseText(e.data); if (!m) return;
        if (m.t === "begin" && Number.isSafeInteger(m.size) && m.size > 0 && m.size <= STATE_MAX) cur = { id: m.id, buf: new Uint8Array(m.size), n: 0 };
        else if (m.t === "end" && cur && m.id === cur.id) { const c = cur; cur = null; if (c.n === c.buf.length) onDone(c.buf); }
        return;
      }
      if (!cur || !(e.data instanceof ArrayBuffer)) return;
      const b = new Uint8Array(e.data);
      if (b.length > STATE_CHUNK || cur.n + b.length > cur.buf.length) { cur = null; return; }
      cur.buf.set(b, cur.n); cur.n += b.length;
    };
  }
  function encodeInput(seq, values) {
    const buf = new ArrayBuffer(INPUT_BYTES), dv = new DataView(buf);
    dv.setUint8(0, OP_INPUT); dv.setUint8(1, INPUT_VER); dv.setUint32(4, seq >>> 0, true);
    for (let i = 0; i < INPUT_N; i++) dv.setUint16(8 + i * 2, Math.max(0, Math.min(32767, Math.round(Number(values[i]) || 0))), true);
    return buf;
  }
  function decodeInput(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength !== INPUT_BYTES) return null;
    const dv = new DataView(buf);
    if (dv.getUint8(0) !== OP_INPUT || dv.getUint8(1) !== INPUT_VER || dv.getUint16(2, true) !== 0) return null;
    const v = new Array(INPUT_N);
    for (let i = 0; i < INPUT_N; i++) v[i] = Math.min(32767, dv.getUint16(8 + i * 2, true));
    return { seq: dv.getUint32(4, true), v };
  }
  // Size-capped JSON for text frames; anything else (binary, huge, not an object) is null.
  function parseText(data) {
    if (typeof data !== "string" || data.length > MAX_TEXT) return null;
    try { const m = JSON.parse(data); return m && typeof m === "object" && !Array.isArray(m) && typeof m.t === "string" ? m : null; } catch { return null; }
  }
  // Per-peer flood / garbage meter. ok() says whether to process this message; bad() records a malformed one.
  // onCut fires once when the peer has misbehaved too often.
  class PeerGuard {
    constructor(onCut) { this.onCut = onCut; this.win = 0; this.n = 0; this.badN = 0; this.strikes = []; this.cut = false; }
    _tick() {
      const now = performance.now();
      if (now - this.win >= 1000) { this.win = now; this.n = 0; this.badN = 0; }
      return now;
    }
    _strike(now) {
      this.strikes = this.strikes.filter(t => now - t < 30000); this.strikes.push(now);
      if (this.strikes.length >= STRIKES_MAX && !this.cut) { this.cut = true; this.onCut(); }
    }
    ok() {
      if (this.cut) return false;
      const now = this._tick();
      if (++this.n === RATE_MAX + 1) this._strike(now);
      return this.n <= RATE_MAX;
    }
    bad() { const now = this._tick(); if (++this.badN === BAD_MAX + 1) this._strike(now); }
  }
  const isId = x => Number.isSafeInteger(x) && x > 0;
  // { slot: playerId|null } maps from the host: integer slots in range, integer ids only.
  function cleanMap(map, slots) {
    const out = {};
    if (!map || typeof map !== "object" || Array.isArray(map)) return out;
    for (const [k, v] of Object.entries(map)) {
      const s = Number(k);
      if (Number.isInteger(s) && s >= 0 && s < slots && (v === null || isId(v))) out[s] = v;
    }
    return out;
  }

  // Host side: one RTCPeerConnection per guest. The host always makes the offers, so renegotiation
  // (e.g. the game's audio appearing a moment after the video) never collides.
  class HostNet {
    constructor({ iceServers, sendSignal, onInput, onState, onVoice, onCtl, onGhost, onAbuse }) {
      this.ice = iceServers; this.sendSignal = sendSignal;
      this.onInput = onInput; this.onState = onState || (() => {});
      this.onVoice = onVoice || (() => {});     // (guestId, track|null): a guest's mic for the host to hear
      this.onCtl = onCtl || (() => {});
      this.onAbuse = onAbuse || (() => {});     // (guestId): cut off for flooding / malformed data
      this.blocked = new Set();
      this.peers = new Map();      // guestId -> { pc, dc, ctl, seq, pending: [], voice: [transceivers], map }
      this.tracks = [];            // [track, stream]
      this.stream = new MediaStream();
      this.ready = false;
      this.wanted = new Set();     // guests in the roster
      this.hostMic = null; this.hostId = null;
      this.voiceOn = new Set();    // guest ids whose mic is on
      this.onGhost = onGhost || (() => {});     // (guestId, track|null): a guest's ghost video for the host
      this.hostGhost = null;
      this.ghostOn = new Set();    // guest ids sending a ghost
      this.side = new Map();       // guest id -> its own side-screen track (GBA screens mode: that player's GBA only)
      this.quality = { ...QUALITY_DEFAULT };
    }
    // Host's stream settings for everyone; each guest may also ask for a lower bitrate cap for themselves.
    setQuality(q) {
      const prevCodec = this.quality.codec;
      this.quality = cleanQuality(q);
      for (const p of this.peers.values()) {
        const txs = this.quality.codec !== prevCodec ? this._gameVideoTx(p.pc) : [];
        if (txs.length) {                                             // no game video yet (lobby): applied when it's added
          for (const tx of txs) setCodecPref(tx, this.quality.codec);
          for (const sn of p.pc.getSenders()) sn.__rhKey = null;     // re-apply encoder limits after the new negotiation
          p.offer?.();                                                // a codec change needs a new offer/answer (brief pause)
        }
        this._tune(p.pc);
      }
    }
    _gameVideoTx(pc) {
      const game = new Set(this.tracks.map(([t]) => t).filter(t => t.kind === "video"));
      return pc.getTransceivers().filter(tx => game.has(tx.sender.track));
    }
    setPeerCap(id, kbps) {
      const p = this.peers.get(id); if (!p) return;
      kbps = Number(kbps);
      p.capKbps = Number.isFinite(kbps) && kbps >= 300 && kbps <= 30000 ? Math.round(kbps) : 0;
      this._tune(p.pc);
    }
    peerCap(id) { return this.peers.get(id)?.capKbps || 0; }
    // Live numbers per guest: what the encoder actually sends and how the link is doing.
    async stats() {
      const game = new Set(this.tracks.map(([t]) => t));
      const out = [];
      for (const [id, p] of this.peers) {
        if (p.pc.connectionState !== "connected") { out.push({ id, state: p.pc.connectionState }); continue; }
        this._tune(p.pc);                      // also catches a resized emulator canvas (resolution cap)
        const gameMids = new Set(p.pc.getTransceivers().filter(t => game.has(t.sender.track)).map(t => t.mid));
        let report; try { report = await p.pc.getStats(); } catch { continue; }
        const o = { id, state: "connected", cap: p.capKbps || 0, ...pairInfo(report) };
        p.memo = p.memo || {};
        let lossIn = null;
        report.forEach(s => {
          if (s.type === "outbound-rtp" && (s.mid == null || gameMids.has(s.mid))) {
            if (s.kind === "video") {
              o.kbps = rate(p.memo, "v", s.bytesSent, s.timestamp);
              o.fps = s.framesPerSecond != null ? Math.round(s.framesPerSecond) : null;
              o.w = s.frameWidth || null; o.h = s.frameHeight || null;
              o.limit = s.qualityLimitationReason && s.qualityLimitationReason !== "none" ? s.qualityLimitationReason : null;
              o.codec = codecName(report, s.codecId);
              o.hw = s.powerEfficientEncoder ?? null;         // true = hardware encoder (Chrome)
              o.impl = s.encoderImplementation || null;
            } else if (s.kind === "audio") o.audioKbps = rate(p.memo, "a", s.bytesSent, s.timestamp);
          }
          if (s.type === "remote-inbound-rtp" && s.kind === "video" && s.fractionLost != null) lossIn = s.fractionLost;
        });
        o.lossPct = lossIn != null ? Math.round(lossIn * 1000) / 10 : null;
        out.push(o);
      }
      return out;
    }
    addTrack(track) {
      if (this.tracks.some(([t]) => t === track)) return;
      this.stream.addTrack(track);
      this.tracks.push([track, this.stream]);
      for (const p of this.peers.values()) this._addTo(p.pc, track);
    }
    // Swaps a game track for a new one of the same kind (e.g. a native emulator window shared again) without
    // renegotiating; with no old track of that kind it is simply added.
    replaceTrack(old, track) {
      const i = old ? this.tracks.findIndex(([t]) => t === old) : -1;
      if (i < 0 || old.kind !== track.kind) return this.addTrack(track);
      this.tracks[i] = [track, this.stream];
      try { this.stream.removeTrack(old); } catch {}
      this.stream.addTrack(track);
      if (track.kind === "video") try { track.contentHint = "motion"; } catch {}
      for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track === old) { s.__rhKey = null; s.replaceTrack(track).then(() => this._tune(p.pc)).catch(() => {}); }
    }
    start() { this.ready = true; for (const id of this.wanted) this._ensure(id); }
    setGuests(ids) {
      this.wanted = new Set(ids);
      for (const id of [...this.peers.keys()]) if (!this.wanted.has(id)) this.drop(id);
      if (this.ready) for (const id of this.wanted) this._ensure(id);
      this._routeVoice(); this._routeGhost();
    }
    drop(id) {
      const p = this.peers.get(id); if (!p) return;
      this.peers.delete(id);
      try { p.pc.close(); } catch {}
      this.onVoice(id, null);
      this.onGhost(id, null);
      this.onState(id, "closed");
    }
    close() { for (const id of [...this.peers.keys()]) this.drop(id); }
    state(id) { const p = this.peers.get(id); return p ? p.pc.connectionState : "new"; }
    rtt(id) { return this.peers.get(id)?.rtt ?? null; }
    broadcastCtl(msg) { for (const p of this.peers.values()) this._ctl(p, msg); }
    // Copies a packed save state to every connected guest. Resolves with how many got it.
    async sendState(bytes) {
      const id = Math.random().toString(36).slice(2, 10);
      const sends = [...this.peers.values()].filter(p => p.st && p.st.readyState === "open")
        .map(p => sendChunked(p.st, bytes, id).then(() => 1, () => 0));
      return (await Promise.all(sends)).reduce((a, b) => a + b, 0);
    }

    // ---- voice
    setHostMic(track, hostId) { this.hostMic = track; this.hostId = hostId; this._routeVoice(); }
    setVoiceOn(ids) { this.voiceOn = new Set(ids); this._routeVoice(); }
    _routeVoice() {
      // The host hears every guest whose mic is on.
      for (const [id, p] of this.peers) this.onVoice(id, this.voiceOn.has(id) ? p.voice[0].receiver.track : null);
      // Each guest hears the host (slot 0) and up to VOICE_SLOTS-1 other guests.
      for (const [id, p] of this.peers) {
        const map = {};
        const send = (slot, track, who) => {
          const s = p.voice[slot].sender;
          if (s.track !== track) s.replaceTrack(track).catch(() => {});
          if (track) map[slot] = who;
        };
        send(0, this.hostMic, this.hostId);
        const others = [...this.peers.keys()].filter(g => g !== id && this.voiceOn.has(g)).slice(0, VOICE_SLOTS - 1);
        for (let i = 1; i < VOICE_SLOTS; i++) {
          const g = others[i - 1];
          send(i, g != null ? this.peers.get(g).voice[0].receiver.track : null, g);
        }
        const key = JSON.stringify(map);
        if (key !== p.mapKey) { p.mapKey = key; p.map = map; this._ctl(p, { t: "voice-map", map }); }
      }
    }

    // ---- side screen: a second video that goes to ONE guest only (their own GBA screen in GBA screens mode).
    // Every connection has the transceiver from the start, so turning it on later needs no renegotiation.
    setSide(id, track) {
      if (track) this.side.set(id, track); else this.side.delete(id);
      const p = this.peers.get(id); if (!p?.side) return;
      if (p.side.sender.track !== (track || null)) p.side.sender.replaceTrack(track || null).catch(() => {});
      this._ctl(p, { t: "side", on: !!track });
    }
    clearSides() { for (const id of [...this.side.keys()]) this.setSide(id, null); }

    // ---- ghosts (single-player ghost mode)
    setHostGhost(track, hostId) { this.hostGhost = track; this.hostId = hostId; this._routeGhost(); }
    setGhostOn(ids) { this.ghostOn = new Set(ids); this._routeGhost(); }
    _routeGhost() {
      // The host sees every guest that sends a ghost.
      for (const [id, p] of this.peers) this.onGhost(id, this.ghostOn.has(id) ? p.ghost[0].receiver.track : null);
      // Each guest gets the host's ghost (slot 0) and up to GHOST_SLOTS-1 other guests' ghosts.
      for (const [id, p] of this.peers) {
        const map = {};
        const send = (slot, track, who) => {
          const s = p.ghost[slot].sender;
          if (s.track !== track) s.replaceTrack(track).then(() => tuneGhost(s)).catch(() => {});
          if (track) map[slot] = who;
        };
        send(0, this.hostGhost, this.hostId);
        const others = [...this.peers.keys()].filter(g => g !== id && this.ghostOn.has(g)).slice(0, GHOST_SLOTS - 1);
        for (let i = 1; i < GHOST_SLOTS; i++) {
          const g = others[i - 1];
          send(i, g != null ? this.peers.get(g).ghost[0].receiver.track : null, g);
        }
        const key = JSON.stringify(map);
        if (key !== p.ghostKey) { p.ghostKey = key; p.ghostMap = map; this._ctl(p, { t: "ghost-map", map }); }
      }
    }
    _ctl(p, msg) { if (p.ctl && p.ctl.readyState === "open") try { p.ctl.send(JSON.stringify(msg)); } catch {} }

    _addTo(pc, track) {
      // addTransceiver (not addTrack) so a game track can never be put on one of the voice transceivers.
      const tx = pc.addTransceiver(track, { direction: "sendonly", streams: [this.stream] });
      if (track.kind === "video") {
        try { track.contentHint = "motion"; } catch {}
        if (this.quality.codec !== "auto") setCodecPref(tx, this.quality.codec);   // before the first offer
      }
    }
    // Encoder settings can only be changed once the connection has negotiated its encodings.
    _tune(pc) {
      const p = [...this.peers.values()].find(x => x.pc === pc);
      if (!p || pc.connectionState !== "connected") return;
      for (const t of p.ghost) tuneGhost(t.sender);
      const q = this.quality, game = new Set(this.tracks.map(([t]) => t));
      for (const sender of pc.getSenders()) {
        if (!sender.track || !game.has(sender.track)) continue;
        if (sender.track.kind === "video") {
          const h = sender.track.getSettings?.().height || 0;
          const kbps = p.capKbps ? Math.min(q.maxKbps, p.capKbps) : q.maxKbps;
          applyEncoding(sender, { maxBitrate: kbps * 1000, maxFramerate: q.fps,
            scaleResolutionDownBy: q.maxHeight && h > q.maxHeight ? Math.round(h / q.maxHeight * 100) / 100 : 1 }, PREFER[q.prefer]);
        } else applyEncoding(sender, { maxBitrate: q.audioKbps * 1000 }, null);
      }
    }
    _ensure(id) {
      if (this.peers.has(id) || this.blocked.has(id)) return;
      const pc = new RTCPeerConnection({ iceServers: this.ice });
      const p = { pc, dc: null, ctl: null, seq: -1, pending: [], voice: [], map: {}, mapKey: "", rtt: null,
        ghost: [], ghostMap: {}, ghostKey: "" };
      // A guest that floods or keeps sending garbage is cut off and not reconnected for this session.
      p.guard = new PeerGuard(() => { this.blocked.add(id); this.drop(id); this.onAbuse(id); });
      this.peers.set(id, p);
      // Unordered + no retransmits: the guest sends its whole controller state, so the newest packet always wins.
      const dc = pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
      dc.binaryType = "arraybuffer";
      p.dc = dc;
      dc.onmessage = e => {
        if (!p.guard.ok()) return;
        if (typeof e.data !== "string") {
          const f = decodeInput(e.data);
          if (!f) return p.guard.bad();
          // Out-of-order (older) frames are ignored; a big backwards jump means the guest restarted its counter.
          if (f.seq <= p.seq && p.seq - f.seq < 1e6) return;
          p.seq = f.seq;
          return this.onInput(id, f.v);
        }
        const m = parseText(e.data);
        if (!m || m.t !== "ping" || !Number.isFinite(m.ts)) return p.guard.bad();
        if (Number.isFinite(m.rtt) && m.rtt >= 0 && m.rtt < 60000) p.rtt = m.rtt;
        try { dc.send(JSON.stringify({ t: "pong", ts: m.ts })); } catch {}
      };
      const ctl = pc.createDataChannel("ctl");   // reliable, ordered
      p.ctl = ctl;
      p.st = pc.createDataChannel("state");      // reliable, ordered: shared save states (host -> guest only)
      p.st.binaryType = "arraybuffer";
      p.st.onmessage = () => p.guard.bad();      // guests never send on it
      ctl.onopen = () => { this._ctl(p, { t: "voice-map", map: p.map }); this._ctl(p, { t: "ghost-map", map: p.ghostMap });
        this._ctl(p, { t: "side", on: this.side.has(id) }); };
      ctl.onmessage = e => {
        if (!p.guard.ok()) return;
        const m = parseText(e.data);
        if (!m) return p.guard.bad();
        this.onCtl(id, m);
      };
      for (let i = 0; i < VOICE_SLOTS; i++) p.voice.push(pc.addTransceiver("audio", { direction: "sendrecv" }));
      for (let i = 0; i < GHOST_SLOTS; i++) p.ghost.push(pc.addTransceiver("video", { direction: "sendrecv" }));
      p.side = pc.addTransceiver(this.side.get(id) || "video", { direction: "sendonly" });
      pc.onicecandidate = e => { if (e.candidate) this.sendSignal(id, { c: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        this.onState(id, pc.connectionState);
        if (pc.connectionState === "connected") { this._tune(pc); this._routeVoice(); this._routeGhost(); }
        if (pc.connectionState === "failed") pc.restartIce?.();
      };
      // One offer at a time: a request that arrives mid-negotiation is replayed once the answer is in.
      p.offer = async () => {
        if (pc.signalingState !== "stable") { p.needOffer = true; return; }
        p.needOffer = false;
        try {
          await pc.setLocalDescription(await pc.createOffer());
          this.sendSignal(id, { sdp: pc.localDescription.toJSON(), meta: { game: this.stream.id, voice: p.voice.map(t => t.mid), ghost: p.ghost.map(t => t.mid), side: p.side.mid } });
        } catch (e) { console.warn("offer failed", e); }
      };
      pc.onnegotiationneeded = () => p.offer();
      for (const [t] of this.tracks) this._addTo(pc, t);
      this.onState(id, "connecting");
      this._routeVoice(); this._routeGhost();
    }
    async onSignal(from, data) {
      const p = this.peers.get(from); if (!p || !data) return;
      try {
        if (data.sdp && data.sdp.type === "answer") {
          if (p.pc.signalingState !== "have-local-offer") return;
          await p.pc.setRemoteDescription(data.sdp);
          for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
          this._tune(p.pc);
          if (p.needOffer) p.offer();
        } else if (data.c) {
          if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.c).catch(() => {});
          else p.pending.push(data.c);
        }
      } catch (e) { console.warn("signal", e); }
    }
  }

  // Guest side: answers whatever the current host offers.
  class GuestNet {
    constructor({ iceServers, sendSignal, onStream, onState, onVoice, onCtl, onGhosts, onAbuse }) {
      this.ice = iceServers; this.sendSignal = sendSignal;
      this.onAbuse = onAbuse || (() => {});     // (): the host was cut off for flooding / malformed data
      this.guard = null; this.guardPc = null;
      this.onStream = onStream; this.onState = onState || (() => {});
      this.onVoice = onVoice || (() => {});     // ({ playerId: track }) whenever the voice map changes
      this.onCtl = onCtl || (() => {});
      this.pc = null; this.dc = null; this.ctl = null; this.hostId = null; this.pending = [];
      this.seq = 0; this.last = new Array(24).fill(0);
      this.rtt = null; this.meta = null; this.voiceMap = {}; this.mic = null;
      this.onGhosts = onGhosts || (() => {});   // ({ playerId: track }) whenever the ghost map changes
      this.ghostMap = {}; this.ghost = null;
      this.onSide = null;                        // (track|null): my own side screen (GBA screens mode)
      this.sideOn = false;
      this.onSharedState = null;                 // (Uint8Array): a save state the host shared
      this.cap = 0;                              // asked-for bitrate cap for my stream (kbps, 0 = host's setting)
      this.memo = {};
      this.timer = setInterval(() => this._flush(), 150);   // heartbeat: re-send state so a lost packet can't stick a button
      this.pinger = setInterval(() => this._ping(), 2000);
    }
    close() { clearInterval(this.timer); clearInterval(this.pinger); try { this.pc?.close(); } catch {} this.pc = null; }
    sendInput(values) { this.last = values.slice(); this._flush(); }
    // Ask the host for a lighter stream for this guest only (0 = the host's setting).
    setCap(kbps) { this.cap = Number(kbps) || 0; this.sendCtl({ t: "quality", cap: this.cap }); }
    async stats() {
      if (!this.pc || this.pc.connectionState !== "connected") return null;
      let report; try { report = await this.pc.getStats(); } catch { return null; }
      const skip = new Set([...(this.meta?.voice || []), ...(this.meta?.ghost || []), ...(this.meta?.side != null ? [this.meta.side] : [])]);
      const o = { ...pairInfo(report) };
      let best = null, audio = null;
      report.forEach(s => {
        if (s.type !== "inbound-rtp" || (s.mid != null && skip.has(s.mid))) return;
        if (s.kind === "video" && (!best || s.bytesReceived > best.bytesReceived)) best = s;
        if (s.kind === "audio" && (!audio || s.bytesReceived > audio.bytesReceived)) audio = s;
      });
      if (best) {
        o.kbps = rate(this.memo, "v", best.bytesReceived, best.timestamp);
        o.fps = best.framesPerSecond != null ? Math.round(best.framesPerSecond) : null;
        o.w = best.frameWidth || null; o.h = best.frameHeight || null;
        o.jitterMs = best.jitter != null ? Math.round(best.jitter * 1000) : null;
        o.codec = codecName(report, best.codecId);
        o.hw = best.powerEfficientDecoder ?? null;
        o.impl = best.decoderImplementation || null;
        const prev = this.memo.vp, lost = best.packetsLost || 0, recv = best.packetsReceived || 0;
        this.memo.vp = { lost, recv };
        if (prev && recv + lost > prev.recv + prev.lost) o.lossPct = Math.round(Math.max(0, lost - prev.lost) / (recv + lost - prev.recv - prev.lost) * 1000) / 10;
        const pd = this.memo.vd, dropped = best.framesDropped || 0, dec = best.framesDecoded || 0;
        this.memo.vd = { dropped, dec };
        if (pd && dec > pd.dec) o.droppedPct = Math.round(Math.max(0, dropped - pd.dropped) / (dec - pd.dec + Math.max(0, dropped - pd.dropped)) * 1000) / 10;
      }
      if (audio) o.audioKbps = rate(this.memo, "a", audio.bytesReceived, audio.timestamp);
      o.cap = this.cap;
      return o;
    }
    sendCtl(msg) { if (this.ctl && this.ctl.readyState === "open") try { this.ctl.send(JSON.stringify(msg)); } catch {} }
    setMic(track) { this.mic = track; this._voiceTx(0)?.sender.replaceTrack(track).catch(() => {}); }
    setGhost(track) {
      this.ghost = track;
      const t = this._ghostTx(0);
      t?.sender.replaceTrack(track).then(() => tuneGhost(t.sender)).catch(() => {});
    }
    _ghostTx(i) { const mid = this.meta?.ghost?.[i]; return mid != null && this.pc ? this.pc.getTransceivers().find(t => t.mid === mid) : null; }
    _emitSide() {
      const mid = this.meta?.side, t = mid != null && this.pc ? this.pc.getTransceivers().find(x => x.mid === mid) : null;
      this.onSide?.(this.sideOn && t ? t.receiver.track : null);
    }
    _emitGhosts() {
      const out = {};
      for (const [slot, who] of Object.entries(this.ghostMap)) { const t = this._ghostTx(Number(slot)); if (t && who != null) out[who] = t.receiver.track; }
      this.onGhosts(out);
    }
    get connected() { return this.pc?.connectionState === "connected"; }
    get channelOpen() { return this.dc?.readyState === "open"; }
    _voiceTx(i) { const mid = this.meta?.voice?.[i]; return mid != null && this.pc ? this.pc.getTransceivers().find(t => t.mid === mid) : null; }
    _emitVoice() {
      const out = {};
      for (const [slot, who] of Object.entries(this.voiceMap)) { const t = this._voiceTx(Number(slot)); if (t && who != null) out[who] = t.receiver.track; }
      this.onVoice(out);
    }
    _flush() {
      if (this.dc && this.dc.readyState === "open") {
        try { this.dc.send(encodeInput(this.seq, this.last)); this.seq = (this.seq + 1) >>> 0; } catch {}
      }
    }
    _ping() { if (this.dc && this.dc.readyState === "open") try { this.dc.send(JSON.stringify({ t: "ping", ts: performance.now(), rtt: this.rtt })); } catch {} }
    _newPc(from) {
      try { this.pc?.close(); } catch {}
      const pc = new RTCPeerConnection({ iceServers: this.ice });
      this.pc = pc; this.hostId = from; this.pending = []; this.dc = null; this.ctl = null;
      pc.ontrack = e => {
        const s = e.streams[0];
        const isGame = this.meta?.game ? s && s.id === this.meta.game : true;
        if (isGame) this.onStream(s || new MediaStream([e.track]));
      };
      pc.ondatachannel = e => {
        const ch = e.channel;
        // Only the two channels the host is supposed to open; anything else is closed.
        if (ch.label === "state") { ch.binaryType = "arraybuffer"; ch.onmessage = stateReceiver(b => this.onSharedState?.(b)); return; }
        if (ch.label !== "ctl" && ch.label !== "input") { try { ch.close(); } catch {} return; }
        // The host is a peer too: its messages are size-capped and validated, and a flooding host is cut off.
        const guard = this.guard && this.guardPc === pc ? this.guard
          : (this.guardPc = pc, this.guard = new PeerGuard(() => { try { pc.close(); } catch {} this.onState("failed"); this.onAbuse(); }));
        if (ch.label === "ctl") {
          this.ctl = ch;
          ch.onopen = () => { if (this.cap) this.sendCtl({ t: "quality", cap: this.cap }); };
          ch.onmessage = ev => {
            if (!guard.ok()) return;
            const m = parseText(ev.data);
            if (!m) return guard.bad();
            if (m.t === "voice-map") { this.voiceMap = cleanMap(m.map, VOICE_SLOTS); this._emitVoice(); }
            else if (m.t === "ghost-map") { this.ghostMap = cleanMap(m.map, GHOST_SLOTS); this._emitGhosts(); }
            else if (m.t === "side") { this.sideOn = m.on === true; this._emitSide(); }
            else this.onCtl(m);
          };
          return;
        }
        this.dc = ch;
        this.dc.onopen = () => { this._flush(); this.onState(pc.connectionState); };
        this.dc.onmessage = ev => {
          if (!guard.ok()) return;
          const m = parseText(ev.data);
          if (!m || m.t !== "pong" || !Number.isFinite(m.ts)) return guard.bad();
          const rtt = Math.round(performance.now() - m.ts);
          if (rtt >= 0 && rtt < 60000) this.rtt = rtt;
        };
      };
      pc.onicecandidate = e => { if (e.candidate) this.sendSignal(this.hostId, { c: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") { const t = this._ghostTx(0); if (t) tuneGhost(t.sender); }
        this.onState(pc.connectionState);
      };
      return pc;
    }
    async onSignal(from, data) {
      if (!data) return;
      try {
        if (data.sdp && data.sdp.type === "offer") {
          // Same host renegotiating keeps the connection; a different (reconnected) host gets a fresh one.
          const pc = (this.pc && this.hostId === from && this.pc.connectionState !== "closed") ? this.pc : this._newPc(from);
          if (data.meta) this.meta = data.meta;
          await pc.setRemoteDescription(data.sdp);
          // Voice transceivers answer as sendrecv so the mic can be switched on later without renegotiating.
          (this.meta?.voice || []).forEach((mid, i) => {
            const t = pc.getTransceivers().find(x => x.mid === mid);
            if (!t) return;
            t.direction = "sendrecv";
            if (i === 0 && this.mic && t.sender.track !== this.mic) t.sender.replaceTrack(this.mic).catch(() => {});
          });
          (this.meta?.ghost || []).forEach((mid, i) => {
            const t = pc.getTransceivers().find(x => x.mid === mid);
            if (!t) return;
            t.direction = "sendrecv";
            if (i === 0 && this.ghost && t.sender.track !== this.ghost) t.sender.replaceTrack(this.ghost).catch(() => {});
          });
          const answer = await pc.createAnswer();
          answer.sdp = stereoOpus(answer.sdp);       // ask for stereo game audio
          await pc.setLocalDescription(answer);
          this.sendSignal(from, { sdp: pc.localDescription.toJSON() });
          for (const c of this.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          this._emitVoice(); this._emitGhosts(); this._emitSide();
        } else if (data.c && from === this.hostId && this.pc) {
          if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.c).catch(() => {});
          else this.pending.push(data.c);
        }
      } catch (e) { console.warn("signal", e); }
    }
  }

  // Taps every Web Audio graph on the page: anything connected to the speakers is also routed to a
  // MediaStream we can send. Must run before the emulator creates its AudioContext.
  function tapPageAudio(onTrack) {
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      const r = orig.call(this, dest, ...rest);
      try {
        if (dest instanceof AudioDestinationNode && !this.context.__rhNoTap) {
          const ctx = this.context;
          if (!ctx.__rhTap) {
            ctx.__rhTap = ctx.createMediaStreamDestination();
            const t = ctx.__rhTap.stream.getAudioTracks()[0];
            if (t) onTrack(t);
          }
          orig.call(this, ctx.__rhTap);
        }
      } catch (e) { console.warn("audio tap", e); }
      return r;
    };
  }

  window.RH = Object.assign(window.RH || {}, { Net: { HostNet, GuestNet, tapPageAudio, VOICE_SLOTS, GHOST_SLOTS, GHOST_FPS, QUALITY_DEFAULT, cleanQuality, supportedVideoCodecs,
    wire: { encodeInput, decodeInput, parseText, cleanMap, PeerGuard, INPUT_BYTES } } });
})();
