// Retro netplay hub server.
// - Local accounts: each browser holds its own Ed25519 key; the server only verifies a signed one-time
//   challenge and issues a session cookie. No passwords, no account database: nothing about accounts is stored.
// - Every host sets its own lobby password; guests must know it to join that lobby
// - Owner-only ROM library (ROMS_DIR): unlocked by ADMIN_KEYS (account IDs) or the ADMIN_PASSWORD unlock
// - EmulatorJS served locally; missing cores are fetched once from the official CDN and cached (CORES_CACHE)
// - Room signaling + live open-rooms list over WebSocket (/ws)
// - COOP/COEP/CORP headers so SharedArrayBuffer (threaded cores) works
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { n64Id, findCheatFiles } from "./core/library/cheats.mjs";
import * as RomHack from "./core/library/romhack.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createNative, nativeSystems, emuDirOf } from "./core/streaming/native.mjs";
import * as Online from "./core/online/check.mjs";
import { gbaGame, findGbaBios } from "./core/streaming/gba.mjs";
import { createDiscovery, createMasterPool } from "./core/net/discovery.mjs";
import { createLink, sha1File, LINK_PORT } from "./core/net/link.mjs";
import { createRetroAchievements } from "./core/net/retroachievements.mjs";
import { createCovers } from "./core/net/covers.mjs";
import { DESCRIPTOR_EXTS, isBios, switchExtra, partsIn, wiiuTitle, descriptorFiles, zipBundle } from "./core/library/rules.mjs";
import os from "node:os";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const NATIVE_SYSTEMS = nativeSystems(path.dirname(fileURLToPath(import.meta.url)), process.env.EMULATORS_DIR);
const ROMS_DIR = path.resolve(process.env.ROMS_DIR || path.join(ROOT, "roms"));
const CORES_CACHE = path.resolve(process.env.CORES_CACHE || path.join(ROOT, "cache", "cores"));
const CACHE_DIR = path.dirname(CORES_CACHE);      // cache/ (Docker: /cache): covers and RetroAchievements lists live here too
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_PLAYERS = Math.min(4, Math.max(2, Number(process.env.MAX_PLAYERS || 4)));
const LIBRARY_ACCESS = process.env.LIBRARY_ACCESS === "all" ? "all" : "admin";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
// Public address of this hub (e.g. a Cloudflare tunnel). Invite links use it, so a host who opened the hub
// on localhost still copies a link that works for friends. Only a plain https?://host[:port] origin is accepted.
const PUBLIC_URL = (() => {
  const raw = String(process.env.PUBLIC_URL || "").trim();
  if (!raw) return "";
  try { const u = new URL(raw); if (u.protocol === "https:" || u.protocol === "http:") return u.origin; } catch {}
  console.warn(`PUBLIC_URL ${JSON.stringify(raw)} is not an http(s) address; ignoring it.`);
  return "";
})();
const EJS_VERSION = "4.2.3";
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const CTRL_RE = /[\x00-\x1f<>]/g;

// ---------------------------------------------------------------- auth
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";   // optional server-wide access code
// Placeholder passwords from old examples count as unset, so a copied sample config never opens the library.
const WEAK_ADMIN = new Set(["change-me", "change-me-owner", "changeme", "owner", "password", "admin"]);
const ADMIN_PASSWORD = (() => {
  const p = process.env.ADMIN_PASSWORD || "";
  if (p && (WEAK_ADMIN.has(p.toLowerCase()) || p.length < 8)) {
    console.warn("ADMIN_PASSWORD is a placeholder or shorter than 8 characters; ignoring it. Set a real one in .env.");
    return "";
  }
  return p;
})();
const ADMIN_KEYS = new Set((process.env.ADMIN_KEYS || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean));
if (!ADMIN_PASSWORD && !ADMIN_KEYS.size) console.warn("Neither ADMIN_KEYS nor ADMIN_PASSWORD is set; nobody can use the server ROM library.");
// Cookie signing key: SESSION_SECRET, else a random key kept next to the core cache so sessions survive restarts
// (a host mid-game would otherwise be sent back to the account page).
function loadSecret() {
  if (process.env.SESSION_SECRET) return crypto.createHash("sha256").update(process.env.SESSION_SECRET).digest();
  const file = path.join(path.dirname(CORES_CACHE), "session.key");
  try { const k = fs.readFileSync(file); if (k.length === 32) return k; } catch {}
  const k = crypto.randomBytes(32);
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, k, { mode: 0o600 }); }
  catch (e) { console.warn(`Could not save ${file} (${e.code}); everyone will be signed out when the server restarts.`); }
  return k;
}
const SECRET = loadSecret();
const SESSION_DAYS = 30;

const sha = s => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => b !== "" && crypto.timingSafeEqual(sha(a), sha(b));
const sign = data => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");

function makeToken(name, role, id) {
  const body = Buffer.from(JSON.stringify({ n: name, r: role, k: id, e: Date.now() + SESSION_DAYS * 864e5 })).toString("base64url");
  return body + "." + sign(body);
}
const setSession = (req, res, name, role, id) => res.setHeader("Set-Cookie",
  `hub=${makeToken(name, role, id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? "; Secure" : ""}`);

// One-time challenges for the key handshake: nonce -> expiry
const challenges = new Map();
const CHALLENGE_MS = 120e3;
function newChallenge() {
  if (challenges.size > 5000) { const now = Date.now(); for (const [k, v] of challenges) if (v < now) challenges.delete(k); }
  if (challenges.size > 5000) return null;
  const nonce = crypto.randomBytes(24).toString("base64url");
  challenges.set(nonce, Date.now() + CHALLENGE_MS);
  return nonce;
}
const B64U = /^[A-Za-z0-9_-]+$/;
// Accounts are Ed25519 keys (tweetnacl in the browser, so it also works over plain-HTTP LAN addresses).
// Account ID = first 16 hex chars of SHA-512 over the raw public key, shown to users as ABCD-EF01-2345-6789.
const accountId = pubBytes => crypto.createHash("sha512").update(pubBytes).digest("hex").slice(0, 16).toUpperCase();
function verifyHello(body) {
  const { pub, nonce, sig } = body || {};
  if (typeof pub !== "string" || pub.length !== 43 || !B64U.test(pub)) return null;
  if (typeof nonce !== "string" || typeof sig !== "string" || sig.length !== 86 || !B64U.test(sig)) return null;
  const exp = challenges.get(nonce);
  challenges.delete(nonce);
  if (!exp || exp < Date.now()) return null;
  try {
    const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pub }, format: "jwk" });
    const ok = crypto.verify(null, Buffer.from(`retro-hub-login\n${nonce}`), key, Buffer.from(sig, "base64url"));
    return ok ? accountId(Buffer.from(pub, "base64url")) : null;
  } catch { return null; }
}
function readSession(req) {
  const m = /(?:^|;\s*)hub=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const [body, mac] = m[1].split(".");
  if (!body || !mac) return null;
  const expect = sign(body);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString());
    return s.e > Date.now() && s.k ? { name: s.n, role: s.r, id: s.k } : null;
  } catch { return null; }
}
const canLibrary = s => !!s && (s.role === "admin" || LIBRARY_ACCESS === "all");
// Behind a proxy every visitor arrives from the proxy's address, so rate limits would lump everyone together.
// Forwarded headers are trusted with TRUST_PROXY=1, or automatically when the proxy runs on this same computer
// (loopback peer: a local cloudflared / Caddy / nginx). Cloudflare's CF-Connecting-IP wins over X-Forwarded-For.
function clientIp(req) {
  const peer = req.socket.remoteAddress;
  if (!TRUST_PROXY && !isLoopback(req)) return peer;
  const cf = String(req.headers["cf-connecting-ip"] || "").trim();
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (cf || xff).slice(0, 64) || peer;
}
const isHttps = req => !!req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").startsWith("https");

const failures = new Map(); // ip -> { n, until }
const rateLimited = ip => { const f = failures.get(ip); return !!f && f.n >= 10 && f.until > Date.now(); };
function noteFailure(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { n: 1, until: Date.now() + 15 * 60e3 });
  else f.n++;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of failures) if (v.until < now) failures.delete(k); }, 60e3).unref();

// ---------------------------------------------------------------- systems
// EmulatorJS system ids; recognised by folder name first, then by unambiguous extension.
// Browser (EmulatorJS) consoles: core/browser-systems.json (the Retro Hub window reads it too).
const SYSTEMS = JSON.parse(fs.readFileSync(path.join(ROOT, "core", "browser-systems.json"), "utf8")).systems;

// Native emulators and PC games (core/runner/catalog.json + emulators/apps.json, run by apps.py): they run on the
// host's computer, not in the browser. A built-in EmulatorJS console with the same id is never replaced.
for (const [id, s] of Object.entries(NATIVE_SYSTEMS)) if (!SYSTEMS[id]) SYSTEMS[id] = { label: s.label, ext: s.ext, dirs: s.dirs, native: true };
const native = createNative({ root: ROOT, emulatorsDir: process.env.EMULATORS_DIR });
// Folder names each built-in emulator is found in (emulators/<folder>/), so "Check for Emus" can spot unknown folders.
const NATIVE_FOLDERS = (() => {
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "core", "runner", "catalog.json"), "utf8"));
    return Object.fromEntries(Object.entries(cat.emulators || {}).map(([id, e]) => [id, e.folders || [id]]));
  } catch { return {}; }
})();
const LOCAL_ONLY = "Library folders can only be changed by the owner, from a browser on the hub's own computer.";
const ONLINE_LOCAL = "Online services are set up on the hub's own computer: only the owner can do it, from a browser on that computer.";
const COOP_LOCAL = "Co-op ROM hacks play in Project64 on the hub's computer: only the owner can set them up, from a browser on that computer.";
const COOP_FILE = path.join(ROOT, "core", "coop-hacks.json");
const PATCHES_DIR = path.join(ROOT, "patches");       // the owner's patch files (never shipped, kept by the updater)
const isNativeSys = id => !!SYSTEMS[id]?.native;
// Taken by any console whose folder they're in (they say nothing about the console themselves).
const AMBIGUOUS = ["zip", "7z", "bin", "iso", "img"];
// Disc descriptors: several consoles use them, so only the folder decides (a stray .cue is never guessed as PS1).
const FOLDER_ONLY = new Set(["cue", "ccd", "m3u"]);
const norm = s => s.toLowerCase().replace(/[\s_.-]/g, "");
const EXT_TO_SYS = {}, DIR_TO_SYS = {};
for (const [id, s] of Object.entries(SYSTEMS)) {
  // First console wins an extension: built-in browser consoles come first, so a native alternative for the same
  // files (melonDS for .nds) only takes games from its own folders (dirs / library folder), never all of them.
  for (const e of s.ext) if (!EXT_TO_SYS[e] && !FOLDER_ONLY.has(e)) EXT_TO_SYS[e] = id;
  for (const d of s.dirs) DIR_TO_SYS[norm(d)] = id;
}
const ROM_EXTS = new Set([...Object.keys(EXT_TO_SYS), ...AMBIGUOUS, ...FOLDER_ONLY]);
const COVER_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

// Can console `sys` take a file with this extension? Consoles without their own extensions (CD / arcade sets)
// take any ambiguous one (.zip .bin .iso ...).
// Archives (.zip .7z) only for consoles whose emulator opens them: EmulatorJS does (any browser console), most
// native emulators don't (Cemu, PCSX2, Dolphin need the game file), unless their catalog lists zip / 7z.
const ARCHIVES = new Set(["zip", "7z"]);
const takesExt = (sys, ext) => !!SYSTEMS[sys] && (SYSTEMS[sys].ext.includes(ext)
  || (AMBIGUOUS.includes(ext) && !(ARCHIVES.has(ext) && isNativeSys(sys))));
// The console a folder is named for (it or a folder above it), if any.
function dirSystem(rel) {
  const parts = String(rel || "").split("/");
  for (let i = parts.length - 1; i >= 0; i--) { const sys = DIR_TO_SYS[norm(parts[i])]; if (sys) return sys; }
  return null;
}
function detectSystem(relPath) {
  const ext = path.extname(relPath).slice(1).toLowerCase();
  const parts = relPath.split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    const sys = DIR_TO_SYS[norm(parts[i])];
    if (!sys) continue;
    // A folder named for one console holding another console's files (a .gbc in gb/, a .gb in gba/): the file's
    // own console wins, so Game Boy, Game Boy Color and GBA stay apart.
    if (!SYSTEMS[sys].ext.length || takesExt(sys, ext) || !EXT_TO_SYS[ext]) return sys;
    return EXT_TO_SYS[ext];
  }
  return EXT_TO_SYS[ext] || null;
}

// Per-console library folders, set by the owner in the hub ("Library folders"). A game in one of them gets the
// path "@<console>/<file inside it>"; everything else stays relative to ROMS_DIR.
const LIB_FOLDERS_FILE = path.join(ROOT, "library-folders.json");
let libFolders = {};
try {
  const raw = JSON.parse(fs.readFileSync(LIB_FOLDERS_FILE, "utf8"));
  for (const [k, v] of Object.entries(raw || {})) if (SYSTEMS[k] && typeof v === "string" && path.isAbsolute(v)) libFolders[k] = path.resolve(v);
} catch {}
function saveLibFolders() {
  const tmp = LIB_FOLDERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(libFolders, null, 2) + "\n");
  fs.renameSync(tmp, LIB_FOLDERS_FILE);
}
// Games the owner hid from the library (BIOS files, duplicates, bad dumps): library paths in library-hidden.json.
// Nothing on disk is moved or changed; the owner can show and unhide them any time.
// Kept in the hub folder; where that can't be written (Docker: /app is read-only for the server), in the cache volume.
const LIB_HIDDEN_FILE = (() => {
  const own = path.join(ROOT, "library-hidden.json");
  try { fs.accessSync(ROOT, fs.constants.W_OK); return own; } catch {}
  return fs.existsSync(own) ? own : path.join(CACHE_DIR, "library-hidden.json");
})();
let libHidden = new Set();
try { libHidden = new Set((JSON.parse(fs.readFileSync(LIB_HIDDEN_FILE, "utf8")) || []).filter(x => typeof x === "string").slice(0, 50000)); } catch {}
function saveLibHidden() {
  const tmp = LIB_HIDDEN_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify([...libHidden].sort(), null, 2) + "\n");
  fs.renameSync(tmp, LIB_HIDDEN_FILE);
}
// Library path -> file on disk (null when it points outside its folder).
function romFile(rel) {
  const m = /^@([a-z0-9]{1,20})\/(.+)$/i.exec(rel);
  if (!m) return safeJoin(ROMS_DIR, rel);
  const base = libFolders[m[1]];
  return base ? safeJoin(base, m[2]) : null;
}

