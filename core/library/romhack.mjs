// Co-op ROM hacks (core/coop-hacks.json): recognise a library ROM as a hack's base, find the hack's patch file,
// build the patched copy in cache/coop/ and switch on the hack's Project64 cheats. The original ROM is never written.
//
// Patch formats: IPS, BPS, UPS, PPF (1.0 / 2.0 / 3.0). N64 dumps are put in big-endian (.z64) order first.
// Nothing is downloaded: patch files are found by SHA-256 near the ROM, in the console's folders, or in patches/.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_PATCH = 64 * 1024 * 1024, MAX_ROM = 128 * 1024 * 1024, MAX_DIRS = 400;

// ---------------------------------------------------------------- helpers
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const hex8 = n => (n >>> 0).toString(16).padStart(8, "0");
const hash = (alg, buf) => crypto.createHash(alg).update(buf).digest("hex");

// .v64 (byte-swapped) and .n64 (little-endian) dumps -> .z64 order. Returns a new Buffer (or the same one if already .z64).
export function n64Normalize(buf) {
  if (buf.length < 64) return buf;
  if (buf[0] === 0x80 && buf[1] === 0x37) return buf;
  const out = Buffer.from(buf);
  if (buf[0] === 0x37 && buf[1] === 0x80) { for (let i = 0; i + 1 < out.length; i += 2) { const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; } }
  else if (buf[0] === 0x40 && buf[1] === 0x12) {
    for (let i = 0; i + 3 < out.length; i += 4) { let t = out[i]; out[i] = out[i + 3]; out[i + 3] = t; t = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = t; }
  } else return buf;
  return out;
}
// "917D18F6-69BC5453-45": the header checksums and country byte, as Project64 names its sections.
export function n64Id(z64) {
  if (z64.length < 64 || z64[0] !== 0x80) return "";
  return `${z64.subarray(16, 20).toString("hex")}-${z64.subarray(20, 24).toString("hex")}-${z64[0x3e].toString(16).padStart(2, "0")}`.toUpperCase();
}

// ---------------------------------------------------------------- patch formats
class PatchError extends Error {}
function grow(buf, size) { if (size <= buf.length) return buf; const b = Buffer.alloc(size); buf.copy(b); return b; }

export function applyIPS(rom, p) {
  if (p.toString("latin1", 0, 5) !== "PATCH") throw new PatchError("Not an IPS patch.");
  let out = Buffer.from(rom), i = 5;
  while (i + 3 <= p.length) {
    if (p.toString("latin1", i, i + 3) === "EOF") {
      i += 3;
      if (i + 3 <= p.length) { const trunc = p.readUIntBE(i, 3); if (trunc < out.length) out = out.subarray(0, trunc); }
      return out;
    }
    const off = p.readUIntBE(i, 3), size = p.readUInt16BE(i + 3); i += 5;
    if (size) {
      if (i + size > p.length) throw new PatchError("The IPS patch is cut short.");
      out = grow(out, off + size); p.copy(out, off, i, i + size); i += size;
    } else {
      const n = p.readUInt16BE(i), v = p[i + 2]; i += 3;
      out = grow(out, off + n); out.fill(v, off, off + n);
    }
  }
  throw new PatchError("The IPS patch has no end marker (EOF).");
}

function varint(p, st) {
  let d = 0, s = 1;
  for (;;) {
    if (st.i >= p.length) throw new PatchError("The patch is cut short.");
    const x = p[st.i++];
    d += (x & 0x7f) * s;
    if (x & 0x80) return d;
    s *= 128; d += s;
  }
}

export function applyBPS(rom, p) {
  if (p.toString("latin1", 0, 4) !== "BPS1") throw new PatchError("Not a BPS patch.");
  if (p.length < 16) throw new PatchError("The BPS patch is cut short.");
  if (crc32(p, 0, p.length - 4) !== p.readUInt32LE(p.length - 4)) throw new PatchError("The BPS patch file is damaged (checksum).");
  if (crc32(rom) !== p.readUInt32LE(p.length - 12)) throw new PatchError("This ROM isn't the one the patch was made for (BPS source checksum).");
  const st = { i: 4 };
  const srcSize = varint(p, st), tgtSize = varint(p, st), meta = varint(p, st);
  if (srcSize !== rom.length) throw new PatchError("This ROM isn't the one the patch was made for (size).");
  st.i += meta;
  const out = Buffer.alloc(tgtSize), end = p.length - 12;
  let o = 0, srcRel = 0, tgtRel = 0;
  while (st.i < end) {
    const data = varint(p, st), cmd = data & 3, len = Math.floor(data / 4) + 1;
    if (o + len > tgtSize) throw new PatchError("The BPS patch writes past the end.");
    if (cmd === 0) { rom.copy(out, o, o, o + len); o += len; }
    else if (cmd === 1) { p.copy(out, o, st.i, st.i + len); st.i += len; o += len; }
    else {
      const v = varint(p, st), delta = (v & 1 ? -1 : 1) * Math.floor(v / 2);
      if (cmd === 2) { srcRel += delta; rom.copy(out, o, srcRel, srcRel + len); srcRel += len; o += len; }
      else { tgtRel += delta; for (let k = 0; k < len; k++) out[o++] = out[tgtRel++]; }
    }
  }
  if (crc32(out) !== p.readUInt32LE(p.length - 8)) throw new PatchError("The patched ROM didn't come out right (BPS target checksum).");
  return out;
}

