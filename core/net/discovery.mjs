// Lobby discovery outside the emulators: LAN multicast beacons and an optional master server pool.
//
// Emulators never see any of this. A hub only advertises its own lobbies (the rooms in server.mjs); joining one
// opens that hub's page with ?join=<code>, and the normal WebRTC netplay + input bridge take it from there.
//
//   LAN       While this hub has lobbies, it sends a small UDP beacon to 239.255.43.21:37115 every 5 s (TTL 1, so
//             it never leaves the local network). Every hub listens on that group and keeps other hubs' lobbies
//             for 15 s after their last beacon. The address to join is taken from the packet's source IP, never
//             from its contents, so a beacon can only ever point at the machine that sent it.
//             LAN_DISCOVERY=0 turns both off. Hubs bound to loopback only (tunnel mode) listen but don't send.
//   Master    Optional. MASTER_SERVER_URL=https://master.example: POST a heartbeat with this hub's PUBLIC_URL and
//             lobbies every 30 s while it has lobbies (and one empty one when they close), and read the pool's
//             lobby list while someone is looking at the lobby page. Off unless set; needs PUBLIC_URL.
//             MASTER_SERVER=1 makes this hub a master pool itself (createMasterPool below).
//
// Lobby schema (both paths):
//   { lobby_id, host_name, emulator_core, game_title, current_players, max_players, connection_string, is_lan,
//     system, locked, phase, mode }
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";

export const LAN_GROUP = "239.255.43.21";
export const LAN_PORT = 37115;
const BEACON_MS = 5000, LAN_TTL_MS = 15000, MAX_PEERS = 64, MAX_LOBBIES = 20, MAX_PACKET = 16384;
const HEARTBEAT_MS = 30000, POOL_POLL_MS = 20000;