let libCache = { at: 0, list: [], gen: 0 };
// New auto covers: update the listed games' covers in place (a local cache lookup), instead of rescanning the
// library, which on a big network drive means reading every folder again. A cover next to the ROM still wins.
const coverArt = createCovers({ cacheDir: CACHE_DIR, onChange: () => {
  for (const g of libCache.list) {
    if (g.app || (g.cover && !g.cover.startsWith("~cache/"))) continue;
    const c = coverArt.find(g.system, g.name);
    g.cover = c ? "~cache/" + c : null;
  }
} });
const retroAch = await createRetroAchievements({ cacheDir: CACHE_DIR });
// Library entry + file on disk for a library path (owner / library users only).
function libEntry(rel, session) {
  if (!canLibrary(session)) return null;
  const entry = scanLibrary().find(g => g.path === String(rel || "") && !g.app);
  const file = entry && romFile(entry.path);
  return file ? { entry, file, system: entry.system, ext: entry.ext } : null;
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
// The library scan reads the disk without blocking the hub (a big library on a network drive can take a minute),
// so lobbies, chat and streams keep running while it works. scanLibrary() answers at once from the last scan and
// starts a new one in the background when that is over 30 s old; library() waits for the first scan, and
// library(true) for one that sees every change made so far (folders, covers).
let libGen = 1, libScan = null, libFoldersGen = 0;     // libFoldersGen: the library has to be rescanned before it is shown
const invalidateLibrary = () => { libGen++; libCache.at = 0; };
const scanProgress = { active: false, found: 0, since: 0 };      // shown in the library tab while the first scan runs
function refreshLibrary() {
  if (!libScan) libScan = scanLibraryNow().catch(e => { scanProgress.active = false; console.warn(`Library scan failed: ${e.message}`); })
    .finally(() => { libScan = null; });
  return libScan;
}
function scanLibrary() {
  if (Date.now() - libCache.at >= 30e3) refreshLibrary();
  return libCache.list;
}
async function library(fresh = false) {
  const want = fresh ? libGen : 1;
  for (let i = 0; i < 3 && libCache.gen < want; i++) await refreshLibrary();    // a scan already running may predate the change
  return scanLibrary();
}
// At most this many folder reads / file stats at a time: fast on network drives without flooding them.
const IO_SLOTS = 16;
let ioBusy = 0; const ioWait = [];
async function io(fn) {
  if (ioBusy >= IO_SLOTS) await new Promise(r => ioWait.push(r));
  ioBusy++;
  try { return await fn(); } finally { ioBusy--; ioWait.shift()?.(); }
}
const readDir = d => io(() => fs.promises.readdir(d, { withFileTypes: true })).catch(() => null);
async function scanLibraryNow() {
  const gen = libGen, t0 = Date.now();
  Object.assign(scanProgress, { active: true, found: 0, since: t0 });
  // Optional cover art: "<game>.png|jpg|jpeg|webp" next to the ROM, or in a covers/ boxart/ media/ subfolder.
  const imagesIn = async (dir, rel, entries) => {
    const map = new Map();
    const add = (es, r) => {
      for (const e of es || []) if (e.isFile() && COVER_EXTS.has(path.extname(e.name).slice(1).toLowerCase()))
        map.set(e.name.replace(/\.[^.]+$/, "").toLowerCase(), r ? r + "/" + e.name : e.name);
    };
    add(entries, rel);
    const subs = entries.filter(e => e.isDirectory() && /^(covers|boxart|media)$/i.test(e.name));
    for (const sub of subs) add(await readDir(path.join(dir, sub.name)), rel ? rel + "/" + sub.name : sub.name);
    return map;
  };
  // forced: a console's own library folder, so every matching file in it is that console's.
  // Returns this folder's games, then its subfolders' (in name order, so the result doesn't depend on timing).
  // Rules (core/library/rules.mjs): one entry per game; tracks, Wii U folder contents, BIOS files, Switch updates
  // and DLC are left out. hidden: files a descriptor (.cue .gdi .m3u ...) uses, by lowercased absolute path.
  const hidden = new Set();
  const walk = async (dir, rel, depth, forced) => {
    const entries = await readDir(dir);
    if (!entries) return [];
    // A Wii U game extracted to a folder (code/ content/ meta/): the folder is the game; nothing inside is listed.
    const ctx = forced || dirSystem(rel);
    if ((!ctx || ctx === "wiiu") && entries.some(e => e.isDirectory() && e.name.toLowerCase() === "code")) {
      const t = await wiiuTitle(dir, entries);
      if (t?.skip) return [];
      if (t) {
        const r = (rel ? rel + "/" : "") + t.rpx, covers = await imagesIn(dir, rel, entries);
        const local = covers.get(t.name.toLowerCase()), cached = local ? null : coverArt.find("wiiu", t.name);
        scanProgress.found++;
        return [{ abs: path.join(dir, ...t.rpx.split("/")), game: { path: r, name: t.name, ext: "rpx", system: "wiiu", size: 0,
          cover: local || (cached ? "~cache/" + cached : null), ...(isNativeSys("wiiu") ? { native: true } : {}) } }];
      }
    }
    const names = entries.filter(e => e.isFile() && !e.name.startsWith(".")).map(e => e.name);
    if (names.some(n => /\.(cue|ccd|gdi|m3u|cia)$/i.test(n))) for (const h of await partsIn(dir, names)) hidden.add(h);
    const files = [], subdirs = [];
    let covers = null;
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const r = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) {
        if (depth < 5 && !/^(bios|covers|boxart|media)$/i.test(d.name) && !(ctx === "wiiu" && /^(code|content|meta)$/i.test(d.name)))
          subdirs.push([path.join(dir, d.name), r]);
        continue;
      }
      if (!d.isFile()) continue;
      const ext = path.extname(d.name).slice(1).toLowerCase();
      if (!ROM_EXTS.has(ext) || isBios(d.name) || hidden.has(path.join(dir, d.name).toLowerCase())) continue;
      // In a console's own folder: its files are that console's. Another console's files (a .gbc in the Game Boy
      // folder) go to that console, unless it has a folder of its own (then they are listed from there).
      const other = EXT_TO_SYS[ext];
      const system = forced ? (takesExt(forced, ext) ? forced : other && !libFolders[other] ? other : null) : detectSystem(r);
      if (!system) continue;
      if (system === "switch" && switchExtra(d.name)) continue;          // updates and DLC aren't games
      if (system === "wiiu" && /\[0005000[ce][0-9a-f]{8}\]|\[(update|dlc)\b/i.test(d.name)) continue;
      if (ARCHIVES.has(ext) && isNativeSys(system) && !SYSTEMS[system].ext.includes(ext)) continue;   // its emulator can't open it
      let name = d.name.replace(/\.[^.]+$/, "");
      // A loose Wii U .rpx (main.rpx): named after its folder (the one above code/), not "main".
      if (ext === "rpx") { const up = rel.split("/"); if (/^code$/i.test(up[up.length - 1] || "")) up.pop(); name = (up.pop() || name).replace(/\s*\[(game|update|dlc|[0-9a-f]{16})\]/gi, "").trim() || name; }
      if (system === "ps3" && ext === "bin") {
        // PS3 games are folders: list <Game>/PS3_GAME/USRDIR/EBOOT.BIN (or <Game>/USRDIR/EBOOT.BIN) as "<Game>".
        if (d.name.toLowerCase() !== "eboot.bin") continue;
        const up = r.split("/").slice(0, -1);
        if (up.pop()?.toUpperCase() !== "USRDIR") continue;
        if (up[up.length - 1]?.toUpperCase() === "PS3_GAME") up.pop();
        name = up[up.length - 1] || name;
      }
      covers = covers || await imagesIn(dir, rel, entries);
      const local = covers.get(name.toLowerCase());
      const cached = local ? null : coverArt.find(system, name);      // a cover next to the ROM wins
      scanProgress.found++;
      files.push({ abs: path.join(dir, d.name), game: { path: r, name, ext, system, size: 0, cover: local || (cached ? "~cache/" + cached : null),
        ...(isNativeSys(system) ? { native: true } : {}) } });
    }
    // Size on disk; for a .cue / .gdi / .m3u, the whole game (it and every file it uses), not just the sheet.
    await Promise.all(files.map(f => DESCRIPTOR_EXTS.has(f.game.ext)
      ? io(() => descriptorFiles(f.abs)).then(parts => { f.game.size = parts.reduce((n, p) => n + p.size, 0); }, () => {})
      : io(() => fs.promises.stat(f.abs)).then(st => { f.game.size = st.size; }, () => {})));
    subdirs.sort(([a], [b]) => a.localeCompare(b));
    const below = await Promise.all(subdirs.map(([d, r]) => walk(d, r, depth + 1, forced)));
    return files.concat(...below);
  };
  // Browser consoles' folders first, then native ones: when two consoles share a folder (GBA and VBA-M link,
  // DS and melonDS), its games are listed once, under the browser console; "Console" when hosting picks the emulator.
  const roots = Object.entries(libFolders).sort(([a], [b]) => isNativeSys(a) - isNativeSys(b)).map(([sys, dir]) => [dir, "@" + sys, sys]);
  roots.push([ROMS_DIR, "", undefined]);
  const found = await Promise.all(roots.map(([dir, rel, sys]) => walk(dir, rel, 0, sys)));
  const seen = new Set(), out = [];
  for (const f of found.flat()) {
    const key = f.abs.toLowerCase();
    if (seen.has(key)) continue;        // a console folder inside ROMS_DIR, or two consoles sharing a folder: list each game once
    seen.add(key); out.push(f.game);
  }
  // Multi-track .bin dumps without a .cue: list track 1 only (with a .cue, the .cue is the entry and the tracks are hidden).
  const list = out.filter(r => !(r.ext === "bin" && /\(track 0*([2-9]|\d{2,})\)/i.test(r.name)));
  list.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  list.push(...native.pcGames());     // PC games registered with apps.py (no file in the ROM folder)
  libCache = { at: Date.now(), list, gen };
  scanProgress.active = false;
  const secs = (Date.now() - t0) / 1000;
  if (secs > 5) console.log(`Library: ${list.length} games scanned in ${secs.toFixed(1)} s.`);
  coverArt.want(list.filter(g => !g.cover && !g.app));      // auto covers (when the owner turned them on)
  return list;
}

// ---------------------------------------------------------------- "What's new" (CHANGELOG.md sections)
const verNum = v => String(v || "").split(".").map(n => parseInt(n, 10) || 0).reduce((a, n) => a * 1000 + n, 0);
// The changelog's markdown, subset: ### headings, "- " bullets, **bold**, `code`. Everything is escaped first.
function mdLite(md) {
  const inline = t => t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  let html = "", list = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const li = /^\s*- (.*)$/.exec(line);
    if (li) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (list && /^\s+\S/.test(line)) { html = html.replace(/<\/li>$/, " " + inline(line.trim()) + "</li>"); continue; }    // wrapped bullet
    if (list) { html += "</ul>"; list = false; }
    const h = /^###\s+(.*)$/.exec(line);
    if (h) html += `<h4>${inline(h[1])}</h4>`;
    else if (line.trim()) html += `<p>${inline(line.trim())}</p>`;
  }
  return html + (list ? "</ul>" : "");
}
function whatsNew(since) {
  let text = ""; try { text = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"); } catch { return []; }
  const out = [];
  for (const part of text.split(/^## /m).slice(1)) {
    const [head, ...body] = part.split(/\r?\n/);
    const m = /^(\d+\.\d+\.\d+)\s*-?\s*(.*)$/.exec(head.trim());
    if (!m || verNum(m[1]) <= verNum(since)) continue;
    out.push({ version: m[1], date: m[2], html: mdLite(body.join("\n")) });
    if (out.length >= 3) break;
  }
  return out;
}

// ---------------------------------------------------------------- speedrun.com lookup (offsite link)
// "Super Mario World (USA) [!]" -> "Super Mario World": region / dump tags aren't part of speedrun.com's names.
// "Legend of Zelda, The - A Link to the Past" (No-Intro style) -> "The Legend of Zelda - A Link to the Past".
const cleanGameName = n => String(n || "").replace(/^[0-9A-F]{8}__/i, "").replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/_/g, " ")
  .replace(/\s+/g, " ").trim().replace(/^(.+?), (The|A|An)(?= - |$)/i, "$2 $1").slice(0, 100);
const srcCache = new Map();        // name -> { at, value }
async function speedrunFind(name) {
  const key = name.toLowerCase(), hit = srcCache.get(key);
  if (hit && Date.now() - hit.at < 864e5) return hit.value;
  const search = `https://www.speedrun.com/search?q=${encodeURIComponent(name)}`;
  let value = { url: null, search };
  // speedrun.com writes subtitles with a colon ("The Legend of Zelda: A Link to the Past"): try that too.
  for (const q of [...new Set([name, name.replace(/ - /g, ": ")])]) {
    try {
      const r = await fetch(`https://www.speedrun.com/api/v1/games?name=${encodeURIComponent(q)}&max=5`,
        { headers: { "User-Agent": `RetroHub/${APP_VERSION}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const games = (await r.json())?.data || [];
      const g = games.find(x => String(x?.names?.international || "").toLowerCase() === q.toLowerCase()) || games[0];
      const url = String(g?.weblink || "");
      if (/^https:\/\/www\.speedrun\.com\/[A-Za-z0-9_-]+$/.test(url)) { value = { url, title: String(g.names?.international || name).slice(0, 100), search }; break; }
    } catch {}
  }
  if (srcCache.size > 500) srcCache.clear();
  srcCache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------- static files
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".swf": "application/x-shockwave-flash",
  ".jar": "application/java-archive", ".jad": "text/vnd.sun.j2me.app-descriptor",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".zip": "application/zip", ".7z": "application/x-7z-compressed",
};
function baseHeaders(res) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self), fullscreen=(self), gamepad=(self)");
}
// Only this server's own scripts run: no inline scripts or handlers, no other hosts, and connections go to this
// server only ('self' covers its ws:/wss: socket too; it also blocks EmulatorJS's update check to its CDN).
// 'wasm-unsafe-eval' lets the emulator compile its WebAssembly cores; blob: is where EmulatorJS puts the core's
// unpacked script and its workers. 'unsafe-eval' is needed only because EmulatorJS's bundled 7-Zip decompressor
// (data/compression/extract7z.js, old Emscripten output) calls eval() inside a blob worker, which inherits this
// policy. Without it, cores never finish "Decompress Game Core".
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  // ws://localhost:* : the optional LiveSplit Server mirror (race / speedrun timer), on the player's own PC only.
  "connect-src 'self' blob: data: ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const CHEERPJ = "https://cjrtnc.leaningtech.com";
const CSP_J2ME = CSP.replace("script-src 'self'", `script-src 'self' ${CHEERPJ}`)
  .replace("connect-src 'self'", `connect-src 'self' ${CHEERPJ}`).replace("worker-src 'self'", `worker-src 'self' ${CHEERPJ}`)
  .replace("style-src 'self'", `style-src 'self' ${CHEERPJ}`) + `; frame-src ${CHEERPJ}`;
// Flash / J2ME pages: the owner's games in one folder. "<dir>/<Game name>/<files>" (folder name = title, its biggest
// .<ext> = the game, a .png/.jpg/.webp = cover) or loose .<ext> files. Paths are relative to <dir>.
async function ownerGames(base, ext) {
  const games = [], isGame = n => n.toLowerCase().endsWith("." + ext);
  const stat = p => fs.promises.stat(p).catch(() => null);
  let ents = [];
  try { ents = await fs.promises.readdir(base, { withFileTypes: true }); } catch {}
  for (const e of ents) {
    if (e.isFile() && isGame(e.name)) {
      const st = await stat(path.join(base, e.name));
      games.push({ name: e.name.slice(0, -ext.length - 1).replace(/[_-]+/g, " "), file: e.name, size: st?.size || 0 });
    } else if (e.isDirectory()) {
      let inner = [];
      try { inner = await fs.promises.readdir(path.join(base, e.name), { withFileTypes: true }); } catch { continue; }
      let game = null, cover = null;
      for (const f of inner) {
        if (!f.isFile()) continue;
        if (isGame(f.name)) {
          const st = await stat(path.join(base, e.name, f.name));
          if (st && (!game || st.size > game.size)) game = { name: f.name, size: st.size };
        } else if (!cover && /\.(png|jpe?g|webp)$/i.test(f.name)) cover = f.name;
      }
      if (game) games.push({ name: e.name, file: `${e.name}/${game.name}`, size: game.size, ...(cover ? { cover: `${e.name}/${cover}` } : {}) });
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  return games.slice(0, 2000);
}
function safeJoin(base, urlPath) {
  const p = path.resolve(base, "." + path.posix.normalize("/" + urlPath));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}
function sendFile(req, res, file, cache = "no-cache", onMissing) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (onMissing) return onMissing();
      res.writeHead(404); return res.end("Not found");
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache };
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${st.size}` });
      return req.method === "HEAD" ? res.end() : fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    req.method === "HEAD" ? res.end() : fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- core cache (official CDN, pinned version)
const CORE_FILE_RE = /^(?:[a-z0-9_]+(?:-thread)?(?:-legacy)?-wasm\.data|reports\/[a-z0-9_]+\.json)$/;
const inflight = new Map();
function fetchCore(rel) {
  if (inflight.has(rel)) return inflight.get(rel);
  const dest = path.join(CORES_CACHE, rel);
  const url = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/cores/${rel}`;
  const p = new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + ".part-" + process.pid;
    https.get(url, { timeout: 30e3 }, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`CDN ${r.statusCode} for ${rel}`)); }
      const out = fs.createWriteStream(tmp);
      r.pipe(out);
      out.on("finish", () => { fs.renameSync(tmp, dest); console.log(`cached core ${rel}`); resolve(dest); });
      out.on("error", e => { fs.rmSync(tmp, { force: true }); reject(e); });
      r.on("error", e => { out.destroy(); fs.rmSync(tmp, { force: true }); reject(e); });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("CDN timeout")); });
  }).finally(() => inflight.delete(rel));
  inflight.set(rel, p);
  return p;
}
function serveCore(req, res, rel) {
  const cache = "public, max-age=86400";
  sendFile(req, res, path.join(PUBLIC_DIR, "data", "cores", rel), cache,
    () => sendFile(req, res, path.join(CORES_CACHE, rel), cache,
      () => fetchCore(rel).then(f => sendFile(req, res, f, cache))
        .catch(e => { console.warn(e.message); res.writeHead(404); res.end(); })));
}

// ---------------------------------------------------------------- ScummVM (scummvm.html, /scummvm/)
// The official Emscripten build of ScummVM, prebuilt by chkuendig/scummvm-demo, is ~700 MB (every engine plugin,
// icons, fonts), so it isn't shipped: core/scummvm-files.json pins one commit and lists each file with its git blob
// hash. A file is downloaded from GitHub the first time something asks for it, checked, and kept in cache/scummvm/.
const SCUMMVM = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "core", "scummvm-files.json"), "utf8")); } catch { return null; } })();
const SCUMMVM_CACHE = path.join(path.dirname(CORES_CACHE), "scummvm", SCUMMVM?.commit || "none");
const svmInflight = new Map();
function fetchScummvm(rel) {
  if (svmInflight.has(rel)) return svmInflight.get(rel);
  const [size, sha] = SCUMMVM.files[rel];
  const dest = path.join(SCUMMVM_CACHE, ...rel.split("/"));
  const url = `https://raw.githubusercontent.com/${SCUMMVM.repo}/${SCUMMVM.commit}/${rel.split("/").map(encodeURIComponent).join("/")}`;
  const p = new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + ".part-" + process.pid;
    https.get(url, { timeout: 60e3 }, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`GitHub ${r.statusCode} for ScummVM ${rel}`)); }
      const h = crypto.createHash("sha1").update(`blob ${size}\0`);
      let got = 0;
      const out = fs.createWriteStream(tmp);
      r.on("data", c => { h.update(c); got += c.length; });
      r.pipe(out);
      out.on("finish", () => {
        if (got !== size || h.digest("hex") !== sha) { fs.rmSync(tmp, { force: true }); return reject(new Error(`ScummVM ${rel}: download doesn't match the pinned hash`)); }
        fs.renameSync(tmp, dest); resolve(dest);
      });
      out.on("error", e => { fs.rmSync(tmp, { force: true }); reject(e); });
      r.on("error", e => { out.destroy(); fs.rmSync(tmp, { force: true }); reject(e); });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("GitHub timeout")); });
  }).finally(() => svmInflight.delete(rel));
  svmInflight.set(rel, p);
  return p;
}
function serveScummvm(req, res, rel) {
  const dest = path.join(SCUMMVM_CACHE, ...rel.split("/"));
  const cache = "public, max-age=86400";
  sendFile(req, res, dest, cache, () => fetchScummvm(rel).then(f => sendFile(req, res, f, cache))
    .catch(e => { console.warn(e.message); res.writeHead(502); res.end(); }));
}
// ScummVM's web file system reads an index.json in each folder: { "file": size, "subfolder": {} }.
async function svmIndex(dir) {
  const out = {};
  let ents = [];
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) {
    if (e.name === "index.json" || e.name.startsWith(".")) continue;
    if (e.isDirectory()) out[e.name] = {};
    else if (e.isFile()) { const st = await fs.promises.stat(path.join(dir, e.name)).catch(() => null); if (st) out[e.name] = st.size; }
  }
  return out;
}