export function applyUPS(rom, p) {
  if (p.toString("latin1", 0, 4) !== "UPS1") throw new PatchError("Not a UPS patch.");
  if (crc32(p, 0, p.length - 4) !== p.readUInt32LE(p.length - 4)) throw new PatchError("The UPS patch file is damaged (checksum).");
  if (crc32(rom) !== p.readUInt32LE(p.length - 12)) throw new PatchError("This ROM isn't the one the patch was made for (UPS source checksum).");
  const st = { i: 4 };
  varint(p, st); const tgtSize = varint(p, st);
  const out = Buffer.alloc(tgtSize); rom.copy(out, 0, 0, Math.min(rom.length, tgtSize));
  let o = 0; const end = p.length - 12;
  while (st.i < end) {
    o += varint(p, st);
    while (st.i < end) { const x = p[st.i++]; if (o < tgtSize) out[o] ^= x; o++; if (!x) break; }
  }
  if (crc32(out) !== p.readUInt32LE(p.length - 8)) throw new PatchError("The patched ROM didn't come out right (UPS target checksum).");
  return out;
}

export function applyPPF(rom, p) {
  const magic = p.toString("latin1", 0, 5);
  let out = Buffer.from(rom), i, wide = false, undo = false, stop = p.length;
  const diz = p.indexOf("@BEGIN_FILE_ID.DIZ", 0, "latin1");
  if (diz >= 0) stop = diz;
  if (magic === "PPF10") i = 56;
  else if (magic === "PPF20") {
    i = 56 + 4 + 1024;                                          // + image size + block check
    const size = p.readUInt32LE(56);
    if (size && size !== rom.length) throw new PatchError("This ROM isn't the one the patch was made for (size).");
  } else if (magic === "PPF30") {
    const blockcheck = p[57]; undo = !!p[58]; wide = true;
    i = 60 + (blockcheck ? 1024 : 0);
  } else throw new PatchError("Not a PPF patch.");
  while (i < stop) {
    if (i + (wide ? 9 : 5) > stop) throw new PatchError("The PPF patch is cut short.");
    const off = wide ? Number(p.readBigUInt64LE(i)) : p.readUInt32LE(i); i += wide ? 8 : 4;
    const n = p[i++];
    if (i + n > stop) throw new PatchError("The PPF patch is cut short.");
    out = grow(out, off + n); p.copy(out, off, i, i + n); i += n;
    if (undo) i += n;
  }
  return out;
}

const APPLY = { ips: applyIPS, bps: applyBPS, ups: applyUPS, ppf: applyPPF };
export function applyPatch(format, rom, patch) {
  const fn = APPLY[String(format).toLowerCase()];
  if (!fn) throw new PatchError(`Unknown patch format: ${format}`);
  return fn(rom, patch);
}

// ---------------------------------------------------------------- hack list
export async function loadHacks(file) {
  try {
    const j = JSON.parse(await fs.readFile(file, "utf8"));
    return (Array.isArray(j.hacks) ? j.hacks : []).filter(h => h && h.id && h.base && Array.isArray(h.variants));
  } catch { return []; }
}

// What a ROM is, for matching: computed once per file (cached by path + size + mtime; MD5 of 64 MB takes ~0.2 s).
const idCache = new Map();
export async function romIdentity(file) {
  const st = await fs.stat(file);
  if (!st.isFile() || st.size > MAX_ROM) return null;
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (idCache.has(key)) return idCache.get(key);
  const z = n64Normalize(await fs.readFile(file));
  const id = { n64: n64Id(z), md5: hash("md5", z), crc32: hex8(crc32(z)), size: z.length };
  if (idCache.size > 200) idCache.clear();
  idCache.set(key, id);
  return id;
}
const inList = (list, v) => Array.isArray(list) && !!v && list.some(x => String(x).toLowerCase() === String(v).toLowerCase());
const baseMatches = (b, id) => inList(b.md5, id.md5) || inList(b.crc32, id.crc32) || inList(b.n64, id.n64);