const CTRL = /[\x00-\x1f\x7f<>]/g;
const str = (v, n) => String(v ?? "").replace(CTRL, "").trim().slice(0, n);
const int = (v, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const code = v => String(v || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);

// One lobby in the shared schema, from untrusted input (a beacon or a heartbeat). base: the hub's own origin.
export function cleanLobby(l, base, isLan) {
  if (!l || typeof l !== "object") return null;
  const id = code(l.lobby_id);
  if (!id) return null;
  return {
    lobby_id: id,
    host_name: str(l.host_name, 20) || "Player",
    emulator_core: str(l.emulator_core, 40) || "emulatorjs",
    game_title: str(l.game_title, 80),
    current_players: int(l.current_players, 0, 16),
    max_players: int(l.max_players, 1, 16),
    connection_string: `${base}/?join=${encodeURIComponent(id)}`,
    is_lan: !!isLan,
    system: str(l.system, 20).replace(/[^a-z0-9]/gi, ""),
    locked: !!l.locked,
    phase: ["lobby", "countdown", "loading", "playing"].includes(l.phase) ? l.phase : "lobby",
    mode: ["ghost", "link"].includes(l.mode) ? l.mode : "coop",
    // "pretendo": the host's emulator is online through Pretendo Network (Wii U / Cemu); the game's own online
    // matchmaking then runs on Pretendo's servers, not through this hub.
    netplay_mode: l.netplay_mode === "pretendo" ? "pretendo" : "netplay",
    // GBA link-cable session (core/net/link.mjs): LAN only, so a pool entry never carries one.
    ...(isLan && l.mode === "link" && l.link && typeof l.link === "object" && /^[a-f0-9]{40}$/.test(String(l.link.sha1)) ? { link: {
      port: int(l.link.port, 1, 65535), players: int(l.link.players, 2, 4), sha1: String(l.link.sha1), size: int(l.link.size, 0, 1 << 30) } } : {}),
  };
}

const lanAddrs = () => Object.values(os.networkInterfaces()).flat()
  .filter(a => a && (a.family === "IPv4" || a.family === 4) && !a.internal).map(a => a.address);

// A plain http(s)://host[:port] origin, or null.
export function cleanOrigin(u) {
  try {
    const x = new URL(String(u));
    if ((x.protocol !== "http:" && x.protocol !== "https:") || x.username || x.password) return null;
    return x.origin;
  } catch { return null; }
}

/**
 * @param {object} o
 * @param {() => object[]} o.lobbies   this hub's lobbies, already in the shared schema (connection_string ignored)
 * @param {number} o.port              the hub's HTTP port (others join http(s)://<source ip>:<port>)
 * @param {boolean} o.https            the hub serves HTTPS itself
 * @param {boolean} o.advertise        send LAN beacons (false when only bound to loopback)
 * @param {() => void} o.onChange      the remote lobby list changed
 */
export function createDiscovery({ hubId: givenId = "", lobbies, port, https = false, advertise = true, publicUrl = "", masterUrl = "",
  version = "", onChange = () => {}, log = console }) {
  const hubId = /^[a-f0-9]{16,32}$/.test(givenId) ? givenId : crypto.randomBytes(8).toString("hex");
  const lanOn = process.env.LAN_DISCOVERY !== "0";
  const peers = new Map();         // "<ip>|<hub>" -> { at, lobbies }
  let sock = null, beaconTimer = null, sweepTimer = null, hbTimer = null, pollTimer = null;
  let hadLobbies = false, poolList = [], poolAt = 0, watching = () => false, lastKey = "";

  const changed = () => {
    const key = JSON.stringify(list());
    if (key !== lastKey) { lastKey = key; onChange(); }
  };

  // ---------------------------------------------------------------- LAN
  function beacon() {
    if (!sock) return;
    const mine = lobbies().slice(0, MAX_LOBBIES);
    if (!mine.length && !hadLobbies) return;
    const empty = !mine.length;
    hadLobbies = !empty;
    // An empty beacon tells peers our lobbies closed now, instead of after the 15 s timeout.
    const buf = Buffer.from(JSON.stringify({ app: "retro-hub", v: 1, hub: hubId, port, https, version, lobbies: mine }));
    if (buf.length > MAX_PACKET) return log.warn(`discovery: LAN beacon too large (${buf.length} bytes), skipped`);
    // One copy per network card, so every subnet this PC is on hears it.
    const addrs = lanAddrs();
    for (const ifc of addrs.length ? addrs : [undefined]) {
      try { if (ifc) sock.setMulticastInterface(ifc); } catch {}
      sock.send(buf, LAN_PORT, LAN_GROUP, () => {});
    }
  }

  function onPacket(msg, rinfo) {
    if (msg.length > MAX_PACKET) return;
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (!m || m.app !== "retro-hub" || m.v !== 1 || typeof m.hub !== "string" || m.hub === hubId) return;
    const ip = rinfo.address;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return;
    const p = int(m.port, 1, 65535);
    const base = `${m.https ? "https" : "http"}://${ip}${p === (m.https ? 443 : 80) ? "" : ":" + p}`;
    const key = `${ip}|${String(m.hub).slice(0, 32)}`;
    const ls = (Array.isArray(m.lobbies) ? m.lobbies : []).slice(0, MAX_LOBBIES).map(l => cleanLobby(l, base, true)).filter(Boolean);
    if (!ls.length) { if (peers.delete(key)) changed(); return; }
    if (!peers.has(key) && peers.size >= MAX_PEERS) return;
    peers.set(key, { at: Date.now(), lobbies: ls });
    changed();
  }

  function startLan() {
    if (!lanOn) return;
    sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", e => { log.warn(`discovery: LAN discovery off (${e.code || e.message})`); try { sock.close(); } catch {} sock = null; });
    sock.on("message", onPacket);
    sock.bind(LAN_PORT, () => {
      try { sock.setMulticastTTL(1); sock.setMulticastLoopback(true); } catch {}
      let joined = 0;
      for (const a of lanAddrs()) { try { sock.addMembership(LAN_GROUP, a); joined++; } catch {} }
      if (!joined) { try { sock.addMembership(LAN_GROUP); joined++; } catch {} }
      log.log(`discovery: LAN lobbies on ${LAN_GROUP}:${LAN_PORT} (${joined} network${joined === 1 ? "" : "s"}${advertise ? "" : ", listening only"})`);
    });
    if (advertise) beaconTimer = setInterval(beacon, BEACON_MS);
    sweepTimer = setInterval(() => {
      let gone = false;
      for (const [k, v] of peers) if (Date.now() - v.at > LAN_TTL_MS) { peers.delete(k); gone = true; }
      if (gone) changed();
    }, 2000);
    beaconTimer?.unref(); sweepTimer.unref();
  }

  // ---------------------------------------------------------------- master pool (client)
  const master = cleanOrigin(masterUrl);
  const pub = cleanOrigin(publicUrl);
  let masterHad = false;
  async function heartbeat(final = false) {
    if (!master || !pub) return;
    const mine = final ? [] : lobbies().filter(l => l.mode !== "link").slice(0, MAX_LOBBIES);
    if (!mine.length && !masterHad) return;
    masterHad = !!mine.length;
    try {
      const r = await fetch(`${master}/api/master/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hub: hubId, url: pub, version, lobbies: mine }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) log.warn(`discovery: master server said ${r.status}`);
    } catch (e) { log.warn(`discovery: master server unreachable (${e.cause?.code || e.name})`); }
  }
  async function pollPool() {
    if (!master || !watching()) return;
    try {
      const r = await fetch(`${master}/api/master/lobbies`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const own = pub;
      poolList = (Array.isArray(j?.lobbies) ? j.lobbies : []).slice(0, 500).map(l => {
        const base = cleanOrigin(String(l?.connection_string || "").split("/?")[0]);
        return base && base !== own ? cleanLobby(l, base, false) : null;
      }).filter(Boolean);
      poolAt = Date.now();
      changed();
    } catch {}
  }
  function startMaster() {
    if (!master) return;
    if (!pub) { log.warn("discovery: MASTER_SERVER_URL is set but PUBLIC_URL isn't, so this hub can't be listed (guests need an address to reach)."); }
    else log.log(`discovery: master server pool ${master}`);
    hbTimer = setInterval(() => heartbeat(), HEARTBEAT_MS); hbTimer.unref();
    pollTimer = setInterval(pollPool, POOL_POLL_MS); pollTimer.unref();
  }

  // ---------------------------------------------------------------- public
  function list() {
    const lan = [...peers.values()].flatMap(p => p.lobbies);
    const seen = new Set(lan.map(l => l.lobby_id));      // the same lobby on the LAN and in the pool: keep the LAN link
    const pool = Date.now() - poolAt < POOL_POLL_MS * 3 ? poolList.filter(l => !seen.has(l.lobby_id)) : [];
    return [...lan, ...pool];
  }
  // A lobby opened or closed here: tell the LAN (and master) now instead of on the next tick.
  let kick = null;
  function lobbiesChanged() {
    if (kick) return;
    kick = setTimeout(() => { kick = null; if (advertise) beacon(); heartbeat(); }, 300);
  }
  function setWatching(fn) { watching = fn; }
  function nowWatching() { if (master && Date.now() - poolAt > POOL_POLL_MS) pollPool(); }
  function stop() {
    clearInterval(beaconTimer); clearInterval(sweepTimer); clearInterval(hbTimer); clearInterval(pollTimer); clearTimeout(kick);
    if (sock && advertise && hadLobbies) {
      try { sock.send(Buffer.from(JSON.stringify({ app: "retro-hub", v: 1, hub: hubId, port, https, lobbies: [] })), LAN_PORT, LAN_GROUP); } catch {}
    }
    heartbeat(true);
    setTimeout(() => { try { sock?.close(); } catch {} }, 100).unref();
  }

  startLan();
  startMaster();
  return { list, lobbiesChanged, setWatching, nowWatching, stop, hubId };
}

// A master pool other hubs can register with (MASTER_SERVER=1). In memory only; a hub drops out 90 s after its
// last heartbeat. Lobbies are listed with connection_string = <the hub's public URL>/?join=<code>.
export function createMasterPool({ log = console } = {}) {
  const TTL = 90e3, MAX_HUBS = 1000, PER_IP = 5;
  const hubs = new Map();          // hub id -> { ip, url, at, lobbies }
  const sweep = setInterval(() => { for (const [k, h] of hubs) if (Date.now() - h.at > TTL) hubs.delete(k); }, 10e3);
  sweep.unref();
  function heartbeat(body, ip) {
    if (!body || typeof body !== "object") return { status: 400, error: "Bad request" };
    const id = String(body.hub || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    const url = cleanOrigin(body.url);
    if (!id || !url) return { status: 400, error: "hub and url (http(s) origin) are required" };
    const known = hubs.get(id);
    if (known && known.ip !== ip) return { status: 409, error: "That hub id belongs to another address." };
    if (!known) {
      if (hubs.size >= MAX_HUBS) return { status: 503, error: "Pool full" };
      if ([...hubs.values()].filter(h => h.ip === ip).length >= PER_IP) return { status: 429, error: "Too many hubs from this address" };
    }
    const lobbies = (Array.isArray(body.lobbies) ? body.lobbies : []).slice(0, MAX_LOBBIES).map(l => cleanLobby(l, url, false)).filter(Boolean);
    if (!lobbies.length) { hubs.delete(id); return { status: 200 }; }
    if (!known) log.log(`master: hub ${url} joined the pool`);
    hubs.set(id, { ip, url, at: Date.now(), lobbies });
    return { status: 200 };
  }
  const lobbies = () => [...hubs.values()].flatMap(h => h.lobbies);
  return { heartbeat, lobbies, stop: () => clearInterval(sweep) };
}