// ---------------------------------------------------------------- HTTP
const PUBLIC_PATHS =new Set(["/login.html", "/icon.svg", "/login.js", "/theme.js", "/account.js", "/vendor/nacl-fast.min.js", "/style.css",
  "/api/challenge", "/favicon.ico"]);
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
function iceServers() {
  const list = (process.env.STUN_URLS || "stun:stun.l.google.com:19302")
    .split(",").map(s => s.trim()).filter(Boolean).map(urls => ({ urls }));
  if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL.split(",").map(s => s.trim()),
    username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" });
  return list;
}

const server = http.createServer(async (req, res) => {
  baseHeaders(res);
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { res.writeHead(400); return res.end(); }

  // OBS browser source: /overlay/queue (page) and /api/overlay (its data). Only from this computer and not through
  // a tunnel / proxy (those add forwarding headers), so no account is needed and nothing is exposed online.
  if (urlPath === "/overlay/queue" || urlPath === "/overlay.js" || urlPath === "/api/overlay") {
    const h = req.headers;
    if (!isLoopback(req) || h["cf-connecting-ip"] || h["x-forwarded-for"] || h["x-real-ip"] || h["forwarded"]) { res.writeHead(403); return res.end("Only on the hub's own computer."); }
    if (urlPath === "/api/overlay") return json(res, 200, overlayData(cleanCode(new URL(req.url, "http://x").searchParams.get("room"))));
    return sendFile(req, res, path.join(PUBLIC_DIR, urlPath === "/overlay.js" ? "overlay.js" : "overlay.html"), "no-cache");
  }
  if (urlPath === "/api/challenge" && req.method === "GET") {
    const nonce = newChallenge();
    if (!nonce) return json(res, 503, { error: "Server busy. Try again in a minute." });
    return json(res, 200, { nonce, accessCode: !!ACCESS_PASSWORD });
  }
  if (urlPath === "/api/hello" && req.method === "POST") {
    const ip = clientIp(req);
    if (rateLimited(ip)) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    const name = String(body.name || "").replace(CTRL_RE, "").trim().slice(0, 20);
    if (!name) return json(res, 400, { error: "Your account needs a name." });
    if (ACCESS_PASSWORD && !same(String(body.access || ""), ACCESS_PASSWORD)) {
      noteFailure(ip); return json(res, 401, { error: "Wrong server access code.", code: "access" });
    }
    const id = verifyHello(body);
    // Not counted toward the IP lockout: a bad signature can't be guessed into a good one, and one broken account
    // in a browser must not block every other account on that computer for 15 minutes.
    if (!id) return json(res, 401, { error: "The server couldn't verify this account's key. Reload the page and try again; if it keeps failing, remove the account and import a backup." });
    failures.delete(ip);
    const role = ADMIN_KEYS.has(id) ? "admin" : "user";
    setSession(req, res, name, role, id);
    return json(res, 200, { ok: true, name, role, id });
  }
  if (urlPath === "/api/unlock" && req.method === "POST") {
    const s = readSession(req);
    if (!s) return json(res, 401, { error: "Login required" });
    const ip = clientIp(req);
    if (rateLimited(ip)) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    if (!same(String(body.password || ""), ADMIN_PASSWORD)) { noteFailure(ip); return json(res, 401, { error: "Wrong owner password." }); }
    failures.delete(ip);
    setSession(req, res, s.name, "admin", s.id);
    return json(res, 200, { ok: true });
  }
  // Master lobby pool (MASTER_SERVER=1): other hubs register their lobbies here; anyone may read the list.
  if (masterPool && urlPath === "/api/master/heartbeat" && req.method === "POST") {
    let body; try { body = JSON.parse(await readBody(req, 16384)); } catch { return json(res, 400, { error: "Bad request" }); }
    const r = masterPool.heartbeat(body, clientIp(req));
    return json(res, r.status, r.error ? { error: r.error } : { ok: true });
  }
  if (masterPool && urlPath === "/api/master/lobbies" && req.method === "GET") return json(res, 200, { lobbies: masterPool.lobbies() });
  // GBA link cable, hub to hub on this network: another hub asks for (or gives back) a seat in our session.
  // 🌐 Online services: Cemu setup actions (see GET /api/online below). Owner, on the hub's own computer.
  if (urlPath === "/api/online/cemu" && req.method === "POST") {
    const session = readSession(req);
    if (!localOwner(req, session) || !sameOrigin(req) || req.headers["x-retro-hub"] !== "online") return json(res, 403, { error: ONLINE_LOCAL });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    try {
      if (body.action === "import") return json(res, 200, { ...(await native.pretendoImport(typeof body.from === "string" ? body.from.trim().slice(0, 500) : "")),
        status: await native.pretendoStatus(true) });
      if (body.action === "service") return json(res, 200, { ...(await native.pretendoEnable({ service: String(body.service || "pretendo"),
        proxy: typeof body.proxy === "string" ? body.proxy.slice(0, 200) : undefined })), status: await native.pretendoStatus(true) });
      return json(res, 400, { error: "Unknown action" });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  // 🗡️ Owner on this computer: open Dolphin set up for GBA netplay (Four Swords Adventures, everyone on their own PC).
  if (urlPath === "/api/online/dolphin-netplay" && req.method === "POST") {
    const session = readSession(req);
    if (!localOwner(req, session) || !sameOrigin(req) || req.headers["x-retro-hub"] !== "online") return json(res, 403, { error: ONLINE_LOCAL });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    const bios = findGbaBios(ROOT);
    if (!bios.path) return json(res, 409, { error: bios.error });
    const ping = Number(body.ping) || 0;
    // Pad buffer: one unit = one frame (16.7 ms at 60 fps). Highest ping / 15, plus one frame of slack, as Dolphin's guide suggests.
    const buffer = ping > 0 ? Math.max(1, Math.min(40, Math.ceil(ping / 15) + 1)) : 0;
    try {
      const r = await native.dolphinNetplay({ bios: bios.path, players: Math.max(1, Math.min(4, Number(body.players) || 4)),
        nickname: String(session?.name || "").slice(0, 30), hostCode: String(body.hostCode || "").trim().slice(0, 8), buffer });
      return json(res, 200, { ok: true, buffer: buffer || null, settings: r.settings });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  // Owner on this computer: switch Cemu's active account to the Pretendo network service (backs up settings.xml).
  if (urlPath === "/api/pretendo/enable" && req.method === "POST") {
    const s = readSession(req);
    if (!localOwner(req, s) || req.headers["x-retro-hub"] !== "pretendo") return json(res, 403, { error: "Only the owner, on the hub's own computer, can change Cemu's settings." });
    try { await native.pretendoEnable(); return json(res, 200, { ok: true, ...(await native.pretendoStatus(true)) }); }
    catch (e) { return json(res, 409, { error: e.message }); }
  }
  if ((urlPath === "/api/link/claim" || urlPath === "/api/link/release") && req.method === "POST") {
    if (!directLan(req)) return json(res, 403, { error: "Link cable sessions only work between computers on the same network." });
    const ip = req.socket.remoteAddress;
    if (linkThrottled(ip)) return json(res, 429, { error: "Too many requests" });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    const r = urlPath === "/api/link/claim" ? link.claim(body, ip) : link.release(body);
    if (r.status === 200) discovery.lobbiesChanged();
    const { status, ...rest } = r;
    return json(res, status, rest);
  }
  // Owner on this computer: host a link session, join one found on the LAN, or leave.
  if ((urlPath === "/api/link/host" || urlPath === "/api/link/join" || urlPath === "/api/link/stop") && req.method === "POST") {
    const s = readSession(req);
    if (!localOwner(req, s) || req.headers["x-retro-hub"] !== "link") return json(res, 403, { error: "Link sessions can only be started by the owner, from a browser on the hub's own computer." });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    if (urlPath === "/api/link/stop") {
      if (link.joined) releaseSeat(link.joined);
      link.stop("stopped by the owner");
      native.stopGame();
      discovery.lobbiesChanged();
      return json(res, 200, { ok: true });
    }
    const lib = await library();
    try {
      if (urlPath === "/api/link/host") {
        const entry = lib.find(g => g.path === String(body.path || "") && isGbaGame(g));
        const file = entry && romFile(entry.path);
        if (!file) return json(res, 404, { error: "Pick a .gba, .gb or .gbc game from the server library." });
        const players = Math.max(2, Math.min(4, Number(body.players) | 0 || 4));
        const sha1 = await sha1File(file);
        if (link.joined) releaseSeat(link.joined);
        link.stop("replaced");
        await native.launch({ ...entry, system: "gbalink" }, file, { host: lanIp(), port: LINK_PORT, players, role: "server" });
        linkHostName = s.name;
        const h = link.host({ game: entry.name, system: entry.ext === "gba" ? "gba" : "gb", sha1, size: entry.size, players });
        discovery.lobbiesChanged();
        return json(res, 200, { ok: true, lobbyId: h.lobbyId, slot: 0, players, port: LINK_PORT, ip: lanIp() });
      }
      // join
      const l = discovery.list().find(x => x.is_lan && x.link && x.lobby_id === String(body.lobby_id || ""));
      if (!l) return json(res, 404, { error: "That link session isn't on the network any more." });
      const hostBase = new URL(l.connection_string).origin, hostIp = new URL(l.connection_string).hostname;
      let entry = null, file = null;
      for (const g of lib.filter(g => isGbaGame(g) && g.size === l.link.size)) {
        const f = romFile(g.path);
        if (f && await sha1File(f).catch(() => "") === l.link.sha1) { entry = g; file = f; break; }
      }
      if (!entry) return json(res, 404, { error: `You don't have this exact ROM ("${l.game_title}"). Link cables need the same file as the host: add it to your library (same SHA-1).` });
      const r = await fetch(`${hostBase}/api/link/claim`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lobby_id: l.lobby_id, hub: discovery.hubId, name: s.name, sha1: l.link.sha1 }), signal: AbortSignal.timeout(6000) });
      const seat = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 409, { error: seat.error || `The host's hub said ${r.status}.` });
      const port = Number.isInteger(seat.port) && seat.port > 0 && seat.port < 65536 ? seat.port : LINK_PORT;
      const players = Math.max(2, Math.min(4, Number(seat.players) | 0 || 2));
      await native.launch({ ...entry, system: "gbalink" }, file, { host: hostIp, port, players, role: "client" });
      link.setJoined({ lobbyId: l.lobby_id, game: l.game_title, host: l.host_name, hostIp, hostBase, slot: seat.slot, players, port });
      return json(res, 200, { ok: true, slot: seat.slot, players, host: hostIp, port });
    } catch (e) { return json(res, 409, { error: e.message || "Couldn't start the link session." }); }
  }
  if (urlPath === "/api/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", "hub=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return json(res, 200, { ok: true });
  }
  // Shut the whole server down. Allowed for (a) stop.py on this same computer, which proves itself with the
  // random token in run/retro-hub.json and must connect over loopback, or (b) a signed-in owner (admin)
  // pressing "Shut down server" (custom header = no cross-site form can trigger it).
  if (urlPath === "/api/shutdown" && req.method === "POST") {
    const s = readSession(req);
    const byToken = isLoopback(req) && typeof req.headers["x-shutdown-token"] === "string"
      && same(req.headers["x-shutdown-token"], SHUTDOWN_TOKEN);
    const byAdmin = s?.role === "admin" && req.headers["x-retro-hub"] === "shutdown";
    if (!byToken && !byAdmin) return json(res, 403, { error: "Not allowed." });
    json(res, 202, { ok: true });
    return shutdown(byAdmin ? `the owner (${s.name}) shut the server down` : "stop script");
  }
  // Native emulators: start / stop a game on this computer. Owner only, from a browser on this same computer
  // (it has to capture the emulator's window anyway), and a custom header so no other site can trigger it.
  if ((urlPath === "/api/native/launch" || urlPath === "/api/native/stop" || urlPath === "/api/native/window") && req.method === "POST") {
    const s = readSession(req);
    if (!localOwner(req, s) || req.headers["x-retro-hub"] !== "native") return json(res, 403, { error: "Native emulators can only be started by the owner, from a browser on the hub's own computer." });
    if (urlPath === "/api/native/stop") return json(res, 200, { ok: true, stopped: native.stopGame() });
    if (urlPath === "/api/native/window") {
      let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
      return native.setWindow(!!b.show) ? json(res, 200, { ok: true }) : json(res, 409, { error: "No headless game is running." });
    }
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    // body.system: the console the host picked for this game ("Console" in Host a game). Any native console that
    // takes the file's extension can run it, so a GBA game from the browser folders can be played in VBA-M
    // (gbalink), a DS game in melonDS (ndsnative), and a game listed under a native console in another emulator.
    const want = String(body.system || "");
    const findIn = list => list.find(g => g.path === String(body.path || ""));
    // A game added since the last scan (or a PC game just added with apps.py) is found after a fresh one.
    const found = findIn(await library()) || findIn(await library(true));
    let entry = null;
    if (found?.app) entry = found;
    else if (found && want && want !== found.system) {
      if (!isNativeSys(want)) return json(res, 400, { error: `${SYSTEMS[want]?.label || "That console"} plays in the browser, not in a native emulator.` });
      if (!takesExt(want, found.ext)) return json(res, 400, { error: `${SYSTEMS[want].label} can't run .${found.ext} files.` });
      entry = { ...found, system: want };
    } else if (found?.native) entry = found;
    // 🤝 Co-op ROM hack: launch a patched copy (cache/coop/) with the hack's Project64 cheats switched on.
    let coop = null;
    if (body.coop && found && !found.app) {
      try {
        coop = await RomHack.prepareCoop({ hacks: await RomHack.loadHacks(COOP_FILE), romPath: romFile(found.path),
          hackId: String(body.coop.hack || ""), variantId: String(body.coop.variant || ""), patchesDir: PATCHES_DIR,
          coopDir: path.join(CACHE_DIR, "coop"), emuDirs: [process.env.EMULATORS_DIR, path.join(ROOT, "emulators")] });
      } catch (e) { return json(res, 409, { error: e.message }); }
      entry = { ...found, system: coop.system, name: coop.name };
    }
    const file = coop ? coop.file : entry && (entry.app ? null : romFile(entry.path));
    if (!entry || (!entry.app && !file)) return json(res, 404, { error: "That game isn't in the library (or isn't for a native emulator)." });
    // 🗡️ GBA screens mode (Four Swords Adventures...): Dolphin with every port as an integrated GBA.
    let gba = null;
    if (body.gba) {
      const g = entry.system && ["gc"].includes(entry.system) ? gbaGame(file) : null;
      if (!g) return json(res, 400, { error: "GBA screens mode is for GameCube games that use Game Boy Advance controllers." });
      const bios = findGbaBios(ROOT);
      if (!bios.path) return json(res, 409, { error: bios.error });
      gba = { bios: bios.path, players: Math.max(1, Math.min(g.players, Number(body.gba.players) || g.players)) };
    }
    try { return json(res, 200, { ok: true, ...(await native.launch(entry, file, null, { headless: !!body.headless, gba })),
      ...(gba ? { gba: { players: gba.players } } : {}),
      ...(coop ? { coop: { name: coop.name, cheats: coop.cheats?.count || 0 } } : {}) }); }
    catch (e) { return json(res, 409, { error: e.message }); }
  }
  // Owner, from a browser on the hub's own computer (it names folders on this PC): set or clear a console's folder.
  if (urlPath === "/api/library/folders" && req.method === "POST") {
    const s = readSession(req);
    if (!localOwner(req, s) || req.headers["x-retro-hub"] !== "library") return json(res, 403, { error: LOCAL_ONLY });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    const sys = String(body.system || "");
    if (!SYSTEMS[sys] || sys === "pc") return json(res, 400, { error: "Unknown console." });
    if (body.dir) {
      const dir = path.resolve(String(body.dir));
      let st; try { st = fs.statSync(dir); } catch {}
      if (!st?.isDirectory()) return json(res, 400, { error: "That folder doesn't exist." });
      libFolders[sys] = dir;
    } else delete libFolders[sys];
    try { saveLibFolders(); } catch (e) { return json(res, 500, { error: `Couldn't save ${path.basename(LIB_FOLDERS_FILE)}: ${e.code || e.message}` }); }
    invalidateLibrary(); libFoldersGen = libGen; refreshLibrary();
    return json(res, 200, { ok: true, dir: libFolders[sys] || null });
  }
  // Owner: hide a game from the library or show it again (custom header: no other site can send this).
  if (urlPath === "/api/library/hide" && req.method === "POST") {
    const s = readSession(req);
    if (s?.role !== "admin" || req.headers["x-retro-hub"] !== "library" || !sameOrigin(req)) return json(res, 403, { error: "Only the owner can hide games." });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Bad request" }); }
    const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).map(String).filter(p => p && p.length < 1024).slice(0, 500);
    if (!paths.length) return json(res, 400, { error: "No game given." });
    for (const p of paths) body.hidden ? libHidden.add(p) : libHidden.delete(p);
    try { saveLibHidden(); } catch (e) { return json(res, 500, { error: `Couldn't save ${path.basename(LIB_HIDDEN_FILE)}: ${e.code || e.message}` }); }
    return json(res, 200, { ok: true, hidden: libHidden.size });
  }
  if (urlPath.startsWith("/api/covers") && req.method === "POST") {
    const session = readSession(req);
    if (session?.role !== "admin" || req.headers["x-retro-hub"] !== "covers" || !sameOrigin(req)) return json(res, 403, { error: "Only the owner can change covers." });
    try {
      if (urlPath === "/api/covers") {
        const body = JSON.parse(await readBody(req));
        coverArt.setAuto(body.auto);
        coverArt.want(libCache.list.filter(g => !g.cover && !g.app));      // queue the missing covers (no rescan needed)
        return json(res, 200, coverArt.status());
      }
      const q = new URL(req.url, "http://x").searchParams;
      const le = libEntry(q.get("path"), session);
      if (!le) return json(res, 404, { error: "That game isn't in the library." });
      if (urlPath === "/api/covers/upload") coverArt.saveManual(le.system, le.entry.name, await readRaw(req, 8 * 1024 * 1024));
      else if (urlPath === "/api/covers/remove") coverArt.removeManual(le.system, le.entry.name);
      else return json(res, 404, { error: "Not found" });
      // Update the listed cover now (a cover next to the ROM still wins); the next scan picks it up anyway.
      const g = libCache.list.find(x => x.path === le.entry.path);
      if (g && (!g.cover || g.cover.startsWith("~cache/"))) { const c = coverArt.find(g.system, g.name); g.cover = c ? "~cache/" + c : null; }
      return json(res, 200, { ok: true, cover: g?.cover || null });
    } catch (e) { return json(res, 400, { error: e.message === "too big" ? "That image is too big (8 MB max)." : e.message || "Bad request" }); }
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }

  const session = readSession(req);
  if (!session && !PUBLIC_PATHS.has(urlPath)) {
    if (urlPath === "/" || urlPath.endsWith(".html")) {
      res.writeHead(302, { Location: "/login.html?next=" + encodeURIComponent(req.url) }); return res.end();
    }
    return json(res, 401, { error: "Login required" });
  }

  if (urlPath === "/api/me") return json(res, 200, { ...session, library: canLibrary(session), version: APP_VERSION,
    canUnlock: !!ADMIN_PASSWORD && session.role !== "admin" });
  if (urlPath === "/api/config") return json(res, 200, { iceServers: iceServers(), maxPlayers: MAX_PLAYERS, publicUrl: PUBLIC_URL,
    systems: Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.label])),
    nativeSystems: Object.keys(SYSTEMS).filter(isNativeSys),
    // Extensions each console takes (Host a game only offers consoles that can run the picked game), and the
    // EmulatorJS core for consoles whose id isn't one (gbc -> gambatte).
    systemExts: Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.ext])), ambiguousExts: AMBIGUOUS,
    cores: Object.fromEntries(Object.entries(SYSTEMS).filter(([, v]) => v.core).map(([k, v]) => [k, v.core])),
    detect: { ext: EXT_TO_SYS, dirs: DIR_TO_SYS } });
  if (urlPath === "/api/native") {
    if (!localOwner(req, session)) return json(res, 200, { available: false,
      reason: "Native emulators (PS2, GameCube, Wii, PS3, Xbox 360, Wii U) can only be hosted by the owner, from a browser on the hub's own computer." });
    return json(res, 200, { available: true, ...(await native.status()) });
  }
  // 🗡️ Is this library game a GBA-controller game (Four Swords Adventures...)? And is the owner's GBA BIOS there?
  if (urlPath === "/api/native/gba") {
    if (!localOwner(req, session)) return json(res, 200, { available: false });
    const le = libEntry(new URL(req.url, "http://x").searchParams.get("path"), session);
    if (!le || le.system !== "gc") return json(res, 200, { available: true, game: null });
    const g = gbaGame(le.file);
    if (!g) return json(res, 200, { available: true, game: null });
    const bios = findGbaBios(ROOT);
    const st = await native.status().catch(() => null);
    return json(res, 200, { available: true, game: g, bios: { ok: !!bios.path, error: bios.error || null },
      pads: st?.bridge || null });
  }
  if (urlPath === "/api/pretendo") {
    if (!localOwner(req, session)) return json(res, 200, { available: false });
    const st = await native.pretendoStatus(new URL(req.url, "http://x").searchParams.has("fresh"));
    return json(res, 200, { available: !!st, ...(st || {}) });
  }
  if (urlPath === "/api/link") {
    if (!localOwner(req, session)) return json(res, 200, { available: false });
    const st = await native.status();
    return json(res, 200, { available: true, installed: !!st.systems?.gbalink?.installed, ip: lanIp(), ...link.status() });
  }
  // "Check for Emus": every emulator the hub knows, and each folder in the emulators folder, installed or not.
  if (urlPath === "/api/emulators") {
    const st = await native.status();
    const known = new Set();
    const list = Object.entries(st.emulators).map(([id, e]) => {
      for (const f of NATIVE_FOLDERS[id] || [id]) known.add(String(f).toLowerCase());
      const systems = Object.values(st.systems).filter(s => s.emulator === id).map(s => s.label);
      return { id, label: e.label, installed: !!e.installed, custom: !!e.custom, systems };
    });
    let extra = [];
    try {
      extra = fs.readdirSync(st.folder, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith(".") && !known.has(d.name.toLowerCase()))
        .map(d => ({ id: d.name, label: d.name, installed: false, unknown: true, systems: [] }));
    } catch {}
    return json(res, 200, { ok: !!st.runner?.ok, error: st.runner?.ok ? null : st.runner?.error || null,
      emulators: [...list, ...extra], ...(session.role === "admin" ? { folder: st.folder } : {}) });
  }
  // Library folders menu: every console and the folder it reads from.
  if (urlPath === "/api/library/folders") {
    if (session.role !== "admin") return json(res, 403, { error: "Unlock the library first." });
    return json(res, 200, { canEdit: localOwner(req, session), romsDir: ROMS_DIR,
      systems: Object.entries(SYSTEMS).filter(([id]) => id !== "pc").map(([id, s]) => ({ id, label: s.label, native: !!s.native,
        dir: libFolders[id] || null, defaultDirs: s.dirs.slice(0, 3) })) });
  }
  // Folder picker for that menu: lists sub-folders only (never files), owner on the hub's own computer.
  if (urlPath === "/api/fs/dirs") {
    if (!localOwner(req, session)) return json(res, 403, { error: LOCAL_ONLY });
    const want = new URL(req.url, "http://x").searchParams.get("dir") || "";
    if (!want) {   // start: drives (Windows) or /, plus handy places
      const roots = process.platform === "win32"
        ? "CDEFGHIJKLMNOPQRSTUVWXYZAB".split("").map(l => l + ":\\").filter(d => { try { fs.accessSync(d); return true; } catch { return false; } })
        : ["/"];
      const home = process.env.USERPROFILE || process.env.HOME || "";
      return json(res, 200, { dir: "", parent: null, dirs: [...roots, ROMS_DIR, ...(home ? [home] : [])].map(p => ({ name: p, path: p })) });
    }
    const dir = path.resolve(want);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return json(res, 400, { error: `Can't open that folder (${e.code}).` }); }
    const dirs = entries.filter(d => { try { return d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("$"); } catch { return false; } })
      .map(d => ({ name: d.name, path: path.join(dir, d.name) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const parent = path.dirname(dir);
    return json(res, 200, { dir, parent: parent === dir ? "" : parent, dirs: dirs.slice(0, 2000) });
  }
  // RetroAchievements (read-only Web API through the hub, each player's own key): core/net/retroachievements.mjs
  if (urlPath.startsWith("/api/ra/") && req.method === "GET") {
    return retroAch.handle(req, res, urlPath, session, { json, sendFile, libFile: (p, s) => libEntry(p, s) });
  }
  // Off Site Games tab: links to games on other websites. The owner's offsite-games.json (main folder) replaces the
  // default core/offsite-games.json. Only https links get through; the page opens them in a new tab, no referrer.
  if (urlPath === "/api/offsite-games" && req.method === "GET") {
    const own = path.join(ROOT, "offsite-games.json");
    let data = null, custom = false;
    try { data = JSON.parse(fs.readFileSync(own, "utf8")); custom = true; }
    catch (e) { if (e.code !== "ENOENT") console.warn(`offsite-games.json: ${e.message}; using the default list.`); }
    if (!data) { try { data = JSON.parse(fs.readFileSync(path.join(ROOT, "core", "offsite-games.json"), "utf8")); } catch { data = {}; } }
    const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
    const games = (Array.isArray(data.games) ? data.games : []).map(g => {
      let url = ""; try { const u = new URL(String(g?.url || "")); if (u.protocol === "https:") url = u.href; } catch {}
      return { name: clean(g?.name, 80), url, category: clean(g?.category, 40) || "Other", note: clean(g?.note, 240), touch: g?.touch === true };
    }).filter(g => g.name && g.url).slice(0, 500);
    return json(res, 200, { games, custom });
  }
  // Flash page (flash.html): the owner's .swf games in <roms>/swf. One folder per game ("swf/<Game name>/<files>",
  // the folder name is the title, its biggest .swf is the game, a .png/.jpg in it is the cover) or loose .swf files.
  // Same access rule as the ROM library. Files are served from /flash/<path inside swf/>.
  // J2ME page (j2me.html) works the same way with <roms>/j2me (.jar games; a .jad next to it is listed too).
  if ((urlPath === "/api/flash-games" || urlPath === "/api/j2me-games") && req.method === "GET") {
    if (!canLibrary(session)) return json(res, 200, { games: [], locked: true });
    const j2me = urlPath === "/api/j2me-games";
    return json(res, 200, { games: await ownerGames(path.join(ROMS_DIR, j2me ? "j2me" : "swf"), j2me ? "jar" : "swf") });
  }
  // PC page (x86.html, v86): every folder in <roms>/x86 is one machine/game. Its disks: .iso = CD, .img/.ima/.vfd/.flp
  // up to 2.88 MB = floppy, bigger = hard disk; .v86state = a saved snapshot to resume from. Served from /x86/<path>.
  if (urlPath === "/api/x86-games" && req.method === "GET") {
    if (!canLibrary(session)) return json(res, 200, { games: [], locked: true });
    const base = path.join(ROMS_DIR, "x86"), games = [];
    let ents = [];
    try { ents = await fs.promises.readdir(base, { withFileTypes: true }); } catch {}
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      let inner = [];
      try { inner = await fs.promises.readdir(path.join(base, e.name), { withFileTypes: true }); } catch { continue; }
      const disks = []; let cover = null;
      for (const f of inner) {
        if (!f.isFile()) continue;
        const ext = path.extname(f.name).slice(1).toLowerCase();
        if (!cover && /^(png|jpe?g|webp)$/.test(ext)) { cover = `${e.name}/${f.name}`; continue; }
        const st = await fs.promises.stat(path.join(base, e.name, f.name)).catch(() => null);
        if (!st) continue;
        const kind = ext === "iso" ? "cdrom" : ext === "v86state" ? "state"
          : /^(img|ima|vfd|flp)$/.test(ext) ? (st.size <= 2949120 ? "fda" : "hda") : null;
        if (kind) disks.push({ file: `${e.name}/${f.name}`, kind, size: st.size });
      }
      if (disks.some(d => d.kind !== "state")) games.push({ name: e.name, disks, ...(cover ? { cover } : {}) });
    }
    games.sort((a, b) => a.name.localeCompare(b.name));
    return json(res, 200, { games: games.slice(0, 2000) });
  }
  if (urlPath.startsWith("/x86/")) {
    if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
    const f = safeJoin(path.join(ROMS_DIR, "x86"), urlPath.slice(5));
    if (!f || !/\.(img|ima|vfd|flp|iso|v86state|png|jpe?g|webp)$/i.test(f)) { res.writeHead(404); return res.end(); }
    return sendFile(req, res, f, "private, no-cache");
  }
  // ScummVM page: every folder in <roms>/scummvm is one game (its data files dumped inside; ScummVM detects it).
  if (urlPath === "/api/scummvm-games" && req.method === "GET") {
    if (!canLibrary(session)) return json(res, 200, { games: [], locked: true });
    const base = path.join(ROMS_DIR, "scummvm"), games = [];
    let ents = [];
    try { ents = await fs.promises.readdir(base, { withFileTypes: true }); } catch {}
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      let inner = [];
      try { inner = await fs.promises.readdir(path.join(base, e.name), { withFileTypes: true }); } catch { continue; }
      const cover = inner.find(f => f.isFile() && /^(cover|folder|box)\.(png|jpe?g|webp)$/i.test(f.name));
      games.push({ name: e.name, files: inner.length, ...(cover ? { cover: `${e.name}/${cover.name}` } : {}) });
    }
    games.sort((a, b) => a.name.localeCompare(b.name));
    return json(res, 200, { games: games.slice(0, 2000), ready: !!SCUMMVM });
  }
  if (urlPath.startsWith("/flash/")) {
    if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
    const f = safeJoin(path.join(ROMS_DIR, "swf"), urlPath.slice(7));
    if (!f || !/\.(swf|png|jpe?g|webp)$/i.test(f)) { res.writeHead(404); return res.end(); }
    return sendFile(req, res, f, "private, max-age=3600");
  }
  if (urlPath === "/api/whatsnew" && req.method === "GET") {
    const since = String(new URL(req.url, "http://x").searchParams.get("since") || "").slice(0, 20);
    return json(res, 200, { version: APP_VERSION, sections: /^\d+\.\d+\.\d+$/.test(since) ? whatsNew(since) : [] });
  }
  // speedrun.com: the game's page for the Race panel's offsite link. Asked only when a player clicks that link,
  // and only the cleaned-up game name is sent (speedrun.com's public API, no account or key).
  if (urlPath === "/api/speedrun" && req.method === "GET") {
    const name = cleanGameName(new URL(req.url, "http://x").searchParams.get("name"));
    if (!name) return json(res, 400, { error: "No game name." });
    return json(res, 200, await speedrunFind(name));
  }
  // Cover art: auto covers on/off, and covers the owner drops onto a game (core/net/covers.mjs).
  if (urlPath === "/api/covers" && req.method === "GET") {
    if (!canLibrary(session)) return json(res, 403, { error: "Library is owner-only" });
    return json(res, 200, coverArt.status());
  }
  if (urlPath === "/api/library/status") {
    if (!canLibrary(session)) return json(res, 403, { error: "Library is owner-only" });
    return json(res, 200, { ready: libCache.gen > 0, scanning: scanProgress.active, found: scanProgress.found,
      seconds: scanProgress.active ? Math.round((Date.now() - scanProgress.since) / 1000) : 0, games: libCache.list.length });
  }
  // 🧩 Cheats: .cht files near a library game (and its N64 checksum, to pick the right section). core/library/cheats.mjs
  // 🤝 Co-op ROM hacks (core/coop-hacks.json, core/library/romhack.mjs). They play in Project64 on the hub's PC, so
  // only the owner, from a browser on that PC. GET: what this library ROM can be patched into, and whether the
  // patch / cheat files were found. POST patch-file: the owner adds a missing patch (kept only if its SHA-256 is listed).
  // 🌐 Online services (core/online): status of each emulator's game-online service, and Cemu setup actions.
  // Owner on the hub's own PC only: it reads and writes emulator settings on this computer.
  if (urlPath === "/api/online" && req.method === "GET") {
    if (!localOwner(req, session)) return json(res, 403, { error: ONLINE_LOCAL });
    try { return json(res, 200, await Online.onlineStatus({ root: ROOT, emuRoot: emuDirOf(ROOT, process.env.EMULATORS_DIR),
      cemu: () => native.pretendoStatus(true) })); }
    catch (e) { return json(res, 500, { error: `Couldn't check: ${e.message}` }); }
  }
  if (urlPath === "/api/coop" && req.method === "GET") {
    if (!localOwner(req, session)) return json(res, 403, { error: COOP_LOCAL });
    const le = libEntry(new URL(req.url, "http://x").searchParams.get("path"), session);
    if (!le) return json(res, 404, { error: "That game isn't in the library." });
    let id = null; try { id = await RomHack.romIdentity(le.file); } catch {}
    if (!id?.n64) return json(res, 200, { offers: [], notes: [] });
    const { offers, notes } = RomHack.matchHacks(await RomHack.loadHacks(COOP_FILE), id);
    const out = [];
    for (const { hack, exact } of offers) for (const v of hack.variants) {
      const patch = await RomHack.findPatch(v.patch, le.file, PATCHES_DIR);
      const cheats = v.cheats ? await RomHack.findCheats(v.cheats, le.file, PATCHES_DIR) : null;
      out.push({ hack: hack.id, variant: v.id, name: v.name, version: v.version || "", players: v.players, ports: v.ports || null,
        notes: v.notes || "", credit: hack.credit || "", where: hack.where || "", tested: hack.tested || "", base: hack.base.name, exact, system: hack.system || "n64native",
        patch: { file: v.patch.file, format: v.patch.format, found: !!patch },
        cheats: v.cheats ? { file: v.cheats.file, group: v.cheats.group, found: !!cheats } : null });
    }
    return json(res, 200, { offers: out, notes: notes.map(n => ({ hack: n.hack.name, note: n.note })) });
  }
  if (urlPath === "/api/coop/patch-file" && req.method === "POST") {
    if (!localOwner(req, session) || req.headers["x-retro-hub"] !== "coop") return json(res, 403, { error: COOP_LOCAL });
    let data; try { data = await readRaw(req, 16 * 1024 * 1024); } catch { return json(res, 413, { error: "That file is too big for a patch." }); }
    const name = path.basename(String(req.headers["x-file-name"] || "")).replace(/[^\w .()'-]/g, "_").slice(0, 120);
    const hacks = await RomHack.loadHacks(COOP_FILE);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    const v = hacks.flatMap(h => h.variants).find(x => x.patch.sha256 === sha);
    let dest = v ? v.patch.file : null;
    // A cheat list: kept when it has a section and group a listed hack needs.
    if (!dest && /\.cht$/i.test(name) && data.length < 2 * 1024 * 1024) {
      const text = data.toString("latin1");
      if (hacks.flatMap(h => h.variants).some(x => x.cheats && RomHack.parseCheatSection(text, x.cheats.section, x.cheats.group).length)) dest = name || "cheats.cht";
    }
    if (!dest) return json(res, 400, { error: "That isn't a patch (or cheat list) of a co-op hack in the list: its checksum doesn't match. Nothing was saved." });
    fs.mkdirSync(PATCHES_DIR, { recursive: true });
    fs.writeFileSync(path.join(PATCHES_DIR, path.basename(dest)), data);
    return json(res, 200, { ok: true, saved: path.basename(dest), variant: v ? v.name : null });
  }
  if (urlPath === "/api/cheats" && req.method === "GET") {
    const le = libEntry(new URL(req.url, "http://x").searchParams.get("path"), session);
    if (!le) return json(res, 404, { error: "That game isn't in the library." });
    const id = le.system === "n64" ? await n64Id(le.file) : null;
    const files = await findCheatFiles(le.file, path.join(ROOT, "cheats"), id);
    return json(res, 200, { system: le.system, n64: id, files });
  }
  if (urlPath === "/api/library") {
    if (!canLibrary(session)) return json(res, 403, { error: "Library is owner-only" });
    const list = await library(libCache.gen < libFoldersGen);
    // Hidden games are left out; the owner gets them marked (for "Show hidden"), nobody else sees them at all.
    if (session.role === "admin") return json(res, 200, libHidden.size ? list.map(g => libHidden.has(g.path) ? { ...g, hidden: true } : g) : list);
    return json(res, 200, libHidden.size ? list.filter(g => !libHidden.has(g.path)) : list);
  }
  if (urlPath.startsWith("/roms/")) {
    if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
    // The client prefixes the file name with "<account>__" so EmulatorJS keeps a separate in-game save per account
    const f = romFile(urlPath.slice(6).replace(/(^|\/)[0-9A-F]{8}__(?=[^/]+$)/, "$1"));
    const ext = f ? path.extname(f).slice(1).toLowerCase() : "";
    if (!f || !ROM_EXTS.has(ext)) { res.writeHead(404); return res.end(); }
    // A .cue / .ccd / .gdi / .m3u and the files it uses, as one zip: EmulatorJS unpacks it and boots the descriptor.
    if (DESCRIPTOR_EXTS.has(ext)) {
      const parts = await descriptorFiles(f);
      if (!parts.length) { res.writeHead(404); return res.end(); }
      if (parts.length > 1) {
        let zip; try { zip = zipBundle(parts, path.dirname(f)); } catch (e) { res.writeHead(413, { "Content-Type": "text/plain" }); return res.end(e.message); }
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": zip.size, "Cache-Control": "private, no-store" });
        if (req.method === "HEAD") return res.end();
        const { Readable } = await import("node:stream");
        Readable.from(zip.body()).on("error", e => { console.warn(`Sending ${path.basename(f)}: ${e.message}`); res.destroy(); }).pipe(res);
        return;
      }
    }
    return sendFile(req, res, f, "private, no-store");
  }
  if (urlPath.startsWith("/covers/")) {      // library cover art: same access rule as the ROMs
    if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
    const rel = urlPath.slice(8);
    const f = rel.startsWith("~cache/") ? coverArt.file(rel.slice(7)) : romFile(rel);
    if (!f || !COVER_EXTS.has(path.extname(f).slice(1).toLowerCase())) { res.writeHead(404); return res.end(); }
    return sendFile(req, res, f, rel.startsWith("~cache/") ? "private, no-cache" : "private, max-age=3600");
  }
  if (urlPath.startsWith("/data/cores/")) {
    const rel = urlPath.slice("/data/cores/".length);
    if (!CORE_FILE_RE.test(rel)) { res.writeHead(404); return res.end(); }
    return serveCore(req, res, rel);
  }
  // Shuffler: each game runs in its own frame (shuffle-frame.html), so only that page may be framed, and only by
  // this hub's own pages. Everything else stays unframeable.
  // J2ME emulator (public/j2me/ = freej2me-web, GPL-3.0). It runs on CheerpJ, which only loads from Leaning
  // Technologies' servers, so these pages (and only these) may load scripts and data from that one host.
  // /j2me/jar/<path> = the owner's games in <roms>/j2me (run.html?jar=<path>), same access rule as the ROMs.
  if (urlPath === "/j2me") { res.writeHead(302, { Location: "/j2me/" }); return res.end(); }
  if (urlPath.startsWith("/j2me/")) {
    res.setHeader("Content-Security-Policy", CSP_J2ME);
    // CheerpJ runs part of itself in a frame from its host that sends no COEP header, which require-corp would block.
    // freej2me-web doesn't need cross-origin isolation (no SharedArrayBuffer), so these pages go without it.
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    if (urlPath.startsWith("/j2me/jar/")) {
      if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
      const f = safeJoin(path.join(ROMS_DIR, "j2me"), urlPath.slice(10));
      if (!f || !/\.(jar|jad|png|jpe?g|webp)$/i.test(f)) { res.writeHead(404); return res.end(); }
      return sendFile(req, res, f, "private, max-age=3600");
    }
    if (urlPath === "/j2me/run") urlPath = "/j2me/run.html";     // the launcher links to "run?app=..."
  }
  // ScummVM: /scummvm/ = the engine (play.html + scummvm.ini are the hub's own files in public/scummvm/; the rest
  // comes from the pinned build, see fetchScummvm). /scummvm/data/games/ = the owner's games in <roms>/scummvm.
  // ScummVM's virtual /data folder is fetched from the site root (/data/...), where EmulatorJS also lives, so a
  // /data/ request counts as ScummVM's only when it comes from the ScummVM page (Referer, sent on same-origin
  // requests), or carries no Referer and asks for a file only ScummVM has.
  if (urlPath === "/scummvm") { res.writeHead(302, { Location: "/scummvm/play.html" }); return res.end(); }
  let svmRel = null;
  if (SCUMMVM && urlPath.startsWith("/scummvm/")) svmRel = urlPath.slice(9).replace(/^\/+/, "");   // plugins come as /scummvm//data/plugins/…
  else if (SCUMMVM && urlPath.startsWith("/data/") && !urlPath.startsWith("/data/cores/")) {
    let fromPage = false;
    try { fromPage = new URL(req.headers.referer || "", "http://x").pathname.startsWith("/scummvm/"); } catch {}
    const r = urlPath.slice(1);
    if (fromPage || (!req.headers.referer && (r === "data/index.json" || r.startsWith("data/games/") || Object.hasOwn(SCUMMVM.files, r)))) svmRel = r;
  }
  if (svmRel !== null) {
    const rel = svmRel;
    if (rel === "data/games" || rel.startsWith("data/games/")) {
      if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
      const base = path.join(ROMS_DIR, "scummvm"), sub = rel.slice(10).replace(/^\//, "");
      if (sub === "index.json" || sub.endsWith("/index.json")) {
        const dir = safeJoin(base, sub.slice(0, -10));
        const idx = dir && await svmIndex(dir);
        return idx ? json(res, 200, idx) : (res.writeHead(404), res.end());
      }
      const f = safeJoin(base, sub);
      if (!f || f === base) { res.writeHead(404); return res.end(); }
      return sendFile(req, res, f, "private, no-cache");
    }
    if (rel === "data/index.json") {      // the build's list, with games pointing here instead of the demo's host
      const f = path.join(SCUMMVM_CACHE, "data", "index.json");
      try { await fs.promises.access(f); } catch { try { await fetchScummvm("data/index.json"); } catch (e) { console.warn(e.message); res.writeHead(502); return res.end(); } }
      const idx = JSON.parse(await fs.promises.readFile(f, "utf8"));
      idx.games = {};
      return json(res, 200, idx);
    }
    if (Object.hasOwn(SCUMMVM.files, rel)) return serveScummvm(req, res, rel);
  }
  if (urlPath === "/shuffle-frame.html") {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  }
  const f = safeJoin(PUBLIC_DIR, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
  if (!f) { res.writeHead(403); return res.end(); }
  sendFile(req, res, f, f.startsWith(path.join(PUBLIC_DIR, "data")) ? "public, max-age=86400" : "no-cache");
});

// ---------------------------------------------------------------- rooms + signaling (/ws)
// Room phases: lobby -> countdown (3 s, server-timed) -> loading (per-player progress) -> playing.
const rooms = new Map();      // code -> { code, host, owner, pw, reserved:Set, clients:Map, game, system, phase, rules, cd }
const lobbyWatchers = new Set();
let nextId = 1;
const MAX_CLIENTS = 12;       // players + spectators
const COUNTDOWN_MS = 3000;
const WS_RATE_MAX = 200;      // messages per second per socket before it is closed as a flood
const RESUME_MS = 30000;
const CHAT_KEEP = 60;         // messages kept per room for late joiners
const CHAT_MAX = 300;         // characters per message
const CHAT_BURST = 6, CHAT_WINDOW = 8000;   // at most 6 messages per 8 s per player     // a dropped socket keeps its seat, id, ready flag and ROM this long (resume token)
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const session = readSession(req);
  const wsPath = new URL(req.url, "http://x").pathname;
  if (wsPath === "/native-input") {
    // Guest controller state -> virtual gamepads. Same-origin page of the owner on this computer only.
    if (!localOwner(req, session) || !sameOrigin(req)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); return socket.destroy(); }
    return native.handleUpgrade(req, socket, head);
  }
  if (wsPath !== "/ws" || !session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, session, clientIp(req)));
});

