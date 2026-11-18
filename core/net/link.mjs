// GBA link-cable sessions across hubs on the same network (VBA-M network link).
//
// Every player runs their own Retro Hub and their own copy of the ROM in VBA-M on their own PC. No emulator
// state is shared, so nothing can desync; only the link cable traffic goes over the network, straight between
// the VBA-M instances (TCP 5738 by default). The hubs only arrange who is who:
//
//   1. Host (P1, link server / master clock): picks a GBA game and 2-4 players. Its hub starts VBA-M with the
//      link pre-set (LinkType=1 cable, LinkProto=0 network, host, port, player count) and advertises the session
//      in its LAN beacon (core/net/discovery.mjs) with the ROM's SHA-1 and size.
//   2. Joiner: its hub looks for the same ROM (same SHA-1) in its own library, asks the host's hub for a seat
//      (POST /api/link/claim, LAN addresses only) and gets P2, P3 or P4 (the same seat again if it asks again),
//      then starts its own VBA-M with LinkHost = the host's IP.
//   3. In VBA-M each player opens Options > Link > Start Network Link, picks Server (P1) or Client (others) and
//      presses Start: the address, port and player count are already filled in. VBA-M can't start a network link
//      by itself (its "link at boot" option only covers same-PC links), so that one click is the player's.
//      VBA-M numbers link players in the order clients connect, so joiners should connect in seat order.
import crypto from "node:crypto";
import fs from "node:fs";

export const LINK_PORT = Number(process.env.LINK_PORT || 5738);
const SEAT_TTL = 10 * 60e3;            // a seat nobody re-claimed or released is freed after 10 minutes

const hashCache = new Map();           // abs path -> { key, sha1 }
export async function sha1File(abs) {
  const st = await fs.promises.stat(abs);
  const key = `${st.size}:${st.mtimeMs}`;
  const c = hashCache.get(abs);
  if (c?.key === key) return c.sha1;
  const h = crypto.createHash("sha1");
  await new Promise((resolve, reject) => fs.createReadStream(abs).on("data", d => h.update(d)).on("end", resolve).on("error", reject));
  const sha1 = h.digest("hex");
  hashCache.set(abs, { key, sha1 });
  return sha1;
}

export function createLink({ hubId, hostName = () => "Host", log = console }) {
  let hosting = null;    // { lobbyId, game, system, sha1, size, players, seats: Map(hub -> { slot, name, at }), started }
  let joined = null;     // { lobbyId, game, host, hostIp, slot, players, started }

  function host({ game, system, sha1, size, players }) {
    hosting = { lobbyId: "L" + crypto.randomBytes(4).toString("hex").toUpperCase(), game, system, sha1, size,
      players: Math.max(2, Math.min(4, players | 0)), seats: new Map([[hubId, { slot: 0, name: hostName(), at: Date.now() }]]), started: Date.now() };
    joined = null;
    log.log(`link: hosting "${game}" for ${hosting.players} players (${hosting.lobbyId})`);
    return hosting;
  }
  function stop(why = "stopped") {
    if (hosting) log.log(`link: session ${hosting.lobbyId} ${why}`);
    hosting = null; joined = null;
  }

  // Another hub asks for a seat in our session.
  function claim(body, ip) {
    if (!hosting) return { status: 404, error: "No link session is open here." };
    if (!body || String(body.lobby_id || "") !== hosting.lobbyId) return { status: 404, error: "That link session has ended." };
    const hub = String(body.hub || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!hub) return { status: 400, error: "Bad request" };
    if (String(body.sha1 || "").toLowerCase() !== hosting.sha1) return { status: 409, error: "Your copy of the game is different from the host's (link cables need the exact same ROM)." };
    for (const [k, s] of hosting.seats) if (k !== hubId && Date.now() - s.at > SEAT_TTL) hosting.seats.delete(k);
    const name = String(body.name || "Player").replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 20) || "Player";
    let seat = hosting.seats.get(hub);
    if (!seat) {
      const used = new Set([...hosting.seats.values()].map(s => s.slot));
      let slot = -1;
      for (let s = 1; s < hosting.players; s++) if (!used.has(s)) { slot = s; break; }
      if (slot < 0) return { status: 409, error: `The session is full (${hosting.players} players).` };
      seat = { slot, name, ip, at: Date.now() };
      hosting.seats.set(hub, seat);
      log.log(`link: ${name} (${ip}) took P${slot + 1}`);
    }
    seat.at = Date.now(); seat.name = name;
    return { status: 200, slot: seat.slot, players: hosting.players, port: LINK_PORT, game: hosting.game };
  }
  function release(body) {
    if (!hosting || String(body?.lobby_id || "") !== hosting.lobbyId) return { status: 200 };
    const hub = String(body.hub || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (hub && hub !== hubId && hosting.seats.delete(hub)) log.log("link: a player left the session");
    return { status: 200 };
  }

  function setJoined(j) { joined = j; hosting = null; }

  // Our session as a lobby in the discovery schema (LAN beacon only: link cables are LAN-only).
  function lobby() {
    if (!hosting) return null;
    return { lobby_id: hosting.lobbyId, host_name: hostName(), emulator_core: "native:vbam", game_title: hosting.game,
      current_players: hosting.seats.size, max_players: hosting.players, system: hosting.system, locked: false,
      phase: "lobby", mode: "link", link: { port: LINK_PORT, players: hosting.players, sha1: hosting.sha1, size: hosting.size } };
  }
  function status() {
    return {
      port: LINK_PORT,
      hosting: hosting && { lobbyId: hosting.lobbyId, game: hosting.game, players: hosting.players,
        seats: [...hosting.seats.values()].map(s => ({ slot: s.slot, name: s.name })).sort((a, b) => a.slot - b.slot) },
      joined,
    };
  }
  return { host, stop, claim, release, setJoined, lobby, status, get hosting() { return hosting; }, get joined() { return joined; } };
}
