// RH.Saves: save states kept in this browser (IndexedDB), gzip-compressed, grouped by console + game name.
// A co-op host's saves are also copied to every guest over WebRTC, so whoever hosts next (host migration, or
// another night) can carry on from the same point. A save can be exported to a .rhsave file and imported again.
//
// Packed format (used for sharing and for files): "RHSV" [u32 headerLen] [header JSON] [gzip'd state bytes].
// Packed data from other players is untrusted: sizes are capped and every header field is checked.
(function () {
  "use strict";
  const DB = "rh-saves", STORE = "states", KEEP = 12;            // saves kept per game
  const MAX_PACKED = 64 << 20, MAX_STATE = 96 << 20, MAX_HEADER = 64 << 10;
  const MAGIC = [0x52, 0x48, 0x53, 0x56];                         // "RHSV"
  const gameKey = (system, game) => `${system}|${String(game || "").toLowerCase()}`;

  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        s.createIndex("game", "gameKey");
        s.createIndex("system", "system");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => { dbp = null; reject(r.error); };
    });
    return dbp;
  }
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      let out; const req = fn(s);
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => reject(t.error);
    });
  };

  // ---- compression (CompressionStream is in every current browser; without it states are stored raw)
  const canGzip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  async function gzip(bytes) {
    if (!canGzip) return { data: new Blob([bytes]), enc: "raw" };
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    return { data: out, enc: "gzip" };
  }
  // Decompress with a size cap, so a hostile "zip bomb" can't fill memory.
  async function gunzip(blob, enc) {
    if (enc === "raw") { if (blob.size > MAX_STATE) throw new Error("Save is too big."); return new Uint8Array(await blob.arrayBuffer()); }
    if (!canGzip) throw new Error("This browser can't open compressed saves.");
    const reader = blob.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const parts = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > MAX_STATE) { reader.cancel().catch(() => {}); throw new Error("Save is too big."); }
      parts.push(value);
    }
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---- header checks (anything from another player or a file goes through here)
  const str = (v, n) => String(v ?? "").replace(/[\x00-\x1f]/g, "").slice(0, n);
  const okThumb = t => typeof t === "string" && t.length < 48000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t) ? t : null;
  function cleanHeader(h) {
    if (!h || typeof h !== "object") return null;
    const system = str(h.system, 24), game = str(h.game, 80);
    if (!/^[A-Za-z0-9]+$/.test(system) || !game) return null;
    const at = Number(h.at);
    return { system, game, gameKey: gameKey(system, game), at: Number.isFinite(at) && at > 0 ? Math.min(at, Date.now() + 864e5) : Date.now(),
      by: str(h.by, 40), byKey: /^[0-9A-F]{16}$/.test(h.byKey) ? h.byKey : "", label: str(h.label, 60),
      enc: h.enc === "raw" ? "raw" : "gzip", rawSize: Math.max(0, Math.min(MAX_STATE, Number(h.rawSize) || 0)), thumb: okThumb(h.thumb) };
  }

  async function pack(entry) {
    const header = { system: entry.system, game: entry.game, at: entry.at, by: entry.by, byKey: entry.byKey, label: entry.label,
      enc: entry.enc, rawSize: entry.rawSize, thumb: entry.thumb };
    const hb = new TextEncoder().encode(JSON.stringify(header));
    const body = new Uint8Array(await entry.data.arrayBuffer());
    const out = new Uint8Array(8 + hb.length + body.length);
    out.set(MAGIC, 0); new DataView(out.buffer).setUint32(4, hb.length, true);
    out.set(hb, 8); out.set(body, 8 + hb.length);
    return out;
  }
  function unpack(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 9 || bytes.length > MAX_PACKED) throw new Error("Not a Retro Hub save.");
    for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error("Not a Retro Hub save.");
    const hl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    if (hl > MAX_HEADER || 8 + hl > bytes.length) throw new Error("Damaged save file.");
    let h; try { h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))); } catch { throw new Error("Damaged save file."); }
    const header = cleanHeader(h);
    if (!header) throw new Error("Damaged save file.");
    return { ...header, data: new Blob([bytes.subarray(8 + hl)]), size: bytes.length - 8 - hl };
  }

  // ---- store
  async function put(entry) {
    const id = await tx("readwrite", s => s.add(entry));
    // keep the newest KEEP saves per game
    const all = await list(entry.system, entry.game);
    for (const old of all.slice(KEEP)) await remove(old.id);
    return id;
  }
  async function list(system, game) {
    const rows = await tx("readonly", s => s.index("game").getAll(gameKey(system, game)));
    return (rows || []).sort((a, b) => b.at - a.at);
  }
  // Every save for one console (lighter rows: no state data), for "other games" listings.
  async function listSystem(system) {
    const rows = await tx("readonly", s => s.index("system").getAll(system));
    return (rows || []).map(({ data, ...r }) => r).sort((a, b) => b.at - a.at);
  }
  const get = id => tx("readonly", s => s.get(id));
  const remove = id => tx("readwrite", s => s.delete(id));

  // Makes a save entry from raw emulator state bytes.
  async function make(stateBytes, { system, game, by, byKey, label, thumb, shared }) {
    const { data, enc } = await gzip(stateBytes);
    return { system, game, gameKey: gameKey(system, game), at: Date.now(), by, byKey, label, thumb: okThumb(thumb),
      enc, rawSize: stateBytes.length, size: data.size, data, shared: !!shared };
  }
  // Stores a packed save that came from another player or a file.
  async function importPacked(bytes, extra = {}) {
    const e = unpack(bytes);
    const entry = { ...e, ...extra };
    entry.id = await put(entry);
    return entry;
  }
  const load = entry => gunzip(entry.data, entry.enc);

  function download(entry) {
    pack(entry).then(bytes => {
      const a = document.createElement("a");
      const name = `${entry.game} - ${new Date(entry.at).toISOString().slice(0, 16).replace("T", " ").replace(":", "-")}.rhsave`;
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      a.download = name.replace(/[\\/:*?"<>|]/g, "_");
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  // Small preview picture from the emulator's PNG screenshot (bytes) -> JPEG data URL, about 160 px wide.
  async function thumbFrom(pngBytes) {
    try {
      const bmp = await createImageBitmap(new Blob([pngBytes], { type: "image/png" }));
      const w = 160, h = Math.max(1, Math.round(bmp.height * w / bmp.width));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      return c.toDataURL("image/jpeg", 0.72);
    } catch { return null; }
  }

  const ago = at => {
    const s = Math.round((Date.now() - at) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(at).toLocaleDateString();
  };

  window.RH = Object.assign(window.RH || {}, { Saves: { list, listSystem, get, put, remove, make, load, pack, unpack, importPacked, download, thumbFrom, ago, MAX_PACKED } });
})();