const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const roster = room => [...room.clients.values()].map(c => ({ id: c.id, slot: c.slot, name: c.name, key: c.key, host: c === room.host,
  ready: c.ready, progress: c.progress, rtt: c.ws.rtt ?? null, spectator: c.slot < 0, voice: c.voice, rom: c.rom, ghost: c.ghost,
  away: !!c.away, ...(room.rules.race && c.run ? { run: c.run } : {}),
  ...(isStreamer(room) ? { queue: (room.queue || []).indexOf(c.id) + 1 || null, sittingOut: !!c.sittingOut, afk: !!c.afk, keep: !!c.keep,
    muted: !!c.muted, ...(fxOn(room) && c !== room.host ? { points: c.points ?? 0 } : {}), turnLeft: c.turnEnd && c.slot >= 0 ? Math.max(0, c.turnEnd - Date.now()) : null,
    offered: [...(room.offers || [])].find(([, o]) => o.id === c.id)?.[0] ?? null } : {}) }));
// Removes a client for good (left on purpose, or its resume window ran out).
function finalizeLeave(room, c, quiet) {
  clearTimeout(c.awayT); c.awayT = null; c.away = false;
  if (room.clients.get(c.id) !== c) return;
  room.clients.delete(c.id);
  if (room.offers) dropOffers(room, c);
  const wasHost = room.host === c;
  if (wasHost) { room.host = null; room.reserved = new Set(); }
  if (!room.clients.size) { clearTimeout(room.cd); rooms.delete(room.code); return pushRoomList(); }
  if (!quiet) chatSys(room, `${c.name} left.`);
  if (wasHost && promoteHost(room, `${c.name} left.`)) return;
  cancelCountdown(room, `${c.name} left.`);
  checkLoaded(room);
  sendRoster(room);
}
// Host migration: the old host is gone for good, so the connected player in the lowest seat (else a spectator)
// takes over. The game itself only ever lived in the old host's browser, so a running match ends and the room
// goes back to the lobby; the new host picks the game (co-op) or reference ROM (ghost) and starts again.
function promoteHost(room, why) {
  const live = [...room.clients.values()].filter(c => !c.away && !c.left);
  const next = live.filter(c => c.slot >= 0).sort((a, b) => a.slot - b.slot)[0] || live[0];
  if (!next) return false;          // everyone is away: the room waits (the owner can still come back as host)
  const wasRunning = room.phase !== "lobby";
  clearTimeout(room.cd); room.cd = null; room.staged = false;
  if (room.phase === "countdown") broadcast(room, { t: "countdown", cancelled: true, reason: why });
  if (next.slot < 0) next.slot = freeSlot(room, next);
  next.wasSeated = true;
  room.host = next; room.owner = next.key;
  room.reserved = new Set([next.slot]);
  setPhase(room, "lobby");          // also clears everyone's ready state
  send(next, { t: "promoted", wasRunning });
  chatSys(room, `${next.name} is the host now.`);
  broadcast(room, { t: "notice", msg: `${why} ${next.name} is the host now.${wasRunning ? " The match ended; it can be started again from the lobby." : ""}` });
  sendRoster(room);
  return true;
}
const joinedMsg = (room, c, extra) => ({ t: "joined", id: c.id, slot: c.slot, room: room.code, host: room.host === c, phase: room.phase,
  token: c.token, game: room.game, system: room.system, mode: room.rules.mode, ...extra });
