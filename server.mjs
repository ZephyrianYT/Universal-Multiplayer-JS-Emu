// Retro netplay hub server.
// - Local accounts: each browser holds its own ECDSA P-256 key; the server only verifies a signed one-time
//   challenge and issues a session cookie. No passwords, no account database: nothing about accounts is stored.
// - Every host sets its own lobby password; guests must know it to join that lobby
// - Owner-only ROM library (ROMS_DIR): unlocked by ADMIN_KEYS (account IDs) or the ADMIN_PASSWORD unlock
// - EmulatorJS served locally; missing cores are fetched once from the official CDN and cached (CORES_CACHE)
// - Room signaling + live open-rooms list over WebSocket (/ws)
// - COOP/COEP/CORP headers so SharedArrayBuffer (threaded cores) works
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const ROMS_DIR = path.resolve(process.env.ROMS_DIR || path.join(ROOT, "roms"));
const CORES_CACHE = path.resolve(process.env.CORES_CACHE || path.join(ROOT, "cache", "cores"));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_PLAYERS = Math.min(4, Math.max(2, Number(process.env.MAX_PLAYERS || 4)));
const LIBRARY_ACCESS = process.env.LIBRARY_ACCESS === "all" ? "all" : "admin";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const EJS_VERSION = "4.2.3";
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const CTRL_RE = /[\x00-\x1f<>]/g;

// ---------------------------------------------------------------- auth
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "";   // optional server-wide access code
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
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
const clientIp = req => (TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress;
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
const SYSTEMS = {
  n64:       { label: "Nintendo 64", ext: ["z64", "n64", "v64"], dirs: ["n64", "nintendo64"] },
  nes:       { label: "NES", ext: ["nes", "fds", "unf", "unif"], dirs: ["nes", "famicom"] },
  snes:      { label: "SNES", ext: ["sfc", "smc", "fig", "swc"], dirs: ["snes", "supernintendo", "superfamicom", "sfc"] },
  gb:        { label: "Game Boy / Color", ext: ["gb", "gbc", "dmg"], dirs: ["gb", "gbc", "gameboy", "gameboycolor"] },
  gba:       { label: "Game Boy Advance", ext: ["gba"], dirs: ["gba", "gameboyadvance"] },
  nds:       { label: "Nintendo DS", ext: ["nds"], dirs: ["nds", "nintendods"] },
  psx:       { label: "PlayStation", ext: ["pbp", "chd", "m3u", "ecm"], dirs: ["psx", "ps1", "playstation", "playstation1", "psone"] },
  segaMD:    { label: "Genesis / Mega Drive", ext: ["md", "gen", "smd"], dirs: ["genesis", "megadrive", "md", "segamd"] },
  segaMS:    { label: "Master System", ext: ["sms"], dirs: ["sms", "mastersystem"] },
  segaGG:    { label: "Game Gear", ext: ["gg"], dirs: ["gg", "gamegear"] },
  segaCD:    { label: "Sega CD", ext: [], dirs: ["segacd", "megacd"] },
  sega32x:   { label: "Sega 32X", ext: ["32x"], dirs: ["32x", "sega32x"] },
  segaSaturn:{ label: "Saturn", ext: [], dirs: ["saturn", "segasaturn"] },
  atari2600: { label: "Atari 2600", ext: ["a26"], dirs: ["atari2600", "2600"] },
  atari7800: { label: "Atari 7800", ext: ["a78"], dirs: ["atari7800", "7800"] },
  lynx:      { label: "Atari Lynx", ext: ["lnx"], dirs: ["lynx", "atarilynx"] },
  jaguar:    { label: "Atari Jaguar", ext: ["j64", "jag"], dirs: ["jaguar", "atarijaguar"] },
  pce:       { label: "PC Engine / TG-16", ext: ["pce"], dirs: ["pce", "pcengine", "tg16", "turbografx", "turbografx16"] },
  ngp:       { label: "Neo Geo Pocket", ext: ["ngp", "ngc"], dirs: ["ngp", "ngpc", "neogeopocket"] },
  ws:        { label: "WonderSwan", ext: ["ws", "wsc"], dirs: ["wonderswan", "wsc"] },
  vb:        { label: "Virtual Boy", ext: ["vb", "vboy"], dirs: ["virtualboy", "vb"] },
  coleco:    { label: "ColecoVision", ext: ["col"], dirs: ["coleco", "colecovision"] },
  arcade:    { label: "Arcade (FBNeo)", ext: [], dirs: ["arcade", "fbneo", "fba", "neogeo"] },
  psp:       { label: "PSP", ext: ["cso"], dirs: ["psp"] },
};
const AMBIGUOUS = ["zip", "7z", "bin", "iso", "cue", "img"];
const norm = s => s.toLowerCase().replace(/[\s_.-]/g, "");
const EXT_TO_SYS = {}, DIR_TO_SYS = {};
for (const [id, s] of Object.entries(SYSTEMS)) {
  for (const e of s.ext) EXT_TO_SYS[e] = id;
  for (const d of s.dirs) DIR_TO_SYS[norm(d)] = id;
}
const ROM_EXTS = new Set([...Object.keys(EXT_TO_SYS), ...AMBIGUOUS]);

function detectSystem(relPath) {
  const parts = relPath.split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    const sys = DIR_TO_SYS[norm(parts[i])];
    if (sys) return sys;
  }
  return EXT_TO_SYS[path.extname(relPath).slice(1).toLowerCase()] || null;
}

