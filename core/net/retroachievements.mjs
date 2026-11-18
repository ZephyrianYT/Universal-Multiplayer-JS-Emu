// RetroAchievements (retroachievements.org) through the hub, for the 🏆 panel.
// The page can't call retroachievements.org itself: its Content-Security-Policy only allows this server, and its
// cross-origin isolation (needed by the emulator) blocks images from sites that don't opt in. So the hub forwards
// a few read-only Web API calls (docs: api-docs.retroachievements.org) and serves badge images from a disk cache.
// Each player uses their own RetroAchievements username + Web API key; the page sends them per request, the hub
// passes them on and never stores or logs them. The game lists (with ROM hashes) are cached on disk per console.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const API = "https://retroachievements.org/API/";
const MEDIA = "https://media.retroachievements.org/";
const UA = "RetroHub (self-hosted game hub)";
const LIST_TTL = 24 * 3600e3;

export async function createRetroAchievements({ cacheDir, log = console }) {
  await import("../../public/rahash.js");          // shared hash rules: sets globalThis.RAHash
  const RAH = globalThis.RAHash;
  const dir = path.join(cacheDir, "retroachievements");
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  const lists = new Map();                          // console id -> { at, games, byHash: Map, pending }
  const hashCache = new Map();                      // file path + size + mtime -> md5 | null
  const rate = new Map();                           // session key -> [times]

  const limited = key => {
    const now = Date.now(), t = (rate.get(key) || []).filter(x => now - x < 60e3);
    if (t.length >= 40) { rate.set(key, t); return true; }
    t.push(now); rate.set(key, t); return false;
  };
  setInterval(() => { const now = Date.now(); for (const [k, t] of rate) if (!t.some(x => now - x < 60e3)) rate.delete(k); }, 120e3).unref();

  async function call(endpoint, params, creds) {
    const u = new URL(endpoint, API);
    for (const [k, v] of Object.entries({ ...params, y: creds.key })) u.searchParams.set(k, String(v));
    const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("RetroAchievements didn't accept that username / Web API key."), { status: 401 });
    if (r.status === 429) throw Object.assign(new Error("RetroAchievements says too many requests. Try again in a minute."), { status: 429 });
    if (!r.ok) throw Object.assign(new Error(`RetroAchievements answered ${r.status}.`), { status: 502 });
    return r.json();
  }

  // Every game with achievements on one console, with its supported hashes (big; cached a day, on disk too).
  async function gameList(cid, creds) {
    let e = lists.get(cid);
    if (e?.games && Date.now() - e.at < LIST_TTL) return e;
    if (e?.pending) return e.pending;
    const file = path.join(dir, `games-${cid}.json`);
    if (!e) {
      try {
        const st = fs.statSync(file);
        if (Date.now() - st.mtimeMs < LIST_TTL) { e = index(JSON.parse(fs.readFileSync(file, "utf8")), st.mtimeMs); lists.set(cid, e); return e; }
      } catch {}
    }
    const pending = call("API_GetGameList.php", { i: cid, f: 1, h: 1 }, creds).then(games => {
      if (!Array.isArray(games)) throw new Error("Unexpected answer from RetroAchievements.");
      const slim = games.map(g => ({ ID: g.ID, Title: g.Title, ImageIcon: g.ImageIcon, NumAchievements: g.NumAchievements, Points: g.Points,
        Hashes: (g.Hashes || []).map(h => String(h).toLowerCase()) }));
      try { fs.writeFileSync(file + ".tmp", JSON.stringify(slim)); fs.renameSync(file + ".tmp", file); } catch {}
      const done = index(slim, Date.now()); lists.set(cid, done); return done;
    }).catch(err => { lists.delete(cid); throw err; });
    lists.set(cid, { ...(e || {}), pending });
    return pending;
  }
  function index(games, at) {
    const byHash = new Map(), byTitle = new Map();
    for (const g of games) {
      for (const h of g.Hashes || []) byHash.set(h, g);
      const t = RAH.normTitle(g.Title.replace(/^~[^~]+~\s*/, ""));       // "~Hack~ Foo" etc. never win a title match
      const had = byTitle.get(t); if (!had || (had.Title.startsWith("~") && !g.Title.startsWith("~"))) byTitle.set(t, g);
    }
    return { at, games, byHash, byTitle };
  }

  // The one game file inside a zip (stored or deflated), from its central directory: the biggest file that isn't a
  // text / image / save file. null when the zip has none, is zip64, or uses another compression method.
  function romInZip(buf) {
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return null;
    const count = b.readUInt16LE(eocd + 10);
    let p = b.readUInt32LE(eocd + 16), best = null;
    for (let n = 0; n < count && p + 46 <= b.length; n++) {
      if (b.readUInt32LE(p) !== 0x02014b50) return null;
      const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
      const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
      const name = b.toString("utf8", p + 46, p + 46 + nlen);
      const ext = name.split(".").pop().toLowerCase();
      if (!name.endsWith("/") && !/^(txt|nfo|diz|jpg|jpeg|png|gif|srm|sav|xml|htm|html|pdf)$/.test(ext) && (!best || usize > best.usize))
        best = { method, csize, usize, local, ext };
      p += 46 + nlen + xlen + clen;
    }
    if (!best || best.usize > RAH.MAX_BYTES || best.csize === 0xffffffff || ![0, 8].includes(best.method)) return null;
    const lp = best.local;
    if (b.readUInt32LE(lp) !== 0x04034b50) return null;
    const start = lp + 30 + b.readUInt16LE(lp + 26) + b.readUInt16LE(lp + 28);
    const raw = b.subarray(start, start + best.csize);
    const bytes = best.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: RAH.MAX_BYTES });
    return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), ext: best.ext };
  }

  // RetroAchievements hash of a library file (the owner's library games are hashed here, not in the page).
  function hashFile(file, system, ext) {
    let st; try { st = fs.statSync(file); } catch { return null; }
    // Arcade: RetroAchievements identifies a romset by its file name, so its size doesn't matter.
    if (system === "arcade") return crypto.createHash("md5").update(path.basename(file).replace(/\.[^.]+$/, "")).digest("hex");
    if (st.size > RAH.MAX_BYTES) return null;
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (hashCache.has(key)) return hashCache.get(key);
    let h = null;
    try {
      let bytes = new Uint8Array(fs.readFileSync(file));
      // A zipped cartridge game: RetroAchievements hashes the ROM inside (with the same header rules), not the zip.
      if (ext === "zip") { const inner = romInZip(bytes); if (inner) { bytes = inner.bytes; ext = inner.ext; } }
      const data = RAH.hashData(system, ext, bytes);
      if (data) h = crypto.createHash("md5").update(data).digest("hex");
    } catch {}
    if (hashCache.size > 500) hashCache.clear();
    hashCache.set(key, h);
    return h;
  }

  const slimGame = (g, by) => g ? { id: g.ID, title: g.Title, icon: g.ImageIcon, achievements: g.NumAchievements, points: g.Points, matchedBy: by } : null;

  // GET /api/ra/... (session already checked by the caller). libFile(path) -> { file, system, ext } for owner library games.
  async function handle(req, res, urlPath, session, { json, libFile, sendFile }) {
    const q = new URL(req.url, "http://x").searchParams;
    if (urlPath.startsWith("/api/ra/media/")) {     // badges and game icons, cached forever (their names are content ids)
      const rel = urlPath.slice("/api/ra/media/".length);
      if (!/^(Badge\/\d{1,7}(_lock)?|Images\/\d{1,7})\.png$/.test(rel)) { res.writeHead(404); return res.end(); }
      const f = path.join(dir, "media", rel.replace("/", "_"));
      if (!fs.existsSync(f)) {
        try {
          const r = await fetch(MEDIA + rel, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
          if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "")) { res.writeHead(404); return res.end(); }
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 512 * 1024) { res.writeHead(404); return res.end(); }
          fs.writeFileSync(f + ".tmp", buf); fs.renameSync(f + ".tmp", f);
        } catch { res.writeHead(502); return res.end(); }
      }
      return sendFile(req, res, f, "private, max-age=604800");
    }
    const creds = { user: String(req.headers["x-ra-user"] || "").trim().slice(0, 40), key: String(req.headers["x-ra-key"] || "").trim().slice(0, 64) };
    if (!/^[A-Za-z0-9_.-]{2,40}$/.test(creds.user) || !/^[A-Za-z0-9]{16,64}$/.test(creds.key))
      return json(res, 400, { error: "Add your RetroAchievements username and Web API key first (🏆 in the top bar)." });
    if (limited(session.key || session.name || "?")) return json(res, 429, { error: "Slow down a little: too many RetroAchievements requests." });
    try {
      if (urlPath === "/api/ra/profile") {
        const p = await call("API_GetUserProfile.php", { u: creds.user }, creds);
        return json(res, 200, { user: p.User, points: p.TotalPoints, softcore: p.TotalSoftcorePoints, avatar: p.UserPic, motto: p.Motto || "" });
      }
      if (urlPath === "/api/ra/lookup") {
        // Which RetroAchievements game is this? By hash (library path, or md5 from the page), else by title.
        let system = String(q.get("system") || ""), ext = String(q.get("ext") || "").toLowerCase(), md5 = String(q.get("md5") || "").toLowerCase();
        const name = String(q.get("name") || "").slice(0, 120);
        if (q.get("path")) {
          const lf = libFile(q.get("path"), session);
          if (!lf) return json(res, 404, { error: "That game isn't in the library." });
          system = lf.system; ext = lf.ext;
          md5 = hashFile(lf.file, system, ext) || "";
        }
        const cid = RAH.consoleId(system, ext);
        if (!cid) return json(res, 200, { game: null, reason: "RetroAchievements doesn't cover this console." });
        const list = await gameList(cid, creds);
        if (/^[0-9a-f]{32}$/.test(md5) && list.byHash.has(md5)) return json(res, 200, { game: slimGame(list.byHash.get(md5), "hash"), md5 });
        const byName = name ? list.byTitle.get(RAH.normTitle(name)) : null;
        if (byName) return json(res, 200, { game: slimGame(byName, "title"), md5: md5 || null });
        return json(res, 200, { game: null, md5: md5 || null,
          reason: md5 ? "This exact ROM isn't one RetroAchievements supports (different dump or region)." : "No RetroAchievements set found for this game." });
      }
      if (urlPath === "/api/ra/progress") {
        const id = Number(q.get("game"));
        if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "Bad game id" });
        const g = await call("API_GetGameInfoAndUserProgress.php", { g: id, u: creds.user }, creds);
        const list = Object.values(g.Achievements || {}).sort((a, b) => (a.DisplayOrder - b.DisplayOrder) || (a.ID - b.ID)).map(a => ({
          id: a.ID, title: a.Title, desc: a.Description, points: a.Points, badge: a.BadgeName, type: a.type || null,
          earned: a.DateEarned || null, hardcore: a.DateEarnedHardcore || null, rarity: g.NumDistinctPlayers ? a.NumAwarded / g.NumDistinctPlayers : null }));
        return json(res, 200, { id: g.ID, title: g.Title, console: g.ConsoleName, icon: g.ImageIcon, total: g.NumAchievements,
          earned: g.NumAwardedToUser, earnedHardcore: g.NumAwardedToUserHardcore, completion: g.UserCompletion, achievements: list });
      }
    } catch (e) {
      if (!e.status) log.warn(`retroachievements: ${e.message}`);
      return json(res, e.status || 502, { error: e.status ? e.message : "Couldn't reach RetroAchievements." });
    }
    return json(res, 404, { error: "Not found" });
  }
  return { handle, hashFile };
}