const tokenMatch = (a, b) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Single-player ghost mode: every player runs their own ROM; only checksums (never ROM data) reach the server.
const isGhost = room => room.rules.mode === "ghost";
// Shuffle lobbies (Co-op): the host's page runs every game (public/shuffler-core.js) and streams the one whose turn
// it is. The hub only keeps the list (names + consoles) and which game is on, for everyone's screen.
function cleanShuffle(sh) {
  if (!sh || !Array.isArray(sh.games)) return null;
  const games = sh.games.slice(0, 8).map(g => ({ name: cleanText(g?.name, 80), system: SYSTEMS[g?.system] && !isNativeSys(g.system) ? g.system : "" }))
    .filter(g => g.name && g.system);
  return games.length >= 2 ? { games } : null;
}
// ---- Race / speedrun (ghost mode + a shared timer). Splits are stamped by the hub, not the players' clocks:
// time = arrival - GO - half the player's round trip, so nobody's clock (or a slow tab) changes their time.
const MAX_SPLITS = 40;
function cleanSplits(list) {
  if (!Array.isArray(list)) return null;
  return list.map(x => cleanText(x, 40)).filter(Boolean).slice(0, MAX_SPLITS);
}
const raceRunners = room => [...room.clients.values()].filter(c => c.slot >= 0);
const splitCount = room => Math.max(1, room.rules.splits?.length || 0);
const fmtRace = ms => { const t = Math.max(0, Math.round(ms)), h = Math.floor(t / 3600e3), m = Math.floor(t / 60e3) % 60, sec = Math.floor(t / 1e3) % 60;
  return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(sec).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}`; };
function startRace(room) {
  room.goAt = Date.now(); room.raceOver = false;
  for (const c of room.clients.values()) c.run = c.slot >= 0 ? { splits: [], done: null, quit: false } : null;
}
function raceCheckOver(room) {
  const runners = raceRunners(room).filter(c => c.run);
  if (room.raceOver || !runners.length || !runners.every(c => c.run.done != null || c.run.quit)) return;
  room.raceOver = true;
  const order = runners.filter(c => c.run.done != null).sort((a, b) => a.run.done - b.run.done);
  if (runners.length > 1) chatSys(room, `Race over: ${order.map((c, i) => `${i + 1}. ${c.name} ${fmtRace(c.run.done)}`).join(" · ") || "nobody finished"}.`);
}
function raceAct(room, c, act) {
  if (!room.rules.race || room.phase !== "playing" || !room.goAt || !c.run || c.slot < 0) return false;
  const run = c.run, now = Date.now();
  if (act === "split") {
    if (run.done != null || run.quit || now - (c.splitAt || 0) < 300) return false;     // 300 ms: no double-presses
    c.splitAt = now;
    const t = Math.max(0, Math.round(now - room.goAt - Math.min(500, (c.ws.rtt || 0) / 2)));
    run.splits.push(t);
    if (run.splits.length >= splitCount(room)) {
      run.done = t;
      const place = raceRunners(room).filter(x => x.run?.done != null && x.run.done <= t).length;
      chatSys(room, raceRunners(room).length > 1 ? `${c.name} finished ${place}${["th", "st", "nd", "rd"][place % 100 > 10 && place % 100 < 14 ? 0 : place % 10] || "th"} in ${fmtRace(t)}.`
        : `${c.name} finished in ${fmtRace(t)}.`);
      raceCheckOver(room);
    }
    return true;
  }
  if (act === "undo") {
    if (!run.splits.length || run.quit) return false;
    run.splits.pop(); run.done = null; room.raceOver = false;
    return true;
  }
  if (act === "forfeit") {
    if (run.done != null || run.quit) return false;
    run.quit = true;
    if (raceRunners(room).length > 1) chatSys(room, `${c.name} forfeited.`);
    raceCheckOver(room);
    return true;
  }
  if (act === "restart") {          // solo speedrun: reset the clock without leaving (the player resets their game)
    if (raceRunners(room).length !== 1) return false;
    startRace(room);
    return true;
  }
  return false;
}
function cleanRom(r) {
  if (!r || typeof r !== "object") return null;
  const crc = String(r.crc || "").toUpperCase();
  const size = Number(r.size);
  if (!/^[0-9A-F]{8}$/.test(crc) || !Number.isSafeInteger(size) || size <= 0) return null;
  return { crc, size, name: cleanText(r.name, 80) };
}
// Lobby passwords live in memory only, as salted scrypt hashes, for as long as the lobby exists.
function hashLobbyPw(pw) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: crypto.scryptSync(pw, salt, 32) };
}
const checkLobbyPw = (room, pw) => !room.pw || crypto.timingSafeEqual(crypto.scryptSync(String(pw || ""), room.pw.salt, 32), room.pw.hash);
const broadcast = (room, msg) => room.clients.forEach(c => send(c, msg));
// Room chat (text only, kept in memory for as long as the room exists). sys = a hub line, not a player's message.
function chat(room, entry) {
  room.chat = room.chat || []; room.chatSeq = (room.chatSeq || 0) + 1;
  const msg = { n: room.chatSeq, at: Date.now(), ...entry };
  room.chat.push(msg); if (room.chat.length > CHAT_KEEP) room.chat.shift();
  broadcast(room, { t: "chat", msg });
}
const chatSys = (room, text) => chat(room, { sys: true, text });
function chatAllowed(c) {
  const now = Date.now();
  c.chatTimes = (c.chatTimes || []).filter(t => now - t < CHAT_WINDOW);
  if (c.chatTimes.length >= CHAT_BURST) return false;
  c.chatTimes.push(now); return true;
}
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
const cleanText = (s, n) => String(s || "").replace(CTRL_RE, "").trim().slice(0, n);

function freeSlot(room, except) {
  const used = new Set([...room.clients.values()].filter(c => c !== except).map(c => c.slot));
  for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s) && !room.reserved.has(s)) return s;
  return -1;
}
const slotTaken = (room, s) => room.reserved.has(s) || [...room.clients.values()].some(c => c.slot === s);

// ---------------------------------------------------------------- Streamer Mode (waiting room + seat rotation)
// Co-op lobbies only. Everyone who joins starts in the waiting room (a spectator: they already get the stream), in
// line for a seat unless they choose "Sit out". A free guest seat is OFFERED to the first in line ("You're up!");
// they take it within OFFER_MS or are marked away and skipped. Rotating moves the seated guests (except ones the
// host keeps, e.g. a winner) to the back of the line. Optional turn timer. Moving seats is only a new seat -> player
// mapping in the host's page (no reconnect); the host's page releases every button of the seat that changed hands.
const OFFER_MS = 10000, TURN_WARN_MS = 15000;
const isStreamer = room => !!room.streamer?.on;
function streamerQueue(room) {
  room.queue = (room.queue || []).filter(id => {
    const c = room.clients.get(id);
    return c && c.slot < 0 && c !== room.host && !c.left && !c.sittingOut && !c.afk;
  });
  return room.queue;
}
function enqueue(room, c) {
  room.queue = (room.queue || []).filter(id => id !== c.id);
  if (c === room.host || c.sittingOut || c.afk) return;
  room.queue.push(c.id);
}
function dropOffers(room, c) { for (const [slot, o] of room.offers || []) if (o.id === c.id) room.offers.delete(slot); }
// Offer every free guest seat to the next person in line who hasn't got an offer yet.
function fillSeats(room) {
  if (!isStreamer(room) || room.phase === "countdown") return;
  room.offers = room.offers || new Map();
  const offered = new Set([...room.offers.values()].map(o => o.id));
  const line = streamerQueue(room).filter(id => !offered.has(id) && !room.clients.get(id).away);
  for (let slot = 0; slot < MAX_PLAYERS && line.length; slot++) {
    if (slotTaken(room, slot) || room.offers.has(slot)) continue;
    const c = room.clients.get(line.shift());
    room.offers.set(slot, { id: c.id, until: Date.now() + OFFER_MS });
    send(c, { t: "seat-offer", slot, ms: OFFER_MS });
  }
}
function seatFromLine(room, c, slot) {
  c.slot = slot; c.wasSeated = true; c.afk = false; c.warned = false;
  c.turnEnd = room.streamer.turnMin ? Date.now() + room.streamer.turnMin * 60e3 : 0;
  if (room.phase === "lobby") c.ready = "notready";
  else { c.ready = "ready"; c.progress = Math.max(c.progress || 0, 100); }
  room.queue = (room.queue || []).filter(id => id !== c.id);
  chatSys(room, `${c.name} is up: P${slot + 1}.`);
}
function unseat(room, c) {
  c.slot = -1; c.wasSeated = false; c.keep = false; c.muted = false; c.turnEnd = 0; c.warned = false;
  enqueue(room, c);
}
function rotateSeats(room) {
  const line = streamerQueue(room);
  if (!line.length) return "Nobody is waiting for a seat.";
  const going = [...room.clients.values()].filter(c => c !== room.host && c.slot >= 0 && !room.reserved.has(c.slot) && !c.keep).sort((a, b) => a.slot - b.slot);
  if (!going.length) return "No seats to rotate (kept seats stay).";
  for (const c of going) unseat(room, c);
  chatSys(room, `Seat rotation: ${going.map(c => c.name).join(", ")} back to the waiting room.`);
  return "";
}
function streamerMessage(room, me, isHost, m) {
  if ((m.t === "fx" || m.t === "fx-config") && fxMessage(room, me, isHost, m)) return true;
  const target = id => { const c = room.clients.get(Number(id)); return c && c !== room.host ? c : null; };
  switch (m.t) {
    case "streamer": {               // host: on / off, turn timer (minutes, 0 = off); allowed during a match too
      if (!isHost) return true;
      if (typeof m.on === "boolean") {
        if (m.on && (room.rules.mode !== "coop")) { send(me, { t: "notice", msg: "Streamer Mode works with Co-op Netplay lobbies." }); return true; }
        room.streamer = { on: m.on, turnMin: room.streamer?.turnMin || 0, at: Date.now() };
        if (m.on) {
          room.rules.spectators = true;
          room.queue = [];
          for (const c of [...room.clients.values()].filter(c => c.slot < 0).sort((a, b) => a.id - b.id)) enqueue(room, c);
          chatSys(room, "Streamer Mode is on: new players join the waiting room and get a seat in turn.");
        } else { room.offers?.clear(); room.queue = []; if (room.fx) room.fx.on = false; for (const c of room.clients.values()) { c.turnEnd = 0; c.keep = false; } }
      }
      if (m.turnMin !== undefined && room.streamer) {
        const t = [0, 3, 5, 10, 15, 20, 30].includes(Number(m.turnMin)) ? Number(m.turnMin) : 0;
        room.streamer.turnMin = t;
        for (const c of room.clients.values()) if (c.slot >= 0 && c !== room.host) { c.turnEnd = t ? Date.now() + t * 60e3 : 0; c.warned = false; }
      }
      sendRoster(room); return true;
    }
    case "rotate": {
      if (!isHost || !isStreamer(room)) return true;
      const why = rotateSeats(room);
      if (why) send(me, { t: "notice", msg: why });
      sendRoster(room); return true;
    }
    case "seat-back": case "keep": case "mute-input": {
      if (!isHost || !isStreamer(room)) return true;
      const c = target(m.id); if (!c) return true;
      if (m.t === "seat-back" && c.slot >= 0 && !room.reserved.has(c.slot)) { unseat(room, c); chatSys(room, `${c.name} went back to the waiting room.`); }
      if (m.t === "keep") c.keep = !!m.on;
      if (m.t === "mute-input") c.muted = !!m.on;
      sendRoster(room); return true;
    }
    case "queue": {                  // a viewer: wait in line (on) or sit out (off)
      if (!isStreamer(room) || me === room.host) return true;
      me.sittingOut = !m.on; me.afk = false;
      if (me.slot < 0) { if (m.on) enqueue(room, me); else { room.queue = (room.queue || []).filter(id => id !== me.id); dropOffers(room, me); } }
      sendRoster(room); return true;
    }
    case "take": {                   // answer to a seat offer
      if (!isStreamer(room)) return true;
      const slot = Number(m.slot), o = room.offers?.get(slot);
      if (!o || o.id !== me.id) return true;
      room.offers.delete(slot);
      if (m.no) { me.sittingOut = true; room.queue = (room.queue || []).filter(id => id !== me.id); }
      else if (me.slot < 0 && !slotTaken(room, slot)) seatFromLine(room, me, slot);
      sendRoster(room); return true;
    }
  }
  return false;
}
// Once a second: expired offers (skip, mark away), turn warnings and turn ends (only when someone is waiting).
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!isStreamer(room)) continue;
    let changed = false;
    for (const [slot, o] of room.offers || []) {
      if (now < o.until) continue;
      room.offers.delete(slot);
      const c = room.clients.get(o.id);
      if (c) { c.afk = true; send(c, { t: "seat-offer-expired" }); }
      changed = true;
    }
    if (room.streamer.turnMin) {
      const waiting = streamerQueue(room).length > 0;
      for (const c of room.clients.values()) {
        if (!c.turnEnd || c.slot < 0 || c === room.host || c.keep) continue;
        if (!waiting) { if (now > c.turnEnd - TURN_WARN_MS) { c.turnEnd = now + TURN_WARN_MS + 5000; c.warned = false; } continue; }
        if (!c.warned && now >= c.turnEnd - TURN_WARN_MS) { c.warned = true; send(c, { t: "turn-warn", ms: c.turnEnd - now }); }
        if (now >= c.turnEnd) { unseat(room, c); chatSys(room, `${c.name}'s turn is over.`); changed = true; }
      }
    }
    if (changed) sendRoster(room);
  }
}, 1000).unref();
// ---------------------------------------------------------------- Viewer effects (Streamer Mode)
// Viewers earn points while they're in a Streamer Mode lobby and spend them on effects that work on any game:
// controls (applied by the host's page to the seats' input), speed / pause / rewind (EmulatorJS games only) and
// picture effects (CSS on everyone's game view, so they also show on a stream captured from the host's screen).
// One effect per group at a time; each effect has its own cooldown; the host picks which are allowed.
const FX = {
  invert:   { label: "Invert controls", group: "input",  ms: 15000, cost: 3, cd: 45000, native: true },
  swapab:   { label: "Swap A / B",      group: "input",  ms: 20000, cost: 2, cd: 40000, native: true },
  freeze:   { label: "Freeze controls", group: "input",  ms: 4000,  cost: 4, cd: 60000, native: true },
  fast:     { label: "Double speed",    group: "speed",  ms: 15000, cost: 3, cd: 45000, native: false },
  slow:     { label: "Slow motion",     group: "speed",  ms: 15000, cost: 2, cd: 45000, native: false },
  pause:    { label: "Pause",           group: "speed",  ms: 3000,  cost: 3, cd: 60000, native: false },
  rewind:   { label: "Rewind 10 s",     group: "time",   ms: 0,     cost: 5, cd: 90000, native: false },
  flip:     { label: "Upside down",     group: "visual", ms: 15000, cost: 2, cd: 40000, native: true },
  mirror:   { label: "Mirror",          group: "visual", ms: 15000, cost: 2, cd: 40000, native: true },
  gray:     { label: "Black & white",   group: "visual", ms: 20000, cost: 1, cd: 30000, native: true },
  negative: { label: "Invert colors",   group: "visual", ms: 15000, cost: 2, cd: 40000, native: true },
  tiny:     { label: "Tiny screen",     group: "visual", ms: 15000, cost: 2, cd: 40000, native: true },
};
const FX_START_POINTS = 3, FX_MAX_POINTS = 30, FX_EARN_MS = 30000, FX_VIEWER_GAP = 8000;
const fxOn = room => isStreamer(room) && !!room.fx?.on;
const FX_CATALOG = Object.entries(FX).map(([code, e]) => ({ code, label: e.label, group: e.group, cost: e.cost, ms: e.ms, native: e.native }));
function fxState(room) {
  const now = Date.now(), native = isNativeSys(room.system);
  return { on: true, native, effects: Object.entries(FX).filter(([code]) => room.fx.enabled.has(code)).map(([code, e]) => ({ code, label: e.label, group: e.group,
    ms: e.ms, cost: e.cost, ok: native ? e.native : true, cooldown: Math.max(0, (room.fx.cool[code] || 0) - now) })),
    active: Object.values(room.fx.active).filter(a => a.until > now || a.ms === 0).map(a => ({ code: a.code, label: FX[a.code].label, by: a.by, left: Math.max(0, a.until - now) })) };
}
function fxTrigger(room, c, code, isHost) {
  const e = FX[code];
  if (!fxOn(room) || !e || !room.fx.enabled.has(code)) return "That effect isn't available.";
  if (isNativeSys(room.system) && !e.native) return "That effect only works with browser games.";
  if (room.phase !== "playing") return "Effects work once the match is running.";
  const now = Date.now();
  if ((room.fx.cool[code] || 0) > now) return `${e.label} is cooling down (${Math.ceil((room.fx.cool[code] - now) / 1000)} s).`;
  const busy = room.fx.active[e.group];
  if (busy && busy.until > now) return `Wait for ${FX[busy.code].label} to finish.`;
  if (!isHost) {
    if ((c.points ?? 0) < e.cost) return `Not enough points (${e.label} costs ${e.cost}).`;
    if (now - (c.fxAt || 0) < FX_VIEWER_GAP) return "One effect every few seconds, please.";
    c.points -= e.cost; c.fxAt = now;
  }
  room.fx.active[e.group] = { code, by: c.name, until: now + e.ms, ms: e.ms };
  room.fx.cool[code] = now + e.ms + e.cd;
  broadcast(room, { t: "fx", code, ms: e.ms, by: c.name, label: e.label });
  chatSys(room, `🎲 ${c.name}: ${e.label}${e.ms ? ` (${Math.round(e.ms / 1000)} s)` : ""}.`);
  if (!e.ms) delete room.fx.active[e.group];
  return "";
}
function fxMessage(room, me, isHost, m) {
  if (m.t === "fx-config") {
    if (!isHost || !isStreamer(room)) return true;
    room.fx = room.fx || { on: false, enabled: new Set(Object.keys(FX)), active: {}, cool: {} };
    if (typeof m.on === "boolean") {
      room.fx.on = m.on;
      if (m.on) { for (const c of room.clients.values()) if (c.points == null) { c.points = FX_START_POINTS; c.fxEarn = Date.now(); } chatSys(room, "Viewer effects are on: viewers earn points while they watch and spend them on 🎲 effects."); }
    }
    if (Array.isArray(m.enabled)) room.fx.enabled = new Set(m.enabled.filter(code => FX[code]));
    sendRoster(room); return true;
  }
  if (m.t === "fx") {
    const why = fxTrigger(room, me, String(m.code || ""), isHost);
    if (why) send(me, { t: "notice", msg: why });
    sendRoster(room); return true;
  }
  return false;
}
// Points: +1 per 30 s in the lobby (not the host), up to 30. Effects end on time.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!fxOn(room)) continue;
    let changed = false;
    for (const c of room.clients.values()) {
      if (c === room.host || c.away) continue;
      if (c.points == null) { c.points = FX_START_POINTS; c.fxEarn = now; changed = true; continue; }
      if (now - (c.fxEarn || 0) >= FX_EARN_MS) { c.fxEarn = now; if (c.points < FX_MAX_POINTS) { c.points++; changed = true; } }
    }
    for (const [group, a] of Object.entries(room.fx.active)) if (a.until <= now) { delete room.fx.active[group]; broadcast(room, { t: "fx-end", code: a.code }); changed = true; }
    if (changed) sendRoster(room);
  }
}, 1000).unref();

