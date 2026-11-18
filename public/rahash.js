// RetroAchievements game identification, shared by the page (<script>) and the server (import for side effects).
// RetroAchievements knows each supported ROM by an MD5 of its data, with a few console-specific rules (copier
// headers skipped, N64 in big-endian order). Library games in a .zip are hashed by the hub from the ROM inside;
// arcade sets by their file name (core/net/retroachievements.mjs). Disc consoles, DS and PSP use other methods
// (rcheevos disc rules, which need the disc data, e.g. decoding .chd); for those the hub matches by title instead.
(function (g) {
  "use strict";
  // Retro Hub console id -> RetroAchievements console id
  const CONSOLES = { segaMD: 1, n64: 2, snes: 3, gb: 4, gba: 5, gbc: 6, nes: 7, pce: 8, segaCD: 9, sega32x: 10, segaMS: 11,
    psx: 12, lynx: 13, ngp: 14, segaGG: 15, gc: 16, jaguar: 17, nds: 18, ndsnative: 18, wii: 19, ps2: 21, atari2600: 25,
    arcade: 27, vb: 28, segaSaturn: 39, dreamcast: 40, psp: 41, coleco: 44, atari7800: 51, ws: 53, n3ds: 62, gbalink: 5 };
  // Older libraries listed .gbc files under "gb"; they are their own console on RetroAchievements.
  const consoleId = (system, ext) => system === "gb" && ext === "gbc" ? 6 : system === "gbalink" && ext !== "gba" ? (ext === "gbc" ? 6 : 4) : CONSOLES[system] || 0;
  const WHOLE = new Set(["gb", "gbc", "gba", "gbalink", "segaMD", "segaMS", "segaGG", "sega32x", "atari2600", "ngp", "ws", "vb", "coleco", "jaguar"]);
  const ascii = (b, at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

  // The bytes RetroAchievements hashes for this file, or null when it can't be hashed this way.
  function hashData(system, ext, bytes) {
    ext = String(ext || "").toLowerCase();
    if (["zip", "7z", "rar"].includes(ext) || !bytes || !bytes.length) return null;
    const n = bytes.length;
    switch (system) {
      case "nes": return ascii(bytes, 0, "NES\x1a") || ascii(bytes, 0, "FDS\x1a") ? bytes.subarray(16) : bytes;
      case "snes": return n % 8192 === 512 ? bytes.subarray(512) : bytes;
      case "pce": return n % 131072 === 512 ? bytes.subarray(512) : bytes;
      case "lynx": return ascii(bytes, 0, "LYNX\0") ? bytes.subarray(64) : bytes;
      case "atari7800": return ascii(bytes, 1, "ATARI7800") ? bytes.subarray(128) : bytes;
      case "n64": {
        const out = new Uint8Array(n);
        if (bytes[0] === 0x80) return bytes;                                   // .z64: already big-endian
        if (bytes[0] === 0x37) { for (let i = 0; i + 1 < n; i += 2) { out[i] = bytes[i + 1]; out[i + 1] = bytes[i]; } return out; }   // .v64
        if (bytes[0] === 0x40) { for (let i = 0; i + 3 < n; i += 4) { out[i] = bytes[i + 3]; out[i + 1] = bytes[i + 2]; out[i + 2] = bytes[i + 1]; out[i + 3] = bytes[i]; } return out; }   // .n64
        return bytes;
      }
      default: return WHOLE.has(system) ? bytes : null;
    }
  }
  const MAX_BYTES = 64 * 1024 * 1024;

  // Title match for games that can't be hashed: "Metroid Fusion (USA) [!]" ~ "Metroid Fusion".
  const normTitle = s => String(s || "").toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/^the |, the\b/g, " ")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

  // Plain MD5 (the page has no MD5 in Web Crypto). Uint8Array -> hex.
  function md5(bytes) {
    const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const n = bytes.length, total = ((n + 8) >>> 6) + 1, W = new Int32Array(total * 16);
    for (let i = 0; i < n; i++) W[i >> 2] |= bytes[i] << ((i % 4) * 8);
    W[n >> 2] |= 0x80 << ((n % 4) * 8);
    W[total * 16 - 2] = (n * 8) | 0; W[total * 16 - 1] = Math.floor(n / 536870912) | 0;
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let o = 0; o < W.length; o += 16) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, gi;
        if (i < 16) { F = (B & C) | (~B & D); gi = i; }
        else if (i < 32) { F = (D & B) | (~D & C); gi = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; gi = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); gi = (7 * i) % 16; }
        const s = S[(i >> 4) * 4 + (i % 4)];
        F = (F + A + K[i] + W[o + gi]) | 0;
        A = D; D = C; C = B; B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map(x => [0, 8, 16, 24].map(sh => ((x >>> sh) & 255).toString(16).padStart(2, "0")).join("")).join("");
  }

  g.RAHash = { CONSOLES, consoleId, hashData, normTitle, md5, MAX_BYTES };
  if (typeof window !== "undefined") window.RH = Object.assign(window.RH || {}, { RAHash: g.RAHash });
})(typeof window !== "undefined" ? window : globalThis);
