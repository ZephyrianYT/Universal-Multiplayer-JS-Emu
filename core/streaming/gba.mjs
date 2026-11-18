// 🗡️ GameCube games played with Game Boy Advance controllers (Four Swords Adventures, Final Fantasy Crystal
// Chronicles): each player has their own GBA screen next to the shared TV. Retro Hub runs them in Dolphin's
// GBA (Integrated) mode on the host (apps.py dolphin_gba_args) and streams each GBA window only to its player.
// This file: recognise those games by the disc's game ID, and find the owner's own GBA BIOS (never shipped).
import fs from "node:fs";
import path from "node:path";

// Game ID = first 4 bytes of the disc header (region letter and maker follow). Checked against real discs.
export const GBA_GAMES = {
  G4S: { name: "The Legend of Zelda: Four Swords Adventures", players: 4,
    note: "Every player needs their own GBA screen: Retro Hub sends each one only to its player, so solo rooms stay secret." },
  GCC: { name: "Final Fantasy Crystal Chronicles", players: 4,
    note: "Multiplayer needs a GBA per player; each player's GBA screen (map, menus) goes only to them." },
};

// Disc header offset by container: plain .iso/.gcm/NKit = 0, RVZ/WIA = 0x58 (wia_disc_t.dhead), CISO = 0x8000.
// GCZ is compressed from the first block, so it isn't recognised (convert it to RVZ in Dolphin).
export function gcGameId(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0);
    const magic = head.toString("latin1");
    const off = magic === "RVZ\x01" || magic === "WIA\x01" ? 0x58 : magic === "CISO" ? 0x8000 : 0;
    const id = Buffer.alloc(6); fs.readSync(fd, id, 0, 6, off);
    const s = id.toString("latin1");
    return /^[A-Z0-9]{6}$/.test(s) ? s : null;
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
export function gbaGame(file) {
  const id = gcGameId(file);
  const g = id && GBA_GAMES[id.slice(0, 3)];          // G4S + region letter (E/P/J) + maker
  return g ? { id, ...g } : null;
}

// The owner's GBA BIOS: GBA_BIOS in .env, else gba_bios.bin / gba.bin / bios.gba in <Retro Hub>/bios/. 16 KB exactly.
export function findGbaBios(root) {
  const ok = f => { try { return fs.statSync(f).isFile() && fs.statSync(f).size === 16384; } catch { return false; } };
  const env = String(process.env.GBA_BIOS || "").trim();
  if (env) return ok(env) ? { path: path.resolve(env), from: "GBA_BIOS in .env" } : { path: null, error: `GBA_BIOS in .env (${env}) isn't a 16 KB GBA BIOS file.` };
  const dir = path.join(root, "bios");
  for (const n of ["gba_bios.bin", "gba.bin", "bios.gba", "GBA.BIOS"]) if (ok(path.join(dir, n))) return { path: path.join(dir, n), from: "bios folder" };
  return { path: null, error: `No GBA BIOS yet: put your own gba_bios.bin (16 KB, dumped from a GBA or DS) in ${dir}.` };
}