// OBS overlay data (/overlay/queue): only for a browser source on the hub's own computer, no account needed.
function overlayData(code) {
  // Without ?room=: the Streamer Mode lobby hosted from this PC (the streamer), newest first.
  const here = r => /^(127\.|::1$|::ffff:127\.)/.test(r.host?.ws?.ip || "");
  const list = [...rooms.values()].filter(r => r.host && (code ? r.code === code : isStreamer(r)))
    .sort((a, b) => here(b) - here(a) || (b.streamer?.at || 0) - (a.streamer?.at || 0));
  const r = list[0];
  if (!r) return { on: false };
  const seats = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    const c = [...r.clients.values()].find(x => x.slot === slot);
    if (c) seats.push({ slot, name: c.name, host: c === r.host, left: c.turnEnd && c !== r.host ? Math.max(0, c.turnEnd - Date.now()) : null });
    else if (r.reserved.has(slot)) seats.push({ slot, name: r.host.name + "'s PC", host: true, left: null });
  }
  const line = isStreamer(r) ? streamerQueue(r).map(id => r.clients.get(id).name) : [];
  return { on: true, streamer: isStreamer(r), game: r.game, system: SYSTEMS[r.system]?.label || r.system, phase: r.phase, seats, next: line.slice(0, 5), waiting: line.length };
}
function roomList() {
  return [...rooms.values()].filter(r => r.host).map(r => {
    const guests = [...r.clients.values()].filter(c => c !== r.host);
    const seated = guests.filter(c => c.slot >= 0).length;
    return { code: r.code, game: r.game, system: r.system, host: r.host.name, hostKey: r.owner, locked: !!r.pw,
      players: r.reserved.size + seated, open: Math.max(0, MAX_PLAYERS - r.reserved.size - seated), max: MAX_PLAYERS,
      spectators: guests.length - seated, watchable: r.rules.spectators && r.clients.size < MAX_CLIENTS,
      phase: r.phase, hostRtt: r.host.ws.rtt ?? null, mode: r.rules.mode, race: !!r.rules.race,
      // Lobby Browser: who's in it (names only, as anyone joining would see them), host first.
      names: [...r.clients.values()].filter(c => !c.away && !c.left).sort((a, b) => (b === r.host) - (a === r.host) || (a.slot < 0) - (b.slot < 0))
        .slice(0, MAX_CLIENTS).map(c => ({ name: c.name, host: c === r.host, watching: c.slot < 0 })) };
  });
}
let listTimer = null;
function pushRoomList() {
  if (listTimer) return;
  listTimer = setTimeout(() => {
    listTimer = null;
    const msg = JSON.stringify({ t: "rooms", rooms: roomList() });
    friendsChanged();                   // friends see who's in which lobby
    for (const ws of lobbyWatchers) if (ws.readyState === 1) ws.send(msg);
    discovery.lobbiesChanged();
  }, 100);
}
// This hub's lobbies in the shared discovery schema (core/net/discovery.mjs), for LAN beacons and the master pool.
function discoveryLobbies() {
  // A link session ends when this PC's VBA-M is closed.
  if ((link.hosting || link.joined) && !native.isRunning()) {
    if (link.joined) releaseSeat(link.joined);
    link.stop("ended (VBA-M closed)");
  }
  const own = link.lobby();
  return [...(own ? [own] : []), ...roomList().map(r => ({ lobby_id: r.code, host_name: r.host, emulator_core: isNativeSys(r.system) ? `native:${r.system}` : "emulatorjs",
    game_title: r.game || "", current_players: r.players, max_players: r.max, system: r.system, locked: r.locked, phase: r.phase, mode: r.mode,
    netplay_mode: r.system === "wiiu" && native.pretendoCached()?.ready ? "pretendo" : "netplay" }))];
}
const masterPool = process.env.MASTER_SERVER === "1" ? createMasterPool() : null;
const loopbackOnly = /^(127\.|::1$|localhost$)/i.test(HOST);
const discovery = createDiscovery({ lobbies: discoveryLobbies, port: PORT, advertise: !loopbackOnly, publicUrl: PUBLIC_URL,
  masterUrl: process.env.MASTER_SERVER_URL || "", version: APP_VERSION, onChange: pushLanList });
