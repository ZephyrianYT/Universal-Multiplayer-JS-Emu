// Cheat files for a library game (🧩 Cheats in a lobby). Many ROM hacks only work with their cheat list switched on
// (OoT Multiplayer needs "4 Swords Codes"), and cheat lists usually sit next to the ROM or in a patches folder.
// Looks for .cht files (Project64 and RetroArch formats; the page parses them) in:
//   the ROM's folder, the folder above it and their sub-folders (3 levels; e.g. N64/Games + N64/Patches/OotMultiPlayer),
//   and the hub's own cheats/ folder.
// Read-only, async (network drives), capped: 60 files, 2 MB each, 400 folders.
import fs from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 60, MAX_BYTES = 2 * 1024 * 1024, MAX_DIRS = 400;

// N64: the cartridge's two checksums (header 0x10-0x17) and country code (0x3E), as Project64 names its sections
// ("917D18F6-69BC5453-C:45"). .v64 (byte-swapped) and .n64 (little-endian) dumps are put back in order first.
export async function n64Id(file) {
  let h;
  try { const fd = await fs.open(file, "r"); try { h = Buffer.alloc(64); await fd.read(h, 0, 64, 0); } finally { await fd.close(); } }
  catch { return null; }
  if (h[0] === 0x37) for (let i = 0; i < 64; i += 2) { const t = h[i]; h[i] = h[i + 1]; h[i + 1] = t; }
  else if (h[0] === 0x40) for (let i = 0; i < 64; i += 4) { let t = h[i]; h[i] = h[i + 3]; h[i + 3] = t; t = h[i + 1]; h[i + 1] = h[i + 2]; h[i + 2] = t; }
  if (h[0] !== 0x80) return null;
  const hex = (o, n) => h.subarray(o, o + n).toString("hex").toUpperCase();
  return { crc1: hex(16, 4), crc2: hex(20, 4), country: h[0x3e].toString(16).toUpperCase().padStart(2, "0") };
}

// id (N64): Project64 also keeps one file per game named by checksum ("917D18F6-69BC5453-45.cht"); only the one for
// this game is read, so a folder of thousands of those doesn't crowd out a hack's own cheat list.
const PER_GAME = /^([0-9A-F]{8})-([0-9A-F]{8})-([0-9A-F]{2})\.cht$/i;
export async function findCheatFiles(romPath, hubCheatsDir, id = null) {
  const out = [], seen = new Set();
  let dirs = 0;
  async function scan(dir, depth) {
    if (out.length >= MAX_FILES || dirs >= MAX_DIRS) return;
    dirs++;
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      const pg = PER_GAME.exec(e.name);
      if (pg && !(id && pg[1].toUpperCase() === id.crc1 && pg[2].toUpperCase() === id.crc2)) continue;
      if (e.isFile() && /\.cht$/i.test(e.name) && !seen.has(p.toLowerCase())) {
        seen.add(p.toLowerCase());
        try {
          const st = await fs.stat(p);
          if (st.size > 0 && st.size <= MAX_BYTES) out.push({ name: path.relative(path.dirname(path.dirname(romPath)), p) || e.name, text: await fs.readFile(p, "latin1") });
        } catch {}
      } else if (e.isDirectory() && depth > 0 && !e.name.startsWith(".")) await scan(p, depth - 1);
    }
  }
  const romDir = path.dirname(romPath);
  await scan(romDir, 0);                         // next to the ROM (not its sub-folders: those are other games)
  await scan(path.dirname(romDir), 3);           // the console folder: Patches/, Cheats/ and the like
  if (hubCheatsDir) await scan(hubCheatsDir, 3);
  return out;
}
