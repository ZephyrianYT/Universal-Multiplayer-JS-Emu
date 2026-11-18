// Cover art for the library, without touching the ROM folders.
// - Auto covers (owner's choice, off by default): box art from the libretro-thumbnails project
//   (thumbnails.libretro.com, the set RetroArch uses), matched by the game's file name. Fetched in the background,
//   one at a time, and kept in cache/covers/<console>/.
// - Manual covers: the owner drops an image onto a game (for example a scan saved from TheCoverProject,
//   thecoverproject.net). TheCoverProject sits behind a browser check that automated tools must not get around,
//   so the hub only opens its search page; the owner saves the cover and drops it in.
// A cover next to the ROM (see README, "The ROM library") always wins over both.
import fs from "node:fs";
import path from "node:path";

const BASE = "https://thumbnails.libretro.com/";
const UA = "RetroHub (self-hosted game hub)";
// Retro Hub console -> libretro playlist name. Game Boy / Color, Neo Geo Pocket (Color) and WonderSwan (Color) by extension.
const PLAYLISTS = {
  nes: "Nintendo - Nintendo Entertainment System", snes: "Nintendo - Super Nintendo Entertainment System", n64: "Nintendo - Nintendo 64",
  gb: "Nintendo - Game Boy", gbc: "Nintendo - Game Boy Color", gba: "Nintendo - Game Boy Advance", nds: "Nintendo - Nintendo DS",
  ndsnative: "Nintendo - Nintendo DS", psx: "Sony - PlayStation", segaMD: "Sega - Mega Drive - Genesis", segaMS: "Sega - Master System - Mark III",
  segaGG: "Sega - Game Gear", segaCD: "Sega - Mega-CD - Sega CD", sega32x: "Sega - 32X", segaSaturn: "Sega - Saturn",
  atari2600: "Atari - 2600", atari7800: "Atari - 7800", lynx: "Atari - Lynx", jaguar: "Atari - Jaguar",
  pce: "NEC - PC Engine - TurboGrafx 16", ngp: "SNK - Neo Geo Pocket", ngc: "SNK - Neo Geo Pocket Color", ws: "Bandai - WonderSwan",
  wsc: "Bandai - WonderSwan Color", vb: "Nintendo - Virtual Boy", coleco: "Coleco - ColecoVision", arcade: "FBNeo - Arcade Games",
  psp: "Sony - PlayStation Portable", ps2: "Sony - PlayStation 2", gc: "Nintendo - GameCube", wii: "Nintendo - Wii",
  dreamcast: "Sega - Dreamcast", n3ds: "Nintendo - Nintendo 3DS", ps3: "Sony - PlayStation 3", xbox: "Microsoft - Xbox",
  xbox360: "Microsoft - Xbox 360", wiiu: "Nintendo - Wii U",
};
const playlistFor = (system, ext) => {
  if ((system === "gb" || system === "gbalink") && ext === "gbc") return PLAYLISTS.gbc;
  if (system === "gbalink") return ext === "gba" ? PLAYLISTS.gba : PLAYLISTS.gb;
  if (system === "ngp" && ext === "ngc") return PLAYLISTS.ngc;
  if (system === "ws" && ext === "wsc") return PLAYLISTS.wsc;
  return PLAYLISTS[system] || null;
};
// libretro thumbnail file names replace these characters with "_".
const thumbName = s => s.replace(/[&*/:`<>?\\|"]/g, "_");
// "Legend of Zelda, The - A Link to the Past (USA)" ~ "The Legend of Zelda: A Link to the Past"
const norm = s => String(s).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/^(.*), the\b/, "the $1")
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const REGION_PREF = ["(USA)", "(USA, Europe)", "(World)", "(Europe)", "(Japan, USA)", "(Japan)"];
const IMG_MAGIC = [[0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x52, 0x49, 0x46, 0x46]];   // png, jpeg, webp (RIFF)
const imgExt = b => b[0] === 0x89 ? "png" : b[0] === 0xff ? "jpg" : b[0] === 0x52 && b.slice(8, 12).toString() === "WEBP" ? "webp" : null;

export function createCovers({ cacheDir, log = console, onChange = () => {} }) {
  const dir = path.join(cacheDir, "covers");
  fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, "settings.json");
  let settings = { auto: "off" };
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch {}
  const listings = new Map();          // playlist -> { at, names: [] }
  const missed = new Map();            // "<system>/<name>" -> time of the last failed lookup (retried after a day)
  const queue = []; let running = false, fetched = 0;

  const safe = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 150);
  const coverDir = system => path.join(dir, safe(system));
  // Existing cover in the cache for a game: manual first, then auto. Returns a path relative to the covers dir.
  const dirLists = new Map();          // console folder -> { at, files: Set } (one readdir per scan, not a stat per game)
  function find(system, name) {
    const sd = safe(system);
    let e = dirLists.get(sd);
    if (!e || Date.now() - e.at > 5000) {
      let files = []; try { files = fs.readdirSync(coverDir(system)); } catch {}
      dirLists.set(sd, e = { at: Date.now(), files: new Set(files) });
    }
    const base = safe(name);
    for (const kind of ["manual", "auto"]) for (const ext of ["png", "jpg", "webp"]) {
      if (e.files.has(`${base}.${kind}.${ext}`)) return `${sd}/${base}.${kind}.${ext}`;
    }
    return null;
  }
  const file = rel => { const f = path.resolve(dir, rel); return f.startsWith(dir + path.sep) ? f : null; };

  // Apache directory listing of a console's Named_Boxarts folder (cached on disk for a week): lets us match
  // file names that aren't exactly No-Intro (no region tag, different punctuation).
  async function listing(pl) {
    const e = listings.get(pl);
    if (e && Date.now() - e.at < 7 * 86400e3) return e.names;
    const f = path.join(dir, `_list-${safe(pl)}.json`);
    try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < 7 * 86400e3) { const names = JSON.parse(fs.readFileSync(f, "utf8")); listings.set(pl, { at: st.mtimeMs, names }); return names; } } catch {}
    const r = await fetch(`${BASE}${encodeURIComponent(pl)}/Named_Boxarts/`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`thumbnails.libretro.com answered ${r.status}`);
    const html = await r.text();
    const names = [...html.matchAll(/href="([^"?/]+)\.png"/g)].map(m => { try { return decodeURIComponent(m[1]); } catch { return null; } }).filter(Boolean);
    try { fs.writeFileSync(f, JSON.stringify(names)); } catch {}
    listings.set(pl, { at: Date.now(), names });
    return names;
  }
  function bestMatch(names, name) {
    const want = norm(name);
    const hits = names.filter(n => norm(n) === want);
    if (!hits.length) return null;
    for (const r of REGION_PREF) { const h = hits.find(n => n.includes(r)); if (h) return h; }
    return hits.sort((a, b) => a.length - b.length)[0];
  }
  async function fetchOne(g) {
    const pl = playlistFor(g.system, g.ext);
    if (!pl) return false;
    const get = async n => {
      const r = await fetch(`${BASE}${encodeURIComponent(pl)}/Named_Boxarts/${encodeURIComponent(thumbName(n))}.png`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.length < 8 * 1024 * 1024 && imgExt(buf) === "png" ? buf : null;
    };
    let buf = await get(g.name);                              // exact No-Intro name: one request
    if (!buf) { const m = bestMatch(await listing(pl), g.name); if (m) buf = await get(m); }
    if (!buf) return false;
    fs.mkdirSync(coverDir(g.system), { recursive: true });
    const f = path.join(coverDir(g.system), `${safe(g.name)}.auto.png`);
    fs.writeFileSync(f + ".tmp", buf); fs.renameSync(f + ".tmp", f);
    dirLists.delete(safe(g.system));
    return true;
  }
  async function pump() {
    if (running) return;
    running = true;
    let changed = 0;
    while (queue.length && settings.auto === "libretro") {
      const g = queue.shift();
      const key = `${g.system}/${g.name}`;
      try { if (await fetchOne(g)) { changed++; fetched++; } else missed.set(key, Date.now()); }
      catch (e) { missed.set(key, Date.now()); log.warn(`covers: ${e.message}`); }
      await new Promise(r => setTimeout(r, 400));             // gentle on the thumbnails server
      if (changed && changed % 10 === 0) onChange();
    }
    running = false;
    if (changed) { log.log(`covers: added ${changed} cover${changed === 1 ? "" : "s"}`); onChange(); }
  }
  // Called after each library scan with the games that still have no cover.
  function want(games) {
    if (settings.auto !== "libretro") return;
    const queued = new Set(queue.map(g => `${g.system}/${g.name}`));
    for (const g of games) {
      const key = `${g.system}/${g.name}`;
      if (g.app || queued.has(key) || Date.now() - (missed.get(key) || 0) < 86400e3) continue;
      if (playlistFor(g.system, g.ext)) { queue.push({ system: g.system, name: g.name, ext: g.ext }); queued.add(key); }
    }
    pump();
  }
  function setAuto(mode) {
    settings.auto = mode === "libretro" ? "libretro" : "off";
    if (settings.auto === "off") queue.length = 0;
    missed.clear();
    try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch {}
  }
  // Manual cover from the owner (an image file's bytes). Replaces an earlier manual cover for that game.
  function saveManual(system, name, buf) {
    const ext = imgExt(buf);
    if (!ext) throw new Error("That isn't a PNG, JPEG or WebP image.");
    const d = coverDir(system); fs.mkdirSync(d, { recursive: true });
    for (const e of ["png", "jpg", "webp"]) { try { fs.unlinkSync(path.join(d, `${safe(name)}.manual.${e}`)); } catch {} }
    fs.writeFileSync(path.join(d, `${safe(name)}.manual.${ext}`), buf);
    dirLists.delete(safe(system));
  }
  function removeManual(system, name) {
    let n = 0;
    for (const e of ["png", "jpg", "webp"]) { try { fs.unlinkSync(path.join(coverDir(system), `${safe(name)}.manual.${e}`)); n++; } catch {} }
    dirLists.delete(safe(system));
    return n > 0;
  }
  const status = () => ({ auto: settings.auto, queued: queue.length, fetching: running, fetched });
  return { find, file, want, setAuto, saveManual, removeManual, status, playlistFor };
}