discovery.setWatching(() => lobbyWatchers.size > 0);
// GBA link-cable sessions between hubs on this network (core/net/link.mjs).
let linkHostName = "Host";
const link = createLink({ hubId: discovery.hubId, hostName: () => linkHostName });
setInterval(() => { if (link.hosting || link.joined) discoveryLobbies(); }, 3000).unref();   // notice VBA-M closing
const lanIp = () => Object.values(os.networkInterfaces()).flat().find(a => a && (a.family === "IPv4" || a.family === 4) && !a.internal)?.address || "127.0.0.1";
// A request straight from another computer on this network: no proxy / tunnel in between.
function directLan(req) {
  const h = req.headers;
  return PRIVATE_IP.test(String(req.socket.remoteAddress || "")) && !h["cf-connecting-ip"] && !h["x-forwarded-for"] && !h["x-real-ip"] && !h["forwarded"];
}
const linkHits = new Map();    // ip -> { n, at }: hub-to-hub link requests, 30 a minute per address
function linkThrottled(ip) {
  const now = Date.now(), e = linkHits.get(ip);
  if (!e || now - e.at > 60e3) { linkHits.set(ip, { n: 1, at: now }); if (linkHits.size > 500) linkHits.clear(); return false; }
  return ++e.n > 30;
}
function releaseSeat(j) {
  fetch(`${j.hostBase}/api/link/release`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lobby_id: j.lobbyId, hub: discovery.hubId }), signal: AbortSignal.timeout(4000) }).catch(() => {});
}
// Games VBA-M can link: GBA, Game Boy and Game Boy Color, from the browser consoles' folders or VBA-M's own (gbalink).
const LINK_EXTS = new Set(["gba", "gb", "gbc"]);
const isGbaGame = g => ["gba", "gb", "gbc", "gbalink"].includes(g.system) && LINK_EXTS.has(g.ext) && !g.app;
// Other hubs' lobbies. LAN ones (private 192.168.x addresses) only go to browsers on the same private network:
// a friend coming in over the internet / tunnel can't reach them, and shouldn't learn the owner's LAN layout.
const PRIVATE_IP = /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)|^::1$|^f[cd][0-9a-f]{2}:/i;
function lanMsgFor(ws) {
  const all = discovery.list();
  return JSON.stringify({ t: "lan", lobbies: ws.privateNet ? all : all.filter(l => !l.is_lan) });
}
function pushLanList() {
  for (const ws of lobbyWatchers) if (ws.readyState === 1) ws.send(lanMsgFor(ws));
}
function sendRoster(room) {
  if (isStreamer(room)) { streamerQueue(room); fillSeats(room); }
  broadcast(room, { t: "roster", players: roster(room), hostId: room.host?.id ?? null, game: room.game, system: room.system,
    phase: room.phase, rules: room.rules, reserved: [...room.reserved], staged: !!room.staged,
    ...(room.rules.race && room.goAt ? { race: { elapsed: Date.now() - room.goAt, over: !!room.raceOver } } : {}),
    ...(room.rules.shuffle ? { shuffle: room.shuffle || { cur: -1, beaten: [], done: false } } : {}),
    ...(isStreamer(room) ? { streamer: { on: true, turnMin: room.streamer.turnMin, waiting: (room.queue || []).length,
      fx: { ...(fxOn(room) ? fxState(room) : { on: false }), enabled: [...(room.fx?.enabled || Object.keys(FX))], catalog: FX_CATALOG } } } : {}) });
  pushRoomList();
}
function setPhase(room, phase) {
  room.phase = phase;
  // Race: the hub's clock is the race clock. It starts on GO, the same moment every player's game unpauses.
  if (phase === "playing" && room.rules.race) startRace(room);
  if (phase === "lobby") { room.goAt = null; room.raceOver = false; for (const c of room.clients.values()) c.run = null; }
  if (phase === "loading") for (const c of room.clients.values()) { c.ready = "loading"; c.progress = 0; }
  if (phase === "lobby") for (const c of room.clients.values()) { c.ready = "notready"; c.progress = 0; }
  broadcast(room, { t: "phase", phase });
}
// Co-op: lobby -> countdown -> loading -> playing (the host's stream starts once everyone is connected).
// Ghost: lobby -> loading -> countdown -> playing, so every player's own emulator is booted (paused) before
// the 3-2-1 and all runs start together on GO. A cancelled ghost countdown returns to the loaded state.
function cancelCountdown(room, reason) {
  if (room.phase !== "countdown") return false;
  clearTimeout(room.cd); room.cd = null;
  room.phase = room.staged ? "loading" : "lobby";
  broadcast(room, { t: "countdown", cancelled: true, reason });
  return true;
}
function runCountdown(room, after) {
  room.phase = "countdown";
  broadcast(room, { t: "countdown", ms: COUNTDOWN_MS });
  room.cd = setTimeout(() => { room.cd = null; if (room.phase === "countdown") { after(); sendRoster(room); } }, COUNTDOWN_MS);
}
const needsReady = room => [...room.clients.values()].filter(c => c.slot >= 0 && c !== room.host);   // the host readies by pressing Start
function checkLoaded(room) {
  if (room.phase !== "loading" || !room.host) return;
  if (![...room.clients.values()].every(c => c.progress >= 100)) return;
  if (!isGhost(room)) {
    for (const c of room.clients.values()) c.ready = "ready";
    return setPhase(room, "playing");
  }
  // Ghost: the first time everyone is loaded the countdown starts by itself; after an abort the host restarts it.
  if (room.staged) return;
  room.staged = true;
  runCountdown(room, () => setPhase(room, "playing"));
}

// ---------------------------------------------------------------- friends (presence + invites, this hub only)
// Each player keeps their friends list in their own browser (account IDs). The page opens a small presence socket
// and sends that list ({t:"friends"}). The hub only ever tells you about someone when you have BOTH added each
// other: then you see them online, in which lobby, and can invite them. Someone who added you (but you haven't
// added back) shows as a friend request while they're online. "Appear offline" hides you from everyone.
// Nothing is stored: lists live in memory for as long as the socket is open.
const friendConns = new Set();            // ws with ws.fr = { key, name, ids:Set, hidden, invites:[], ims:[], away, idle, profile, icon, since }
const FRIEND_MSGS = new Set(["friends", "invite", "im", "typing", "info", "warn", "find"]);
const FRIEND_ID = /^[0-9A-F]{16}$/;
let friendsTimer = null;
function friendsChanged() {
  if (friendsTimer || !friendConns.size) return;
  friendsTimer = setTimeout(() => { friendsTimer = null; for (const ws of friendConns) sendPresence(ws); }, 400);
}
// The lobby an account is in right now (seated or watching, not a held seat of someone who dropped).
function roomOfKey(key) {
  for (const r of rooms.values()) for (const c of r.clients.values()) if (c.key === key && !c.away && !c.left) return r;
  return null;
}
function sendPresence(ws) {
  const me = ws.fr; if (!me || ws.readyState !== 1) return;
  const online = new Map(), requests = new Map();
  for (const o of friendConns) {
    const fr = o.fr;
    if (!fr || fr.hidden || fr.key === me.key || !fr.ids.has(me.key)) continue;
    (me.ids.has(fr.key) ? online : requests).set(fr.key, fr.name);
  }
  const friends = [...online].map(([id, name]) => {
    const fr = frOf(id), extra = { ...(fr?.away ? { away: fr.away } : {}), ...(fr?.idle ? { idle: true } : {}), warn: warnLevel(id),
      since: fr?.since || 0, ...(fr?.icon ? { icon: fr.icon } : {}) };
    const r = roomOfKey(id);
    if (!r || !r.host) return { id, name, state: "hub", ...extra };
    const seated = [...r.clients.values()].filter(c => c !== r.host && c.slot >= 0).length;
    return { id, name, state: r.phase === "lobby" ? "lobby" : "playing", room: r.code, game: r.game, system: r.system, locked: !!r.pw,
      mode: r.rules.race ? "race" : r.rules.mode, open: Math.max(0, MAX_PLAYERS - r.reserved.size - seated), host: r.host.key === id, ...extra };
  });
  const msg = JSON.stringify({ t: "presence", friends, requests: [...requests].map(([id, name]) => ({ id, name })) });
  if (msg !== ws.lastPresence) { ws.lastPresence = msg; ws.send(msg); }
}
// Retro Hub Messenger (public/aim.js, AIM-style): instant messages, away messages, profiles, warnings and
// "Find a Buddy", all on the same presence socket and with the same rule: only between people who added each other
// (Find a Buddy lists anyone online here who isn't hidden). Messages are relayed, never stored.
const frOf = key => { for (const o of friendConns) if (o.fr?.key === key && o.readyState === 1) return o.fr; return null; };
const frSocks = key => [...friendConns].filter(o => o.fr?.key === key && o.readyState === 1);
const mutual = (a, b) => !!(a && b && a.ids.has(b.key) && b.ids.has(a.key));
const IM_MAX = 1000, AWAY_MAX = 300, PROFILE_MAX = 1000;
const cleanMsg = (s, n) => String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
// Warnings, like AIM: a buddy can warn you (+10%, once per 5 minutes each); the level drops 1% a minute, lives in memory
// only, and is shown next to your name. At 50% and above you can send IMs only every 5 seconds.
const warns = new Map();                  // key -> { level, at, by: Map(fromKey -> time) }
function warnLevel(key) {
  const w = warns.get(key); if (!w) return 0;
  const lvl = Math.max(0, w.level - Math.floor((Date.now() - w.at) / 60e3));
  if (!lvl) warns.delete(key);
  return lvl;
}
function friendsMessage(ws, session, m) {
  if (m.t === "friends") {
    const ids = new Set((Array.isArray(m.ids) ? m.ids : []).map(x => String(x).toUpperCase()).filter(x => FRIEND_ID.test(x) && x !== session.id).slice(0, 200));
    const icon = /^[\p{Extended_Pictographic}‍️]{1,8}$/u.test(String(m.icon || "")) ? String(m.icon) : "";
    ws.fr = { key: session.id, name: session.name, ids, hidden: !!m.hidden, invites: ws.fr?.invites || [], ims: ws.fr?.ims || [], autos: ws.fr?.autos,
      away: cleanMsg(m.away, AWAY_MAX), idle: !!m.idle, profile: cleanMsg(m.profile, PROFILE_MAX), icon, since: ws.fr?.since || Date.now() };
    friendConns.add(ws); ws.lastPresence = "";
    sendPresence(ws); friendsChanged();
    return true;
  }
  const me = ws.fr;
  const reply = obj => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  if (m.t === "im") {                     // { t:"im", to, text } -> { t:"im", from:{id,name}, text, at, auto }
    const to = String(m.to || "").toUpperCase(), text = cleanMsg(m.text, IM_MAX), nonce = String(m.nonce || "").slice(0, 20);
    const fail = msg => reply({ t: "im-result", to, nonce, ok: false, msg });
    if (!me || !FRIEND_ID.test(to) || !text) return true;
    const them = frOf(to);
    if (!them || !mutual(me, them) || them.hidden) return fail("is not online right now.");
    const now = Date.now();
    me.ims = me.ims.filter(t => now - t < 10e3);
    if (me.ims.length >= 10 || (warnLevel(me.key) >= 50 && me.ims.some(t => now - t < 5e3))) return fail("didn't get that: you're sending too fast.");
    me.ims.push(now);
    const out = JSON.stringify({ t: "im", from: { id: me.key, name: me.name }, text, at: now });
    for (const o of frSocks(to)) o.send(out);
    reply({ t: "im-result", to, nonce, ok: true, at: now });
    // Their away message answers like AIM's auto-response: at most once every 2 minutes per conversation.
    me.autos = me.autos || new Map();
    if (them.away && now - (me.autos.get(to) || 0) > 120e3) {
      me.autos.set(to, now);
      reply({ t: "im", from: { id: them.key, name: them.name }, text: them.away, at: now, auto: true });
    }
    return true;
  }
  if (m.t === "typing") {                 // typing indicator, forwarded to the buddy's open sockets
    const to = String(m.to || "").toUpperCase(), them = FRIEND_ID.test(to) && frOf(to);
    if (me && them && mutual(me, them)) { const out = JSON.stringify({ t: "typing", from: me.key, on: !!m.on }); for (const o of frSocks(to)) o.send(out); }
    return true;
  }
  if (m.t === "info") {                   // a buddy's profile + away message + warning level
    const id = String(m.id || "").toUpperCase(), them = FRIEND_ID.test(id) && frOf(id);
    if (!me || !them || !mutual(me, them) || them.hidden) return reply({ t: "info", id, online: false }), true;
    return reply({ t: "info", id, online: true, name: them.name, profile: them.profile, away: them.away, warn: warnLevel(id), since: them.since, icon: them.icon }), true;
  }
  if (m.t === "warn") {
    const id = String(m.id || "").toUpperCase(), them = FRIEND_ID.test(id) && frOf(id);
    if (!me || !them || !mutual(me, them)) return reply({ t: "warn-result", id, ok: false, msg: "They're not online." }), true;
    const w = warns.get(id) || { level: 0, at: Date.now(), by: new Map() }, now = Date.now();
    if (now - (w.by.get(me.key) || 0) < 5 * 60e3) return reply({ t: "warn-result", id, ok: false, msg: "You can warn them again in a few minutes." }), true;
    w.level = Math.min(100, warnLevel(id) + 10); w.at = now; w.by.set(me.key, now); warns.set(id, w);
    const note = JSON.stringify({ t: "warned", by: me.name, level: w.level });
    for (const o of frSocks(id)) o.send(note);
    reply({ t: "warn-result", id, ok: true, level: w.level }); friendsChanged();
    return true;
  }
  if (m.t === "find") {                   // Find a Buddy: online people on this hub whose name matches (not hidden)
    const q = String(m.q || "").toLowerCase().replace(/[\x00-\x1f]/g, "").trim().slice(0, 30);
    if (!me) return true;
    const seen = new Set(), found = [];
    for (const o of friendConns) {
      const fr = o.fr;
      if (!fr || fr.hidden || fr.key === me.key || seen.has(fr.key) || o.readyState !== 1) continue;
      if (q && !fr.name.toLowerCase().includes(q)) continue;
      seen.add(fr.key); found.push({ id: fr.key, name: fr.name, ...(fr.icon ? { icon: fr.icon } : {}) });
      if (found.length >= 30) break;
    }
    return reply({ t: "found", q, list: found.sort((a, b) => a.name.localeCompare(b.name)) }), true;
  }
  if (m.t === "invite") {
    const me = ws.fr, to = String(m.to || "").toUpperCase();
    const say = text => ws.send(JSON.stringify({ t: "invite-result", to, ok: false, msg: text }));
    if (!me || !FRIEND_ID.test(to)) return true;
    const room = roomOfKey(me.key);
    if (!room) return say("Open or join a lobby first, then invite.");
    const targets = [...friendConns].filter(o => o.fr && o.fr.key === to && !o.fr.hidden && o.fr.ids.has(me.key));
    if (!me.ids.has(to) || !targets.length) return say("They're not online here (or haven't added you back).");
    if (roomOfKey(to) === room) return say("They're already in your lobby.");
    const now = Date.now();
    me.invites = me.invites.filter(x => now - x.at < 60e3);
    if (me.invites.length >= 6) return say("Slow down a little: too many invites.");
    if (me.invites.some(x => x.to === to && now - x.at < 20e3)) return say("You just invited them. Give them a moment.");
    me.invites.push({ to, at: now });
    const inv = JSON.stringify({ t: "invite", from: { id: me.key, name: me.name }, room: room.code, game: room.game, system: room.system, locked: !!room.pw });
    for (const o of targets) if (o.readyState === 1) o.send(inv);
    ws.send(JSON.stringify({ t: "invite-result", to, ok: true }));
    return true;
  }
  return false;
}