let libCache = { at: 0, list: [] };
function scanLibrary() {
  if (Date.now() - libCache.at < 30e3) return libCache.list;
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const r = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) { if (depth < 5 && !/^bios$/i.test(d.name)) walk(path.join(dir, d.name), r, depth + 1); continue; }
      if (!d.isFile()) continue;
      const ext = path.extname(d.name).slice(1).toLowerCase();
      if (!ROM_EXTS.has(ext)) continue;
      const system = detectSystem(r);
      if (!system) continue;
      let size = 0; try { size = fs.statSync(path.join(dir, d.name)).size; } catch {}
      out.push({ path: r, name: d.name.replace(/\.[^.]+$/, ""), ext, system, size });
    }
  };
  walk(ROMS_DIR, "", 0);
  // EmulatorJS needs one file per game: hide .cue sheets and extra audio tracks of multi-track .bin dumps
  const list = out.filter(r => r.ext !== "cue" && !(r.ext === "bin" && /\(track 0*([2-9]|\d{2,})\)/i.test(r.name)));
  list.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  libCache = { at: Date.now(), list };
  return list;
}

// ---------------------------------------------------------------- static files
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".zip": "application/zip", ".7z": "application/x-7z-compressed",
};
function baseHeaders(res) {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
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

// ---------------------------------------------------------------- HTTP
const PUBLIC_PATHS = new Set(["/login.html", "/login.js", "/account.js", "/vendor/nacl-fast.min.js", "/style.css",
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
    if (!id) { noteFailure(ip); return json(res, 401, { error: "Key check failed. Reload the page and try again." }); }
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
  if (urlPath === "/api/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", "hub=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return json(res, 200, { ok: true });
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
  if (urlPath === "/api/config") return json(res, 200, { iceServers: iceServers(), maxPlayers: MAX_PLAYERS,
    systems: Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.label])),
    detect: { ext: EXT_TO_SYS, dirs: DIR_TO_SYS } });
  if (urlPath === "/api/library") {
    if (!canLibrary(session)) return json(res, 403, { error: "Library is owner-only" });
    return json(res, 200, scanLibrary());
  }
  if (urlPath.startsWith("/roms/")) {
    if (!canLibrary(session)) { res.writeHead(403); return res.end(); }
    // The client prefixes the file name with "<account>__" so EmulatorJS keeps a separate in-game save per account
    const f = safeJoin(ROMS_DIR, urlPath.slice(6).replace(/(^|\/)[0-9A-F]{8}__(?=[^/]+$)/, "$1"));
    if (!f || !ROM_EXTS.has(path.extname(f).slice(1).toLowerCase())) { res.writeHead(404); return res.end(); }
    return sendFile(req, res, f, "private, no-store");
  }
  if (urlPath.startsWith("/data/cores/")) {
    const rel = urlPath.slice("/data/cores/".length);
    if (!CORE_FILE_RE.test(rel)) { res.writeHead(404); return res.end(); }
    return serveCore(req, res, rel);
  }
  const f = safeJoin(PUBLIC_DIR, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
  if (!f) { res.writeHead(403); return res.end(); }
  sendFile(req, res, f, f.startsWith(path.join(PUBLIC_DIR, "data")) ? "public, max-age=86400" : "no-cache");
});

// ---------------------------------------------------------------- rooms + signaling (/ws)
const rooms = new Map();      // code -> { code, host, owner, pw, reserved:Set, clients:Map, game, system }
const lobbyWatchers = new Set();
let nextId = 1;
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const session = readSession(req);
  if (new URL(req.url, "http://x").pathname !== "/ws" || !session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, session, clientIp(req)));
});