// Hacks whose base this ROM is ({hack, exact}) and notes for near misses (e.g. retail OoT for a Debug ROM hack).
export function matchHacks(hacks, id) {
  const offers = [], notes = [];
  for (const h of hacks) {
    // near: checked first, so a known-wrong dump (or an already-patched build) gets its note, never the button.
    const near = (Array.isArray(h.near) ? h.near : h.near ? [h.near] : []).find(n => baseMatches(n, id));
    if (near) notes.push({ hack: h, note: near.note });
    else if (baseMatches(h.base, id) && !inList(h.base.not_md5, id.md5)) offers.push({ hack: h, exact: inList(h.base.md5, id.md5) || inList(h.base.crc32, id.crc32) });
  }
  return { offers, notes };
}

// ---------------------------------------------------------------- finding patch and cheat files
// Looks next to the ROM, in the console folder (the ROM folder's parent, 3 levels: N64/Patches/OotMultiPlayer/...)
// and in the hub's patches/ folder, for a file of the right size whose SHA-256 matches.
// Folders that never hold patches (the hub's own, when its roms/ folder is the ROM's folder).
const SKIP_DIRS = new Set(["node_modules", "cache", "backup", "run", "public", "core", "emulators", "assets", "setup"]);
async function walk(dirs, wanted, visit) {
  let n = 0;
  const seen = new Set();
  async function scan(dir, depth) {
    if (n++ >= MAX_DIRS || seen.has(dir.toLowerCase())) return;
    seen.add(dir.toLowerCase());
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    // Only files with a wanted name are opened (a ROM folder on a network drive can hold thousands of games).
    for (const e of entries) if (e.isFile() && wanted(e.name) && await visit(path.join(dir, e.name), e.name)) return true;
    if (depth > 0) for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name.toLowerCase()) && await scan(path.join(dir, e.name), depth - 1)) return true;
    }
  }
  for (const [d, depth] of dirs) if (d && await scan(path.resolve(d), depth)) return;
}
const searchDirs = (romPath, patchesDir) => [[patchesDir, 2], [path.dirname(romPath), 0], [path.dirname(path.dirname(romPath)), 3]];

export async function findPatch(spec, romPath, patchesDir) {
  let found = null;
  const ext = "." + String(spec.format || "").toLowerCase(), named = String(spec.file || "").toLowerCase();
  await walk(searchDirs(romPath, patchesDir), name => name.toLowerCase() === named || name.toLowerCase().endsWith(ext), async p => {
    let st; try { st = await fs.stat(p); } catch { return false; }
    if (st.size !== spec.size || st.size > MAX_PATCH) return false;
    const buf = await fs.readFile(p);
    if (hash("sha256", buf) !== spec.sha256) return false;
    found = { file: p, data: buf };
    return true;
  });
  return found;
}

// Project64 1.x/2.x cheat file ("[CRC-CRC-C:XX]" sections with CheatN="Name",codes) or 3.0 ("$Name" blocks).
// Returns the entries of one section whose name starts with group\ (or equals group).
export function parseCheatSection(text, section, group) {
  const out = [];
  let inSec = false, cur = null;
  const want = n => n === group || n.startsWith(group + "\\");
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) { inSec = line.toUpperCase() === `[${section.toUpperCase()}]`; cur = null; continue; }
    if (!inSec || !line || line.startsWith("//")) continue;
    let m = /^Cheat\d+="([^"]*)",(.*)$/.exec(line);
    if (m) { if (want(m[1])) out.push({ name: m[1], codes: m[2].split(",").map(s => s.trim()).filter(Boolean) }); continue; }
    m = /^\$(.+)$/.exec(line);
    if (m) { cur = want(m[1]) ? { name: m[1], codes: [] } : null; if (cur) out.push(cur); continue; }
    if (cur && /^[0-9A-F]{8} [0-9A-F?]{4}$/i.test(line)) cur.codes.push(line.toUpperCase());
  }
  // Codes with ?? need a value picked from a list: not something to switch on blindly.
  return out.filter(c => c.codes.length && c.codes.every(x => /^[0-9A-F]{8} [0-9A-F]{4}$/i.test(x)));
}

