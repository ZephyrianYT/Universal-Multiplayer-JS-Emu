// Library scanner rules: what counts as a game, and what is only part of one.
//
// The library shows one entry per playable game, never the pieces a game is made of:
//   - disc images split into tracks: a .cue / .ccd / .gdi / .m3u describes the disc and is the entry; the
//     .bin / .img / .sub / .wav / .raw ... files it names (and multi-disc .cue / .chd named by an .m3u) are hidden
//   - Wii U games extracted to a folder (code/ content/ meta/): the folder is the entry (its code/*.rpx is what
//     Cemu runs); updates and DLC folders aren't games
//   - BIOS and system files (scph*.bin, gba_bios.bin, neogeo.zip ...)
//   - Switch updates and DLC (.nsp with an update / DLC title id)
//   - a 3DS .cia next to a .3ds / .cci of the same game
// Zip / 7z archives are one entry each (never opened and listed file by file).
//
// Browser games made of several files (a .cue and its tracks) are sent to EmulatorJS as one zip, built while it
// is sent (stored, not compressed); EmulatorJS unpacks it and boots the .cue / .m3u inside. See zipBundle().
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const DESCRIPTOR_EXTS = new Set(["cue", "ccd", "gdi", "m3u"]);
// Files a descriptor can name: tracks, subchannel data, CD audio, and the discs of an .m3u.
const PART_EXTS = new Set(["bin", "img", "sub", "iso", "wav", "ogg", "mp3", "flac", "ape", "raw", "cue", "ccd", "chd", "pbp", "cdi"]);
const MAX_DESCRIPTOR = 256 * 1024;

// ---------------------------------------------------------------- BIOS / system files
// "bios.bin", "bios7.bin", "BIOS (USA).bin", "bios_cd.bin", No-Intro's "[BIOS] CX4 (World).zip" - but not "BioShock.iso".
const BIOS_RE = /^(scph.*\.bin|bios(?![a-z]).*|\[bios\].*|.*_bios\.bin|gba_bios\.bin|disksys\.rom|syscard.*\.pce|dc_(boot|flash)\.bin|sega_101\.bin|mpr-\d+.*\.bin|7800 bios.*|lynxboot\.img|kick.*\.rom)$/i;
// Arcade BIOS / device sets: needed next to the games, never games themselves.
const ARCADE_BIOS = new Set(["neogeo", "neocdz", "pgm", "decocass", "skns", "stvbios", "cpzn1", "cpzn2", "tps", "taitofx1", "taitogn",
  "naomi", "naomi2", "naomigd", "awbios", "hod2bios", "f355bios", "f355dlx", "airlbios", "isgsm", "nmk004", "ym2608", "qsound",
  "konamigx", "coh1000a", "coh1000c", "coh1000t", "coh1001l", "coh1002e", "coh1002m", "coh1002v", "coh3002c", "coh3002t", "macsbios",
  "megaplay", "megatech", "playch10", "sys573", "hng64", "segasp", "triforce", "chihiro", "ar_bios", "alg_bios", "crysbios",
  "bubsys", "cchip", "pgm2", "atarisy1", "galgames", "cubo", "aleck64", "konamigv", "nss", "gq863", "midssio",
  "namcoc69", "namcoc70", "namcoc74", "namcoc75", "namcoc76", "lindbios"]);
export function isBios(name) {
  const lower = name.toLowerCase(), ext = path.extname(lower).slice(1), stem = lower.slice(0, lower.length - ext.length - 1);
  return BIOS_RE.test(lower) || ((ext === "zip" || ext === "7z") && ARCADE_BIOS.has(stem));
}

// ---------------------------------------------------------------- Switch: updates and DLC aren't games
// Title ids: base game ends in 000, its update in 800, DLC in anything else (the low 12 bits).
export function switchExtra(name) {
  const m = /\[(01[0-9a-f]{14})\]/i.exec(name);
  if (!m) return /\b(update|upd|dlc)\b/i.test(name) && /\[v\d+\]/i.test(name) ? "extra" : null;
  const low = m[1].slice(-3).toLowerCase();
  return low === "000" ? null : low === "800" ? "update" : "dlc";
}