const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const roster = room => [...room.clients.values()].map(c => ({ id: c.id, slot: c.slot, name: c.name, key: c.key, host: c === room.host }));
// Lobby passwords live in memory only, as salted scrypt hashes, for as long as the lobby exists.
function hashLobbyPw(pw) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: crypto.scryptSync(pw, salt, 32) };
}
const checkLobbyPw = (room, pw) => !room.pw || crypto.timingSafeEqual(crypto.scryptSync(String(pw || ""), room.pw.salt, 32), room.pw.hash);
const broadcast = (room, msg) => room.clients.forEach(c => send(c, msg));
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
const cleanText = (s, n) => String(s || "").replace(CTRL_RE, "").trim().slice(0, n);

function freeSlot(room) {
  const used = new Set([...room.clients.values()].map(c => c.slot));
  for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s) && !room.reserved.has(s)) return s;
  return -1;
}
function roomList() {
  return [...rooms.values()].filter(r => r.host).map(r => {
    const guests = r.clients.size - 1;
    return { code: r.code, game: r.game, system: r.system, host: r.host.name, hostKey: r.owner, locked: !!r.pw,
      players: r.reserved.size + guests, open: Math.max(0, MAX_PLAYERS - r.reserved.size - guests), max: MAX_PLAYERS };
  });
}
let listTimer = null;
function pushRoomList() {
  if (listTimer) return;
  listTimer = setTimeout(() => {
    listTimer = null;
    const msg = JSON.stringify({ t: "rooms", rooms: roomList() });
    for (const ws of lobbyWatchers) if (ws.readyState === 1) ws.send(msg);
  }, 100);
}
function sendRoster(room) {
  broadcast(room, { t: "roster", players: roster(room), hostId: room.host?.id ?? null, game: room.game, system: room.system });
  pushRoomList();
}

wss.on("connection", (ws, session, ip) => {
  const me = { id: nextId++, ws, room: null, slot: -1, name: session.name, key: session.id };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "lobby") { lobbyWatchers.add(ws); return send(me, { t: "rooms", rooms: roomList() }); }
    if (m.t === "join" && !me.room) {
      const code = cleanCode(m.room);
      if (!code) return send(me, { t: "error", msg: "Missing room code." });
      let room = rooms.get(code);
      if (m.role === "host") {
        if (room && room.owner !== me.key) return send(me, { t: "error", code: "host-taken", msg: "This lobby belongs to someone else." });
        if (room?.host) return send(me, { t: "error", code: "host-taken", msg: "You are already hosting this lobby in another tab." });
        if (!room) {
          const pw = String(m.password || "").slice(0, 64);
          rooms.set(code, room = { code, host: null, owner: me.key, pw: pw ? hashLobbyPw(pw) : null,
            reserved: new Set(), clients: new Map(), game: "", system: "" });
        }
        const local = Array.isArray(m.local) ? m.local.filter(n => Number.isInteger(n) && n >= 0 && n < MAX_PLAYERS) : [];
        room.reserved = new Set(local.length ? local : [0]);
        room.game = cleanText(m.game, 80);
        room.system = SYSTEMS[m.system] ? m.system : "";
        for (const c of room.clients.values()) if (room.reserved.has(c.slot)) c.slot = -1;
        for (const c of room.clients.values()) if (c.slot < 0) c.slot = freeSlot(room);
        me.slot = Math.min(...room.reserved);
        room.host = me;
      } else {
        if (!room) return send(me, { t: "error", code: "no-room", msg: "No lobby with this code is open right now." });
        const rlKey = "lobby:" + ip;
        if (rateLimited(rlKey)) return send(me, { t: "error", code: "limited", msg: "Too many wrong passwords. Try again in 15 minutes." });
        if (!checkLobbyPw(room, m.password)) {
          if (m.password) noteFailure(rlKey);
          return send(me, { t: "error", code: "password", msg: m.password ? "Wrong lobby password." : "This lobby needs a password." });
        }
        me.slot = freeSlot(room);
        if (me.slot < 0) return send(me, { t: "error", code: "full", msg: "Lobby is full." });
      }
      me.room = room; room.clients.set(me.id, me);
      send(me, { t: "joined", id: me.id, slot: me.slot, room: code, host: room.host === me });
      return sendRoster(room);
    }
    const room = me.room; if (!room) return;
    if (m.t === "signal") {
      const target = room.clients.get(m.to);
      if (!target || (room.host !== me && target !== room.host)) return;
      send(target, { t: "signal", from: me.id, data: m.data });
    }
  });
  ws.on("close", () => {
    lobbyWatchers.delete(ws);
    const room = me.room; if (!room) return;
    room.clients.delete(me.id);
    if (room.host === me) { room.host = null; room.reserved = new Set(); }
    if (!room.clients.size) { rooms.delete(room.code); return pushRoomList(); }
    sendRoster(room);
  });
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Retro Hub v${APP_VERSION} on http://localhost:${PORT}  (roms: ${ROMS_DIR}, core cache: ${CORES_CACHE}, library: ${LIBRARY_ACCESS})`);
});