export async function findCheats(spec, romPath, patchesDir) {
  let found = null;
  await walk(searchDirs(romPath, patchesDir), name => /\.cht$/i.test(name), async p => {
    let st; try { st = await fs.stat(p); } catch { return false; }
    if (st.size > 2 * 1024 * 1024) return false;
    const text = await fs.readFile(p, "latin1");
    if (!text.toUpperCase().includes(`[${spec.section.toUpperCase()}]`)) return false;
    const list = parseCheatSection(text, spec.section, spec.group);
    if (!list.length) return false;
    found = { file: p, list };
    return true;
  });
  return found;
}

// Project64 3.0 reads every .cht in Config/Cheats-User; a code marked "On By Default=1" is on unless the player
// switched it off. One file per hack variant, named so it's clear where it came from.
export async function writeProject64Cheats(pj64Dir, section, title, list, fileName) {
  const dir = path.join(pj64Dir, "Config", "Cheats-User");
  await fs.mkdir(dir, { recursive: true });
  const body = [`[${section}]`, `Name=${title}`, ""];
  for (const c of list) body.push(`$${c.name}`, "On By Default=1", ...c.codes, "");
  const file = path.join(dir, fileName.replace(/[^A-Za-z0-9 ._()-]/g, "_") + ".cht");
  await fs.writeFile(file, body.join("\r\n"), "latin1");
  return file;
}

// Project64's own folder (holds Config/), from emulators/project64 or emulators/pj64, up to two folders down
// (a zip unpacked with "Extract All" adds one level). emuDirs: EMULATORS_DIR first, then ./emulators.
export async function findProject64(emuDirs) {
  for (const base of emuDirs.filter(Boolean)) {
    for (const folder of ["project64", "pj64"]) {
      let hit = null;
      await walk([[path.join(base, folder), 2]], n => n.toLowerCase() === "project64.exe", async p => { hit = path.dirname(p); return true; });
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------- everything for one launch
// Patched ROM in coopDir (reused while it exists), the hack's cheats switched on in Project64.
export async function prepareCoop({ hacks, romPath, hackId, variantId, patchesDir, coopDir, emuDirs }) {
  const hack = hacks.find(h => h.id === hackId), variant = hack?.variants.find(v => v.id === variantId);
  if (!variant) throw new PatchError("That co-op hack isn't in the list.");
  const id = await romIdentity(romPath);
  if (!id || !matchHacks([hack], id).offers.length) throw new PatchError(`This ROM isn't ${hack.base.name}.`);
  const out = path.join(coopDir, `${hack.id}-${variant.id}-${id.md5.slice(0, 12)}.z64`);
  let have = false; try { have = (await fs.stat(out)).size > 0; } catch {}
  if (!have) {
    const p = await findPatch(variant.patch, romPath, patchesDir);
    if (!p) throw new PatchError(`The patch file (${variant.patch.file}) wasn't found. Put it next to the ROM or in the hub's patches folder.`);
    const rom = applyPatch(variant.patch.format, n64Normalize(await fs.readFile(romPath)), p.data);
    await fs.mkdir(coopDir, { recursive: true });
    const tmp = out + ".part";
    await fs.writeFile(tmp, rom);
    await fs.rename(tmp, out);
  }
  let cheats = null;
  if (variant.cheats) {
    const c = await findCheats(variant.cheats, romPath, patchesDir);
    if (!c) throw new PatchError(`${variant.name} needs its Project64 cheat list (${variant.cheats.file}, "${variant.cheats.group}"). Put it next to the ROM or in the hub's patches folder.`);
    const pj = await findProject64(emuDirs);
    if (!pj) throw new PatchError("Project64 isn't installed: put it in emulators/project64/.");
    // Project64 names a game's section by the patched ROM's header; the 2P and 4P versions share it, so one file
    // per section, rewritten for the version being started.
    const head = Buffer.alloc(64);
    const fd = await fs.open(out, "r"); try { await fd.read(head, 0, 64, 0); } finally { await fd.close(); }
    const [c1, c2, cc] = n64Id(head).split("-");
    const section = `${c1}-${c2}-C:${cc}`;
    const file = await writeProject64Cheats(pj, section, `${variant.name} (Retro Hub co-op)`, c.list, `Retro Hub co-op ${c1}-${c2}-${cc}`);
    cheats = { count: c.list.length, file, section };
  }
  return { file: out, name: variant.name, players: variant.players, ports: variant.ports || null, cheats, system: hack.system || "n64native" };
}

export { PatchError };