// ---------------------------------------------------------------- descriptors
// The file names a descriptor refers to (relative to its folder), from its text.
export function parseRefs(ext, text, stem) {
  const refs = [];
  if (ext === "cue") {
    for (const m of text.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)) refs.push(m[1] || m[2]);
  } else if (ext === "gdi") {
    // "1 0 4 2352 track01.bin 0" (the name may be quoted and contain spaces)
    for (const line of text.split(/\r?\n/).slice(1)) {
      const m = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/.exec(line);
      if (m) refs.push(m[1] || m[2]);
    }
  } else if (ext === "m3u") {
    for (const line of text.split(/\r?\n/)) { const l = line.trim(); if (l && !l.startsWith("#")) refs.push(l); }
  } else if (ext === "ccd") {
    for (const e of ["img", "sub", "cue"]) refs.push(`${stem}.${e}`);       // CloneCD: same name, .img / .sub
  }
  return refs.map(r => r.replace(/\\/g, "/")).filter(r => r && !r.startsWith("/") && !/^[a-z]:/i.test(r) && !r.split("/").includes(".."));
}
export async function readDescriptor(file) {
  try {
    const st = await fs.promises.stat(file);
    if (st.size > MAX_DESCRIPTOR) return "";
    return await fs.promises.readFile(file, "latin1");
  } catch { return ""; }
}
// Folder entries -> lowercased absolute paths of the files the folder's descriptors use (hide those), plus
// files named like "<descriptor name> (Track 2).bin" whose descriptor names them differently (renamed dumps).
export async function partsIn(dir, files) {
  const hide = new Set();
  const descs = files.filter(f => DESCRIPTOR_EXTS.has(path.extname(f).slice(1).toLowerCase()));
  for (const d of descs) {
    const ext = path.extname(d).slice(1).toLowerCase(), stem = d.slice(0, d.length - ext.length - 1);
    for (const r of parseRefs(ext, await readDescriptor(path.join(dir, d)), stem))
      if (PART_EXTS.has(path.extname(r).slice(1).toLowerCase()) && r.toLowerCase() !== d.toLowerCase()) hide.add(path.join(dir, r).toLowerCase());
    if (ext !== "m3u") {
      const s = stem.toLowerCase();
      for (const f of files) {
        const fl = f.toLowerCase(), fe = path.extname(fl).slice(1);
        if (fe !== "cue" && fe !== "ccd" && fe !== "chd" && PART_EXTS.has(fe) && fl.startsWith(s) && fl !== d.toLowerCase()) hide.add(path.join(dir, f).toLowerCase());
      }
    }
  }
  // 3DS: an installable .cia next to a bootable .3ds / .cci of the same game.
  const stems = new Set(files.filter(f => /\.(3ds|cci)$/i.test(f)).map(f => f.replace(/\.[^.]+$/, "").toLowerCase()));
  for (const f of files) if (/\.cia$/i.test(f) && stems.has(f.slice(0, -4).toLowerCase())) hide.add(path.join(dir, f).toLowerCase());
  return hide;
}

// Every file a game needs, for a descriptor: itself, what it names, and (.m3u) what its discs name. Absolute paths;
// only files inside the descriptor's folder (or below it).
export async function descriptorFiles(file) {
  const base = path.dirname(path.resolve(file)), out = [], seen = new Set();
  const add = async f => {
    f = path.resolve(f);
    const key = f.toLowerCase();
    if (seen.has(key) || !f.startsWith(base + path.sep)) return;
    let st; try { st = await fs.promises.stat(f); } catch { return; }
    if (!st.isFile()) return;
    seen.add(key); out.push({ file: f, size: st.size, mtime: st.mtimeMs });
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!DESCRIPTOR_EXTS.has(ext)) return;
    const stem = path.basename(f).slice(0, -(ext.length + 1));
    for (const r of parseRefs(ext, await readDescriptor(f), stem)) await add(path.join(path.dirname(f), r));
  };
  await add(file);
  return out;
}