wss.on("connection", (ws, session, ip) => {
  ws.privateNet = PRIVATE_IP.test(String(ip || ""));
  ws.ip = String(ip || "");
  let me = { id: nextId++, ws, room: null, slot: -1, name: session.name, key: session.id, ready: "notready", progress: 0, voice: false,
    rom: null, ghost: false, token: crypto.randomBytes(18).toString("base64url"), away: false, awayT: null };
  ws.isAlive = true; ws.missed = 0;
  ws.on("pong", () => { ws.isAlive = true; ws.missed = 0; if (ws.pingAt) ws.rtt = Date.now() - ws.pingAt; });
  ws.on("message", raw => {
    // Flood guard: a normal client sends a few messages a second (bursts of ICE candidates are well under this).
    const now = Date.now();
    if (now - (ws.win || 0) >= 1000) { ws.win = now; ws.n = 0; }
    if (++ws.n > WS_RATE_MAX) { me.left = true; return ws.close(1008, "Too many messages"); }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;
    if (m.t === "ping") return send(me, { t: "pong", ts: m.ts });
    if (FRIEND_MSGS.has(m.t) && !me.room) { friendsMessage(ws, session, m); return; }
    if (m.t === "lobby") {
      lobbyWatchers.add(ws);
      send(me, { t: "rooms", rooms: roomList() });
      discovery.nowWatching();
      return ws.send(lanMsgFor(ws));
    }
    if (m.t === "join" && !me.room) {
      const code = cleanCode(m.room);
      if (!code) return send(me, { t: "error", msg: "Missing room code." });
      let room = rooms.get(code);
      if (room) {
        // Resume: same account + the secret token from "joined" gets back the exact same player (id, seat, ready, ROM).
        const mineAway = [...room.clients.values()].filter(c => c.away && c.key === me.key);
        let held = mineAway.find(c => tokenMatch(m.resume, c.token))
          // Planned reload (host migration): the seat was marked just before the page reloaded; same account only.
          || (m.handoff ? mineAway.find(c => c.handoff && Date.now() - c.handoff < RESUME_MS) : null);
        if (held) {
          clearTimeout(held.awayT); held.awayT = null; held.away = false; held.handoff = 0;
          held.ws = ws; lobbyWatchers.delete(ws);
          me = held;
          send(me, joinedMsg(room, me, { resumed: true }));
          send(me, { t: "chat-history", list: room.chat || [] });
          if (!room.host && promoteHost(room, "The host didn't come back.")) return;
          return sendRoster(room);
        }
        // Same account came back without the token (page reload): the old seat is released so the new join can take it.
        held = mineAway.find(c => (c === room.host) === (m.role === "host"));
        if (held) { finalizeLeave(room, held, true); room = rooms.get(code); me.reloaded = true; }
      }
      if (m.role === "host") {
        if (room && room.owner !== me.key) {
          return send(me, room.host
            ? { t: "error", code: "host-moved", msg: `${room.host.name} is hosting this lobby now. You can join it from the hosts list.` }
            : { t: "error", code: "host-taken", msg: "This lobby belongs to someone else." });
        }
        if (room?.host) return send(me, { t: "error", code: "host-taken", msg: "You are already hosting this lobby in another tab." });
        if (!room) {
          const pw = String(m.password || "").slice(0, 64);
          rooms.set(code, room = { code, host: null, owner: me.key, pw: pw ? hashLobbyPw(pw) : null,
            reserved: new Set(), clients: new Map(), game: "", system: "", phase: "lobby", cd: null, staged: false,
            rules: { spectators: true, mode: m.mode === "ghost" && !isNativeSys(m.system) ? "ghost" : "coop", race: false, splits: [] } });
          room.rules.race = room.rules.mode === "ghost" && !!m.race;
          const sh = room.rules.mode === "coop" ? cleanShuffle(m.shuffle) : null;
          if (sh) room.rules.shuffle = sh;
          room.rules.splits = cleanSplits(m.splits) || [];
          room.game = cleanText(m.game, 80);
          room.system = SYSTEMS[m.system] ? m.system : "";
        }
        const local = Array.isArray(m.local) ? m.local.filter(n => Number.isInteger(n) && n >= 0 && n < MAX_PLAYERS) : [];
        room.reserved = new Set(local.length && !isGhost(room) ? local : [0]);
        me.rom = cleanRom(m.rom);
        for (const c of room.clients.values()) if (room.reserved.has(c.slot)) c.slot = -1;
        for (const c of room.clients.values()) if (c.slot < 0 && c.wasSeated) c.slot = freeSlot(room);
        me.slot = Math.min(...room.reserved);
        if (room.phase === "loading" || room.phase === "playing") { me.ready = "ready"; me.progress = Number(m.progress) || 0; }
        room.host = me;
      } else {
        if (!room) return send(me, { t: "error", code: "no-room", msg: "No lobby with this code is open right now." });
        const rlKey = "lobby:" + ip;
        if (rateLimited(rlKey)) return send(me, { t: "error", code: "limited", msg: "Too many wrong passwords. Try again in 15 minutes." });
        if (!checkLobbyPw(room, m.password)) {
          if (m.password) noteFailure(rlKey);
          return send(me, { t: "error", code: "password", msg: m.password ? "Wrong lobby password." : "This lobby needs a password." });
        }
        if (room.clients.size >= MAX_CLIENTS) return send(me, { t: "error", code: "full", msg: "Lobby is full." });
        const watch = !!m.spectate || isStreamer(room);       // Streamer Mode: everyone starts in the waiting room
        if (isStreamer(room) && !m.spectate) me.sittingOut = false; else if (isStreamer(room)) me.sittingOut = true;
        me.slot = watch ? -1 : (Number.isInteger(m.slot) && m.slot >= 0 && m.slot < MAX_PLAYERS && !slotTaken(room, m.slot) ? m.slot : freeSlot(room));
        if (!watch && me.slot < 0) {
          return send(me, { t: "error", code: "full", msg: room.rules.spectators ? "All player slots are taken. You can still watch." : "Lobby is full.",
            watchable: room.rules.spectators });
        }
        if (watch && !room.rules.spectators) return send(me, { t: "error", code: "no-spectators", msg: "This lobby doesn't allow spectators." });
        me.wasSeated = me.slot >= 0;
        me.rom = cleanRom(m.rom);
        if (room.phase === "loading" || room.phase === "playing") me.ready = "loading";
      }
      me.room = room; room.clients.set(me.id, me);
      if (isStreamer(room) && me.slot < 0) enqueue(room, me);
      send(me, joinedMsg(room, me));
      send(me, { t: "chat-history", list: room.chat || [] });
      if (!me.reloaded && (room.host !== me || room.clients.size > 1)) chatSys(room, `${me.name} joined${me.slot < 0 ? (isStreamer(room) ? " the waiting room" : " to watch") : ""}.`);
      if (!room.host && promoteHost(room, "The host didn't come back.")) return;
      return sendRoster(room);
    }
    const room = me.room; if (!room) return;
    const isHost = room.host === me;
    if (streamerMessage(room, me, isHost, m)) return;
    if (isStreamer(room) && !isHost && me.slot < 0 && (m.t === "slot" || (m.t === "spectate" && !m.on)))
      return send(me, { t: "notice", msg: "Streamer Mode: seats go in waiting-room order. Join the line and you'll be offered one." });
    switch (m.t) {
      case "signal": {
        const target = room.clients.get(m.to);
        if (!target || (!isHost && target !== room.host)) return;
        return send(target, { t: "signal", from: me.id, data: m.data });
      }
      case "ready": {
        const staged = room.staged && (room.phase === "loading" || room.phase === "countdown");
        if (room.phase !== "lobby" && room.phase !== "countdown" && !staged) return;
        const want = m.state === "ready" ? "ready" : "notready";
        if (want === "ready" && isGhost(room) && me.slot >= 0 && !me.rom) {
          return send(me, { t: "notice", msg: "Load your own copy of the game (ROM) before you ready up." });
        }
        if (want === "ready" && staged && me.progress < 100) return;
        me.ready = want;
        if (me.ready === "notready") cancelCountdown(room, `${me.name} is no longer ready.`);
        return sendRoster(room);
      }
      case "rom": {     // ghost mode: checksum of the player's own ROM file (the file itself never leaves their browser)
        if (room.phase !== "lobby" && room.phase !== "countdown" && room.phase !== "loading") return;
        const rom = cleanRom(m.rom);
        if (JSON.stringify(rom) === JSON.stringify(me.rom)) return;
        me.rom = rom;
        if (room.phase !== "loading") {
          if (isHost) {     // the reference ROM changed: everyone re-checks and readies again
            cancelCountdown(room, "The host loaded a different ROM.");
            for (const c of room.clients.values()) c.ready = "notready";
          } else if (me.ready === "ready") { me.ready = "notready"; cancelCountdown(room, `${me.name} changed their ROM.`); }
        }
        return sendRoster(room);
      }
      case "ghost": { me.ghost = !!m.on; return sendRoster(room); }
      case "rules": {
        if (!isHost || room.staged || (room.phase !== "lobby" && room.phase !== "countdown")) return;
        const before = JSON.stringify([room.game, room.system, room.rules]);
        if (typeof m.game === "string") { room.game = cleanText(m.game, 80); if (!m.shuffle) { delete room.rules.shuffle; room.shuffle = null; } }
        if (typeof m.system === "string" && SYSTEMS[m.system]) room.system = m.system;
        if (typeof m.spectators === "boolean") room.rules.spectators = m.spectators || isStreamer(room);   // the waiting room is spectators
        if (m.mode === "ghost" || m.mode === "coop") {
          room.rules.mode = m.mode;
          if (m.mode === "ghost") room.reserved = new Set([room.host.slot]);   // one player per computer in ghost mode
        }
        if (typeof m.race === "boolean") room.rules.race = m.race;
        const splits = cleanSplits(m.splits); if (splits) room.rules.splits = splits;
        if (isNativeSys(room.system)) room.rules.mode = "coop";    // native games run once, on the host's computer
        if (room.rules.mode !== "ghost") room.rules.race = false;  // a race is everyone on their own copy
        if (room.rules.mode !== "coop") { delete room.rules.shuffle; room.shuffle = null; }
        if (room.rules.mode !== "coop" && room.streamer?.on) { room.streamer.on = false; room.offers?.clear(); room.queue = []; }
        if (JSON.stringify([room.game, room.system, room.rules]) === before) return;
        cancelCountdown(room, "The host changed the rules.");
        for (const c of room.clients.values()) c.ready = "notready";
        broadcast(room, { t: "notice", msg: "The host changed the game or rules. Everyone needs to ready up again." });
        return sendRoster(room);
      }
      case "start": {
        if (!isHost) return;
        const waiting = needsReady(room).filter(c => c.ready !== "ready");
        if (room.phase === "loading" && room.staged) {     // ghost: restart the countdown after an abort
          if (![...room.clients.values()].every(c => c.progress >= 100)) return send(me, { t: "notice", msg: "Someone is still loading." });
          if (waiting.length) return send(me, { t: "notice", msg: `Waiting for ${waiting.map(c => c.name).join(", ")} to ready up.` });
          runCountdown(room, () => setPhase(room, "playing"));
          return sendRoster(room);
        }
        if (room.phase !== "lobby") return;
        if (waiting.length) return send(me, { t: "notice", msg: `Waiting for ${waiting.map(c => c.name).join(", ")} to ready up.` });
        if (isGhost(room)) {
          if (!me.rom) return send(me, { t: "notice", msg: "Load your ROM first." });
          room.staged = false;
          setPhase(room, "loading");
          return sendRoster(room);
        }
        runCountdown(room, () => setPhase(room, "loading"));
        return sendRoster(room);
      }
      case "abort": {
        if (isHost && cancelCountdown(room, "The host stopped the countdown.")) sendRoster(room);
        return;
      }
      case "progress": {
        if (room.phase !== "loading" && room.phase !== "playing") return;
        const pct = Math.max(0, Math.min(100, Math.round(Number(m.pct) || 0)));
        if (pct === me.progress) return;
        me.progress = pct;
        if (pct >= 100 && (room.phase === "playing" || (isGhost(room) && me.ready === "loading"))) me.ready = "ready";
        checkLoaded(room);
        return sendRoster(room);
      }
      case "slot": {     // move yourself to an empty seat (also leaves spectating)
        const s = Number(m.slot);
        if (!Number.isInteger(s) || s < 0 || s >= MAX_PLAYERS || isHost || room.phase === "countdown" || slotTaken(room, s)) return;
        if (isGhost(room) && room.phase !== "lobby" && me.slot < 0) return;   // a ghost run can't be joined from the stands
        me.slot = s; me.wasSeated = true; me.ready = room.phase === "lobby" ? "notready" : me.ready;
        return sendRoster(room);
      }
      case "swap": {     // host swaps two guest seats (either may be empty)
        if (!isHost || room.phase === "countdown" || (isGhost(room) && room.phase !== "lobby")) return;
        const a = Number(m.a), b = Number(m.b);
        if (![a, b].every(s => Number.isInteger(s) && s >= 0 && s < MAX_PLAYERS && !room.reserved.has(s)) || a === b) return;
        const ca = [...room.clients.values()].find(c => c.slot === a), cb = [...room.clients.values()].find(c => c.slot === b);
        if (ca) ca.slot = b; if (cb) cb.slot = a;
        return sendRoster(room);
      }
      case "spectate": {
        if (isHost || room.phase === "countdown") return;
        if (isGhost(room) && room.phase !== "lobby") return send(me, { t: "notice", msg: "Seats are locked while a ghost run is in progress." });
        if (m.on) {
          if (!room.rules.spectators) return send(me, { t: "notice", msg: "This lobby doesn't allow spectators." });
          me.slot = -1; me.wasSeated = false;
          if (isStreamer(room)) { me.turnEnd = 0; me.keep = false; me.muted = false; enqueue(room, me); }
        } else if (me.slot < 0) {
          const s = freeSlot(room, me);
          if (s < 0) return send(me, { t: "notice", msg: "No free player slot." });
          me.slot = s; me.wasSeated = true; if (room.phase === "lobby") me.ready = "notready";
        }
        return sendRoster(room);
      }
      case "voice": { me.voice = !!m.on; return sendRoster(room); }
      case "shuffle-state": {             // host: which game is on, which are beaten
        if (!isHost || !room.rules.shuffle) return;
        const n = room.rules.shuffle.games.length, cur = Number(m.cur);
        const was = room.shuffle;
        room.shuffle = { cur: Number.isInteger(cur) && cur >= 0 && cur < n ? cur : -1,
          beaten: Array.from({ length: n }, (_, i) => !!m.beaten?.[i]), done: !!m.done };
        if (room.shuffle.done && !was?.done) chatSys(room, `🔀 All ${n} games beaten${m.time ? " in " + cleanText(m.time, 12) : ""}${Number.isInteger(m.swaps) ? ` with ${m.swaps} swaps` : ""}!`);
        return sendRoster(room);
      }
      case "race": { if (raceAct(room, me, String(m.act || ""))) sendRoster(room); return; }
      case "chat": {
        // Clients render chat as plain text, so only control characters are removed ("<3" survives).
        const text = String(m.text ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, CHAT_MAX);
        if (!text) return;
        if (!chatAllowed(me)) return send(me, { t: "notice", msg: "Slow down a little: too many chat messages." });
        return chat(room, { from: me.id, name: me.name, key: me.key, slot: me.slot, text });
      }
      case "savestate": {     // co-op host saved or loaded a save state (the state itself travels peer to peer)
        if (!isHost || isGhost(room) || room.phase !== "playing" || !chatAllowed(me)) return;
        const label = cleanText(m.label, 60);
        if (m.act === "save") return chatSys(room, `${me.name} saved the game${label ? ` (${label})` : ""}.`);
        if (m.act === "load") return chatSys(room, `${me.name} loaded a save${label ? `: ${label}` : ""}.`);
        return;
      }
      case "rematch": {          // host: back to the lobby with the same game, mode and splits; everyone readies up again
        if (!isHost || (room.phase !== "playing" && room.phase !== "loading")) return;
        clearTimeout(room.cd); room.cd = null; room.staged = false;
        broadcast(room, { t: "rematch" });          // first: pages reload with the rematch flag before the phase change
        setPhase(room, "lobby");
        chatSys(room, `${me.name} started a rematch. Ready up!`);
        return sendRoster(room);
      }
      case "leave": { me.left = true; return; }               // sent right before an intentional close: no resume window
      case "handoff": { me.handoff = Date.now(); return; }   // about to reload into a new role: keep the seat
    }
  });
  ws.on("close", () => {
    lobbyWatchers.delete(ws);
    if (friendConns.delete(ws)) friendsChanged();
    const room = me.room; if (!room || me.ws !== ws) return;     // a resumed client's old socket closing changes nothing
    if (me.left) return finalizeLeave(room, me);
    // Wi-Fi blip etc.: keep the seat for RESUME_MS. WebRTC links usually survive a hub drop, and the same id keeps them.
    me.away = true;
    const c = me;
    c.awayT = setTimeout(() => finalizeLeave(room, c), RESUME_MS);
    cancelCountdown(room, `${me.name} lost connection.`);
    sendRoster(room);
  });
});
// Heartbeat every 5 s: measures each socket's round-trip time; drops sockets that miss 3 in a row.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive && ++ws.missed >= 3) { ws.terminate(); continue; }
    ws.isAlive = false; ws.pingAt = Date.now(); ws.ping();
  }
}, 5000).unref();
// Latency changes: refresh the hosts list and rosters every 5 s.
setInterval(() => { if (rooms.size) { pushRoomList(); for (const r of rooms.values()) if (r.clients.size > 1) sendRoster(r); } }, 5000).unref();

// ---------------------------------------------------------------- shutdown
// Every way of stopping ends here: Ctrl+C, closing the window, `docker stop` (SIGTERM; without a handler Node
// running as PID 1 in a container ignores it and Docker has to kill it after 10 s), stop.py / stop.sh / the Retro Hub window,
// or the owner's "Shut down server" button. Players are told, sockets close, the run file is removed, and the
// process exits; if anything hangs, it is forced out after 3 s.
let stopping = false;
function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  console.log(`Shutting down (${reason})…`);
  const bye = JSON.stringify({ t: "shutdown", msg: "The Retro Hub server was shut down." });
  for (const ws of wss.clients) { try { ws.send(bye); ws.close(1001, "Server shutting down"); } catch {} }
  for (const room of rooms.values()) clearTimeout(room.cd);
  try { native.shutdown(); } catch {}
  try { discovery.stop(); masterPool?.stop(); } catch {}
  removeRunFile();
  server.close(() => process.exit(0));
  setTimeout(() => { for (const ws of wss.clients) ws.terminate(); process.exit(0); }, 3000).unref();
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) { try { process.on(sig, () => shutdown(sig)); } catch {} }
process.on("exit", removeRunFile);

// run/retro-hub.json tells stop.py which process and port this is, plus a random token that only someone who
// can read this folder knows. Readable by this user only; deleted on exit. Never sent to browsers.
const RUN_FILE = path.join(ROOT, "run", "retro-hub.json");
const SHUTDOWN_TOKEN = crypto.randomBytes(24).toString("base64url");
function writeRunFile() {
  try {
    fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true });
    fs.writeFileSync(RUN_FILE, JSON.stringify({ pid: process.pid, port: PORT, token: SHUTDOWN_TOKEN, started: new Date().toISOString() }), { mode: 0o600 });
  } catch (e) { console.warn(`Could not write ${RUN_FILE} (${e.code}); stop.py will fall back to finding the process by port.`); }
}
function removeRunFile() {
  try { if (JSON.parse(fs.readFileSync(RUN_FILE, "utf8")).pid === process.pid) fs.unlinkSync(RUN_FILE); } catch {}
}
function isLoopback(req) {
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
// A browser on this very computer: loopback AND not relayed by a local proxy (a Cloudflare tunnel or reverse
// proxy also connects from loopback, but adds forwarding headers for the real visitor).
function localOwner(req, s) {
  if (s?.role !== "admin" || !isLoopback(req)) return false;
  const h = req.headers;
  return !h["cf-connecting-ip"] && !h["x-forwarded-for"] && !h["x-real-ip"] && !h["forwarded"];
}
function sameOrigin(req) {
  const o = String(req.headers.origin || "");
  try { const u = new URL(o); return u.host === req.headers.host && (u.protocol === "http:" || u.protocol === "https:"); } catch { return false; }
}

server.listen(PORT, HOST, () => {
  writeRunFile();
  console.log(`Retro Hub v${APP_VERSION} on http://localhost:${PORT}  (roms: ${ROMS_DIR}, core cache: ${CORES_CACHE}, library: ${LIBRARY_ACCESS})`);
  refreshLibrary();          // first library scan in the background, so the library is ready when someone opens it
  if (PUBLIC_URL) console.log(`Public address (used in invite links): ${PUBLIC_URL}`);
  console.log("Stop it with the Retro Hub window's Stop button, Ctrl+C, python stop.py / stop.sh, or 'docker compose down' for Docker.");
});
