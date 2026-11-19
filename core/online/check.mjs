// 🌐 Online services: is each emulator set up for its game-online service? (core/online/services.json lists them)
// Read-only checks of the emulator's own settings; Retro Hub never ships keys, BIOS or account files.
// Cemu's check and setup actions live in apps.py (pretendo-status / pretendo-enable / pretendo-import); the
// server passes that status in as cemu().
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const readText = f => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const exists = f => { try { return fs.existsSync(f); } catch { return false; } };
const sizeOf = f => { try { return fs.statSync(f).size; } catch { return -1; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const WIN = process.platform === "win32", MAC = process.platform === "darwin";
const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
const XDG_DATA = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");

// The folder holding an emulator's program (emulators/<id>, or one or two folders deeper like apps.py find_exe).
function exeDirOf(emuRoot, id, names) {
  const base = path.join(emuRoot, id);
  const want = new Set(names.map(n => n.toLowerCase()));
  const walk = (dir, depth) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    if (list.some(e => e.isFile() && want.has(e.name.toLowerCase()))) return dir;
    if (depth >= 2) return null;
    for (const e of list) if (e.isDirectory()) { const r = walk(path.join(dir, e.name), depth + 1); if (r) return r; }
    return null;
  };
  return walk(base, 0);
}

// ------------------------------------------------------------------ RPCS3 (PS3, RPCN)
// config.yml "Net:" section: Internet enabled (Disconnected / Connected), PSN status (Disconnected / Simulated / RPCN).
// The RPCN account (NPID) is in rpcn.yml in RPCS3's config folder.
function yamlSection(txt, name) {
  const lines = String(txt || "").split(/\r?\n/), out = {};
  let inside = false;
  for (const l of lines) {
    if (/^\S/.test(l)) { inside = l.trim() === `${name}:`; continue; }
    if (!inside) continue;
    const m = /^\s+([^:]+):\s*(.*)$/.exec(l); if (m) out[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}
// From RPCS3's source: rpcn.yml (Emu/NP/rpcn_config.h: Host default np.rpcs3.net, NPID, Password, Token) and
// custom_configs/config_<SERIAL>.yml live in <config dir> = <exe>/config/ on Windows; both network switches default
// to Disconnected. Firmware: <dev_flash>/vsh/etc/version.txt (util/sysinfo.cpp), dev_flash from config/vfs.yml.
const yamlKey = (txt, key) => ((new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}:\\s*(.*)$`, "m").exec(txt || "") || [])[1] || "").trim().replace(/^["'](.*)["']$/, "$1");
function checkRpcs3(exeDir) {
  const out = { problems: [], facts: [] };
  const cfgDir = path.join(exeDir, "config");
  const cfg = readText(path.join(exeDir, "config.yml")) ?? readText(path.join(cfgDir, "config.yml"));
  const net = yamlSection(cfg, "Net");
  if (!cfg) { out.problems.push("RPCS3 hasn't been started yet (no config.yml)."); out.state = "limited"; return out; }
  // Firmware first: without it no PS3 game boots at all, online or not.
  const vfs = readText(path.join(cfgDir, "vfs.yml")) ?? readText(path.join(exeDir, "vfs.yml"));
  const flashSet = yamlKey(vfs, "/dev_flash/");
  const flash = flashSet ? path.resolve(flashSet.replace("$(EmulatorDir)", exeDir + path.sep)) : path.join(exeDir, "dev_flash");
  const fw = (/release:\s*([\d.]+)/i.exec(readText(path.join(flash, "vsh", "etc", "version.txt")) || "") || [])[1];
  if (!fw) out.problems.push("PS3 firmware isn't installed, so no PS3 game boots yet: get PS3UPDAT.PUP from PlayStation's official update page, then in RPCS3 File → Install Firmware.");
  // RPCN account: RPCS3 can invent an NPID by itself, so the saved password is what shows an account was made.
  const rpcn = readText(path.join(cfgDir, "rpcn.yml")) ?? readText(path.join(exeDir, "rpcn.yml"));
  const npid = yamlKey(rpcn, "NPID"), pass = yamlKey(rpcn, "Password"), token = yamlKey(rpcn, "Token"), host = yamlKey(rpcn, "Host") || "np.rpcs3.net";
  if (!pass) out.problems.push("No RPCN account yet: Configuration → RPCN → Create account (free; RPCN emails you a token).");
  else if (!token) out.problems.push("The RPCN account has no token yet: enter the token from RPCN's email under Configuration → RPCN.");
  // Network: on globally, or per game (custom configuration) as many players do for community servers.
  const globalOn = net["Internet enabled"] === "Connected" && net["PSN status"] === "RPCN";
  const games = [];
  try {
    for (const f of fs.readdirSync(path.join(cfgDir, "custom_configs"))) {
      const m = /^config_(.+)\.yml$/i.exec(f); if (!m) continue;
      const g = yamlSection(readText(path.join(cfgDir, "custom_configs", f)), "Net");
      if (!Object.keys(g).length) continue;
      games.push({ id: m[1], on: g["Internet enabled"] === "Connected" && g["PSN status"] === "RPCN", dns: g["DNS address"] || "", swaps: !!g["IP swap list"] });
    }
  } catch {}
  if (!globalOn && !games.some(g => g.on))
    out.problems.push(`Network is ${net["Internet enabled"] || "Disconnected"} with PSN ${net["PSN status"] || "Disconnected"}: set Network status Connected and PSN status RPCN (Configuration → Network), or per game (right-click → Create Custom Configuration → Network).`);
  out.facts.push(fw ? `Firmware ${fw}` : "No firmware");
  out.facts.push(`Network: ${net["Internet enabled"] || "?"} · PSN: ${net["PSN status"] || "?"}`);
  if (pass) out.facts.push(`RPCN: ${npid || "account"} on ${host}`);
  for (const g of games.slice(0, 8)) out.facts.push(`${g.id}: ${g.on ? "online" : "offline"}${g.dns && g.dns !== "8.8.8.8" ? ` · DNS ${g.dns}` : ""}${g.swaps ? " · IP/Hosts switches" : ""}`);
  out.state = out.problems.length ? "limited" : "ready";
  return out;
}

// ------------------------------------------------------------------ xemu (Xbox, Insignia)
// xemu.toml: next to xemu.exe (portable) or %APPDATA%\xemu\xemu (Linux ~/.local/share/xemu/xemu). [net] enable = true.
function tomlSection(txt, name) {
  const out = {}; let inside = false;
  for (const l of String(txt || "").split(/\r?\n/)) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(l); if (h) { inside = h[1].trim() === name; continue; }
    if (!inside) continue;
    const m = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) out[m[1]] = m[2].replace(/^['"](.*)['"]$/, "$1");
  }
  return out;
}
function checkXemu(exeDir) {
  const out = { problems: [], facts: [] };
  const toml = readText(path.join(exeDir, "xemu.toml"))
    ?? readText(WIN ? path.join(APPDATA, "xemu", "xemu", "xemu.toml") : path.join(XDG_DATA, "xemu", "xemu", "xemu.toml"));
  const net = tomlSection(toml, "net");
  if (!toml) out.problems.push("xemu hasn't been started yet (no xemu.toml).");
  else if (net.enable !== "true") out.problems.push("Networking is off (Machine → Settings → Network).");
  out.problems.push("Insignia registration of your Xbox hard drive image can't be checked from here: follow Insignia's guide once.");
  out.facts.push(`Networking: ${net.enable === "true" ? "on" : "off"}${net.backend ? ` (${net.backend})` : ""}`);
  out.state = toml && net.enable === "true" ? "partial" : "limited";
  return out;
}

// ------------------------------------------------------------------ Xenia (Xbox 360, Canary netplay build)
function checkXenia(exeDir) {
  const out = { problems: [], facts: [] };
  let files = []; try { files = fs.readdirSync(exeDir).filter(f => /\.config\.toml$/i.test(f)); } catch {}
  const netplay = files.find(f => /netplay/i.test(f));
  if (!netplay) {
    out.problems.push(files.length ? "This Xenia build has no online play; the Xenia Canary netplay build does." : "Xenia hasn't been started yet, or this build has no online (only the netplay build of Xenia Canary does).");
    out.state = "limited"; return out;
  }
  const txt = readText(path.join(exeDir, netplay)) || "";
  const api = (/^\s*api_address\s*=\s*"([^"]*)"/m.exec(txt) || [])[1] || "";
  const mode = (/^\s*network_mode\s*=\s*(\d+)/m.exec(txt) || [])[1];
  if (!api) out.problems.push("No server address (api_address) in the netplay settings.");
  if (mode === "0") out.problems.push("network_mode is Offline.");
  out.facts.push(`Netplay build · server: ${api ? "set" : "none"}`);
  out.state = out.problems.length ? "limited" : "ready";
  return out;
}

// ------------------------------------------------------------------ PPSSPP (PSP, ad hoc + infrastructure)
// ppsspp.ini (Core/Config.cpp): [Network] EnableWlan, proAdhocServer (default socom.cc), PortOffset (10000),
// InfrastructureUsername (newer builds only); [SystemParam] NickName. Folder (Windows/main.cpp InitMemstickDirectory):
// installed.txt next to the exe -> Documents\PPSSPP (or the path inside installed.txt), else <exe>\memstick.
function iniSection(txt, name) {
  const out = {}; let inside = false;
  for (const l of String(txt || "").split(/\r?\n/)) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(l); if (h) { inside = h[1].trim() === name; continue; }
    if (!inside) continue;
    const m = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(l); if (m) out[m[1]] = m[2];
  }
  return out;
}
function checkPpsspp(exeDir) {
  const out = { problems: [], facts: [] };
  let mem = path.join(exeDir, "memstick");
  const inst = path.join(exeDir, "installed.txt");
  if (exists(inst)) {
    const custom = (readText(inst) || "").trim();
    mem = custom && isDir(custom) ? custom : path.join(HOME, "Documents", "PPSSPP");
  }
  const ini = readText(path.join(mem, "PSP", "SYSTEM", "ppsspp.ini"));
  if (!ini) { out.problems.push("PPSSPP hasn't been started yet (no ppsspp.ini), so networking is still off."); out.state = "limited"; return out; }
  const net = iniSection(ini, "Network"), sys = iniSection(ini, "SystemParam");
  const wlan = /^true$/i.test(net.EnableWlan || "");
  const nick = sys.NickName || "";
  if (!wlan) out.problems.push("Networking is off: Settings → Networking → Enable networking/WLAN.");
  if (!nick || nick === "PPSSPP") out.problems.push("No nickname yet (Settings → Networking → Ad hoc → Nickname): it's your name in game rooms.");
  if (!("InfrastructureUsername" in net)) out.facts.push("This PPSSPP version has ad hoc only (infrastructure mode needs a newer PPSSPP)");
  else if (!net.InfrastructureUsername) out.problems.push("No infrastructure username yet (Settings → Networking → Infrastructure).");
  out.facts.push(`Ad hoc server: ${net.proAdhocServer || "socom.cc"} · port offset ${net.PortOffset || "10000"}`);
  if (nick && nick !== "PPSSPP") out.facts.push(`Nickname: ${nick}`);
  out.state = out.problems.length ? "limited" : "ready";
  return out;
}

const CHECKS = { rpcs3: checkRpcs3, xemu: checkXemu, xenia: checkXenia, ppsspp: checkPpsspp };

// Cemu: apps.py pretendo-status -> the same row shape as the others.
function cemuRow(st) {
  if (!st) return { state: "unknown", problems: ["Python 3 wasn't found, so Cemu's settings couldn't be checked."], facts: [] };
  const facts = [];
  if (st.service) facts.push(`Network service: ${st.service}${st.service === "Custom" && st.customName ? ` (${st.customName})` : ""}`);
  if (st.account?.networkId) facts.push(`Account: ${st.account.networkId}`);
  if (st.proxy) facts.push(`Own server: ${st.proxy}`);
  if (st.dataDir) facts.push(`Cemu reads: ${st.portable ? "its portable folder" : st.dataDir}`);
  return { state: st.ready ? "ready" : "limited", problems: st.problems || [], facts,
    cemu: { stray: st.stray || [], service: st.service || null, proxy: st.proxy || "", online: st.online, dataDir: st.dataDir || "" } };
}

export async function onlineStatus({ root, emuRoot, cemu }) {
  const services = JSON.parse(await fsp.readFile(path.join(root, "core", "online", "services.json"), "utf8"));
  const cat = JSON.parse(await fsp.readFile(path.join(root, "core", "runner", "catalog.json"), "utf8"));
  const list = [];
  for (const [id, s] of Object.entries(services.emulators)) {
    const exe = cat.emulators?.[id]?.[WIN ? "win" : "nix"] || [];
    const exeDir = exe.length ? exeDirOf(emuRoot, id, exe) : null;
    // Native consoles this emulator runs (catalog), so the hub can warn when one of them is hosted.
    const systems = Object.entries(cat.systems || {}).filter(([, x]) => (x.emulators || []).includes(id)).map(([sid]) => sid);
    const row = { id, ...s, systems, installed: !!exeDir };
    if (!exeDir) row.state = "missing";
    else if (id === "cemu" && cemu) Object.assign(row, cemuRow(await cemu()));
    else if (CHECKS[id]) { try { Object.assign(row, CHECKS[id](exeDir)); } catch (e) { row.state = "unknown"; row.problems = [`Couldn't read its settings: ${e.message}`]; } }
    else row.state = s.kind;              // builtin / guide / none
    list.push(row);
  }
  return { hub: services.hub, emulators: list };
}

export { exeDirOf };