// ---------------------------------------------------------------- Wii U extracted titles
// A folder with code/*.rpx is one game. Its name: meta/meta.xml <shortname_en>, else the folder name without
// the [Game] [title id] tags. Update (0005000E) and DLC (0005000C) folders have code/ too, but aren't games.
const xmlTag = (xml, tag) => { const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i").exec(xml); return m ? m[1].trim() : ""; };
const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// One pass, so "&amp;lt;" becomes "&lt;" (not "<").
const xmlText = s => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENT[e]).replace(/\s+/g, " ").trim();
export async function wiiuTitle(dir, entries) {
  const sub = name => entries.find(e => e.isDirectory() && e.name.toLowerCase() === name);
  const code = sub("code");
  if (!code) return null;
  let codeFiles = [];
  try { codeFiles = await fs.promises.readdir(path.join(dir, code.name)); } catch {}
  const rpxs = codeFiles.filter(f => /\.rpx$/i.test(f));
  if (!rpxs.length) return null;
  const meta = sub("meta");
  let metaXml = "", cos = "";
  if (meta) try { metaXml = await fs.promises.readFile(path.join(dir, meta.name, "meta.xml"), "utf8"); } catch {}
  const cosName = codeFiles.find(f => f.toLowerCase() === "cos.xml");
  if (cosName) try { cos = await fs.promises.readFile(path.join(dir, code.name, cosName), "utf8"); } catch {}
  const folder = path.basename(dir);
  const titleId = (xmlTag(metaXml, "title_id") || (/\[([0-9a-f]{16})\]/i.exec(folder) || [])[1] || "").toLowerCase();
  const kind = titleId.slice(0, 8);
  if (kind === "0005000e" || kind === "0005000c" || /\[(update|dlc)\]/i.test(folder)) return { skip: true };
  // The rpx the title boots (cos.xml <argstr>), else the only / biggest one.
  const arg = xmlTag(cos, "argstr").toLowerCase();
  let rpx = rpxs.find(f => f.toLowerCase() === arg);
  if (!rpx) {
    const sized = await Promise.all(rpxs.map(async f => { try { return [f, (await fs.promises.stat(path.join(dir, code.name, f))).size]; } catch { return [f, 0]; } }));
    rpx = sized.sort((a, b) => b[1] - a[1])[0][0];
  }
  const name = xmlText(xmlTag(metaXml, "shortname_en") || xmlTag(metaXml, "longname_en"))
    || folder.replace(/\s*\[(game|update|dlc|[0-9a-f]{16})\]/gi, "").trim() || folder;
  return { rpx: `${code.name}/${rpx}`, name };
}

// ---------------------------------------------------------------- zip bundle for EmulatorJS
// Stored (uncompressed) zip with CRCs in the local headers. CRCs are cached by path + size + mtime, so the second
// launch of a disc streams straight away. Plain zip: total size under 4 GB (no zip64).
const crcCache = new Map();
const crc32 = zlib.crc32 || (() => {
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  return (buf, crc = 0) => { crc = ~crc; for (let i = 0; i < buf.length; i++) crc = T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return ~crc >>> 0; };
})();
async function fileCrc(f) {
  const key = `${f.file}|${f.size}|${f.mtime}`;
  if (crcCache.has(key)) return crcCache.get(key);
  let crc = 0;
  for await (const chunk of fs.createReadStream(f.file, { highWaterMark: 1 << 20 })) crc = crc32(chunk, crc);
  if (crcCache.size > 2000) crcCache.clear();
  crcCache.set(key, crc >>> 0);
  return crc >>> 0;
}
const dosTime = ms => { const d = new Date(ms);
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; };
// files: [{ file, size, mtime }] (first one is the descriptor), names inside the zip relative to `base`.
// The size is known at once (HEAD answers straight away); each file's CRC is worked out just before it's sent.
export function zipBundle(files, base) {
  const entries = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(path.relative(base, f.file).split(path.sep).join("/"), "utf8");
    entries.push({ ...f, name, t: dosTime(f.mtime), offset, crc: 0 });
    offset += 30 + name.length + f.size;
  }
  const cdSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const total = offset + cdSize + 22;
  if (total >= 0xffffffff || entries.length >= 0xffff) throw new Error("This game is too big to send to the browser in one piece (over 4 GB).");
  async function* body() {
    for (const e of entries) {
      e.crc = await fileCrc(e);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(0, 8);
      head.writeUInt16LE(e.t.time, 10); head.writeUInt16LE(e.t.date, 12); head.writeUInt32LE(e.crc, 14);
      head.writeUInt32LE(e.size, 18); head.writeUInt32LE(e.size, 22); head.writeUInt16LE(e.name.length, 26); head.writeUInt16LE(0, 28);
      yield head; yield e.name;
      let sent = 0;
      for await (const chunk of fs.createReadStream(e.file, { highWaterMark: 1 << 20 })) { sent += chunk.length; yield chunk; }
      if (sent !== e.size) throw new Error(`${path.basename(e.file)} changed while it was being sent.`);
    }
    for (const e of entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
      c.writeUInt16LE(e.t.time, 12); c.writeUInt16LE(e.t.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20);
      c.writeUInt32LE(e.size, 24); c.writeUInt16LE(e.name.length, 28); c.writeUInt32LE(e.offset, 42);
      yield c; yield e.name;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
    yield end;
  }
  return { size: total, body };
}
