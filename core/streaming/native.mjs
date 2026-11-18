// Native apps: desktop emulators (PCSX2, Dolphin, RPCS3, Xenia, Cemu, Ryujinx, ...) and PC games (.exe).
//
// They are too heavy for the browser, so the hub runs them as ordinary desktop programs on the host's own
// computer and reuses the existing netplay pipeline for everything else:
//   1. apps.py (the app runner) starts the chosen emulator + game, or a registered PC game, inside a container
//      (a Windows Job Object): everything it spawns stays inside, and stopping ends all of it. The runner only
//      passes arguments; nothing in the emulator's folder is changed. Which emulators and consoles exist comes
//      from core/runner/catalog.json plus the owner's emulators/apps.json (`python apps.py` edits that).
//   2. The host's browser captures the app's window (getDisplayMedia) and hands that track to HostNet, so guests
//      get the same WebRTC stream, quality presets, codec choice, TURN, stats and voice as always.
//   3. Guest inputs arrive at the host's browser over the data channel; it forwards them to this server on a
//      loopback-only WebSocket, and core/streaming/input_bridge.py turns them into local input: virtual gamepads
//      (vgamepad/ViGEmBus on Windows, uinput on Linux) or, with nothing installed, one set of keyboard keys per
//      guest seat (Windows SendInput, typed only into windows inside the app's container).
// Game files never leave the host's disk, and nothing here is reachable from another computer.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { WebSocketServer } from "ws";

const WIN = process.platform === "win32";
const FRAME_BYTES = 2 + 24 * 2;            // [u8 slot][u8 version=1][24 x u16 LE], same values as the netplay wire
const MAX_PADS = 4;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
// A folder that holds an emulator folder or an apps.json.
const hasEmulators = dir => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).some(d => (d.isDirectory() && !d.name.startsWith(".")) || d.name.toLowerCase() === "apps.json"); }
  catch { return false; }
};
// EMULATORS_DIR, else ./emulators. Same rule as apps.py emu_dir(): a configured folder that is missing or empty
// (a .env copied from an older Retro Hub folder, an unplugged drive) falls back to ./emulators when that has emulators.
const warned = new Set();
export const emuDirOf = (root, emulatorsDir) => {
  const own = path.resolve(root, "emulators");
  if (!emulatorsDir) return own;
  const p = path.resolve(emulatorsDir);
  if (p.toLowerCase() !== own.toLowerCase() && !hasEmulators(p) && hasEmulators(own)) {
    if (!warned.has(p)) { warned.add(p); console.warn(`EMULATORS_DIR ${p} is missing or empty; using ${own} instead. Fix it in Settings (or .env).`); }
    return own;
  }
  return p;
};

// Consoles for library detection and lobbies: built-in catalog + consoles the owner added in apps.json.
// Read once at startup (a newly added console needs a restart; new games and emulators don't).
export function nativeSystems(root, emulatorsDir) {
  const cat = readJson(path.join(root, "core", "runner", "catalog.json"), { systems: {} });
  const user = readJson(path.join(emuDirOf(root, emulatorsDir), "apps.json"), {});
  const out = {};
  for (const [id, s] of Object.entries({ ...cat.systems, ...(user.systems || {}) })) {
    if (!/^[a-z0-9]{1,20}$/i.test(id) || !s || typeof s !== "object") continue;
    const list = v => (Array.isArray(v) ? v : []).map(x => String(x).toLowerCase().replace(/^\./, "")).filter(x => /^[a-z0-9]{1,10}$/.test(x));
    out[id] = { label: String(s.label || id).slice(0, 40), ext: list(s.ext), dirs: (Array.isArray(s.dirs) ? s.dirs : []).map(String).slice(0, 10) };
  }
  return out;
}

export function createNative({ root, emulatorsDir, log = console }) {
  const EMU_DIR = emuDirOf(root, emulatorsDir);
  const APPS = path.join(root, "apps.py");
  const BRIDGE = path.join(root, "core", "streaming", "input_bridge.py");
  const JOB = `Local\\RetroHub-App-${process.pid}`;      // the app container's name (Windows)

  // PC games registered with apps.py: listed in the library as "app/<id>" under the "pc" console.
  let gamesCache = { at: 0, list: [] };
  function pcGames() {
    if (Date.now() - gamesCache.at < 3000) return gamesCache.list;
    const games = readJson(path.join(EMU_DIR, "apps.json"), {}).games || {};
    const list = Object.entries(games).filter(([id, g]) => /^[a-z0-9-]{1,48}$/.test(id) && g && typeof g === "object")
      .map(([id, g]) => ({ path: `app/${id}`, app: id, name: String(g.name || id).replace(/[\x00-\x1f<>]/g, "").slice(0, 80),
        ext: "exe", system: "pc", size: 0, cover: null, native: true }));
    gamesCache = { at: Date.now(), list };
    return list;
  }

  // ---- Python (runs apps.py and the input bridge)
  const pythons = () => [process.env.NATIVE_PYTHON, process.env.RH_PYTHON, ...(WIN ? ["python", "py"] : ["python3", "python"])].filter(Boolean);
  const pyArgs = (py, script, extra) => [...(py === "py" ? ["-3"] : []), "-I", script, ...extra];
  const env = () => ({ ...process.env, EMULATORS_DIR: EMU_DIR });
  function pyJson(py, script, extra) {
    return new Promise(resolve => {
      execFile(py, pyArgs(py, script, extra), { timeout: 15000, windowsHide: true, env: env(), maxBuffer: 1 << 20 }, (err, stdout) => {
        let r = null; try { r = JSON.parse(String(stdout).trim().split("\n").pop()); } catch {}
        resolve(r && typeof r === "object" ? { ...r, python: py } : null);
      });
    });
  }
  let python = null;
  async function findPython() {
    if (python) return python;
    for (const py of pythons()) if ((await pyJson(py, APPS, ["status"]))?.ok) return (python = py);
    return null;
  }

  // ---- installed emulators / consoles / PC games (apps.py status, cached briefly)
  let appsCache = { at: 0, value: null, pending: null };
  async function appsStatus() {
    if (appsCache.value && Date.now() - appsCache.at < 4000) return appsCache.value;
    if (appsCache.pending) return appsCache.pending;
    appsCache.pending = (async () => {
      const py = await findPython();
      const value = py ? await pyJson(py, APPS, ["status"]) : null;
      appsCache = { at: Date.now(), value, pending: null };
      return value;
    })();
    return appsCache.pending;
  }

  // ---- the running app (one at a time: it is the host's own computer)
  let running = null;      // { proc, label, system, name, started }
  let lastExit = null;     // { name, emulator, code, at, quick }: the last program that closed by itself (not stopped by the hub)
  function stopGame(why = "stopped") {
    const r = running; running = null;
    if (!r) return false;
    log.log(`native: ${r.label} ${why}`);
    try { r.proc.stdin.write("stop\n"); } catch {}          // the runner closes the windows politely first
    // If it hangs, ending the runner closes its container, and Windows ends everything inside.
    setTimeout(() => { try { r.proc.kill(); } catch {} }, 8000).unref();
    return true;
  }
  // link: { host, port, players, role } for a link-cable session (the emulator's catalog "link" block).
  // opts.headless: keep the program's windows off-screen (apps.py run --headless); the host's page shows it.
  async function launch(entry, absFile, link = null, opts = {}) {
    const st = await appsStatus();
    if (!st?.ok) throw new Error("Python 3 wasn't found, and the app runner needs it. Install it from python.org.");
    let app, label, game;
    if (entry.system === "pc") {
      const g = st.games.find(x => x.id === entry.app);
      if (!g) throw new Error("That PC game isn't registered any more. Run `python apps.py` to add it.");
      if (!g.installed) throw new Error(`${g.name}: its .exe isn't there any more. Run \`python apps.py\` to fix the path.`);
      app = g.id; label = g.name;
    } else {
      const sys = st.systems[entry.system];
      if (!sys) throw new Error("That game isn't for a native emulator.");
      if (!sys.installed) throw new Error(`${sys.emulatorLabel || "Its emulator"} isn't installed. Put a portable build in emulators/${sys.emulator || ""}/ or add one with \`python apps.py\`.`);
      app = sys.emulator; label = sys.emulatorLabel; game = absFile;
    }
    stopGame("replaced by a new game");
    lastExit = null;
    const linkArgs = link ? Object.entries(link).flatMap(([k, v]) => ["--link", `${k}=${v}`]) : [];
    const headless = !!opts.headless && WIN;
    const gbaArgs = opts.gba ? ["--gba-bios", String(opts.gba.bios), "--gba-players", String(opts.gba.players || 4)] : [];
    const args = pyArgs(python, APPS, ["run", "--app", app, ...(game ? ["--game", game] : []), "--job", JOB, ...linkArgs, ...(headless ? ["--headless"] : []), ...gbaArgs]);
    const proc = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: env() });
    const r = { proc, label, system: entry.system, name: entry.name, started: Date.now(), headless, hidden: headless, gba: opts.gba ? opts.gba.players || 4 : 0 };
    running = r;
    proc.stdin.on("error", () => {});
    proc.stderr.on("data", d => log.warn("app runner: " + String(d).trim()));
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      readline.createInterface({ input: proc.stdout }).on("line", line => {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (m.t === "window") { r.hidden = !!m.hidden; return; }
        if (m.t === "started") { log.log(`native: started ${label} for "${entry.name}" (pid ${m.pid}${m.container ? ", contained" : ""})`); done(resolve, { emulator: label, pid: m.pid }); }
        else if (m.t === "error") { if (running === r) running = null; done(reject, new Error(m.error)); }
        else if (m.t === "exited" || m.t === "stopped") {
          log.log(`native: ${label} ${m.t === "exited" ? `exited (${m.code})` : "closed"}`);
          // Closed by itself (window closed, game quit, crash): let the host's page know so it isn't left waiting.
          if (m.t === "exited") lastExit = { name: entry.name, emulator: label, code: m.code, at: Date.now(), quick: Date.now() - r.started < 10000 };
          if (running === r) running = null;
        }
      });
      proc.on("error", e => { if (running === r) running = null; done(reject, new Error(`Couldn't start the app runner: ${e.message}`)); });
      proc.on("exit", () => { if (running === r) running = null; done(reject, new Error("The app runner stopped before the program started.")); });
      setTimeout(() => done(reject, new Error("The program took too long to start.")), 20000).unref();
    });
  }

  // ---- input bridge (Python helper that owns the virtual gamepads / keyboard keys)
  // auto: virtual gamepads when vgamepad/ViGEmBus (or evdev) is there, else keyboard keys (Windows, no installs).
  const MODE = ["gamepad", "keyboard"].includes(process.env.NATIVE_INPUT) ? process.env.NATIVE_INPUT : "auto";
  const bridgeArgs = extra => ["--mode", MODE, "--emu-dir", EMU_DIR, ...(WIN ? ["--job", JOB] : []), ...extra];
  let pyCheck = { at: 0, result: null, pending: null };
  async function bridgeStatus() {
    if (pyCheck.result && Date.now() - pyCheck.at < 60e3) return pyCheck.result;
    if (pyCheck.pending) return pyCheck.pending;
    pyCheck.pending = (async () => {
      const py = await findPython();
      const r = py ? await pyJson(py, BRIDGE, bridgeArgs(["--check"])) : null;
      const result = r || { ok: false, error: "Python 3 wasn't found. Install it from python.org (the launcher needs it anyway)." };
      pyCheck = { at: Date.now(), result, pending: null };
      return result;
    })();
    return pyCheck.pending;
  }

  let bridge = null;       // { proc, ws }
  function startBridge(slots, py) {
    const proc = spawn(py, pyArgs(py, BRIDGE, bridgeArgs(["--slots", slots.join(",")])), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    proc.stderr.on("data", d => log.warn("input bridge: " + String(d).trim()));
    proc.ready = new Promise(resolve => {
      readline.createInterface({ input: proc.stdout }).on("line", line => {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (m.t === "pads") resolve(true);
      });
      proc.on("exit", () => resolve(false));
      setTimeout(() => resolve(false), 8000).unref();
    });
    proc.stdin.on("error", () => {});
    proc.on("exit", code => { if (bridge?.proc === proc) { log.warn(`native: input bridge exited (${code})`); try { bridge.ws.close(1011, "bridge exited"); } catch {} bridge = null; } });
    return proc;
  }
  function stopBridge() {
    const b = bridge; bridge = null;
    if (!b) return;
    try { b.proc.stdin.end(); } catch {}
    setTimeout(() => { try { b.proc.kill(); } catch {} }, 1000).unref();
  }

  // Loopback-only socket from the host's own browser: binary frames of guest controller state.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  wss.on("connection", async (ws, slots) => {
    const st = await bridgeStatus();
    if (!st.ok) { ws.close(4000, String(st.error || "input bridge unavailable").slice(0, 120)); return; }
    if (ws.readyState !== 1) return;
    stopBridge();                                  // a newer tab of the same host takes over
    bridge = { ws, proc: startBridge(slots, st.python) };
    const me = bridge;
    const allowed = new Set(slots);
    ws.on("close", () => { if (bridge === me) stopBridge(); });
    // "ready" only once the virtual pads are plugged in, so the host page can launch the emulator after that.
    const padsUp = await me.proc.ready;
    if (bridge !== me || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: "ready", backend: st.backend, mode: st.mode, slots, pads: padsUp }));
    ws.on("message", (data, isBinary) => {
      if (!isBinary || bridge !== me || data.length !== FRAME_BYTES) return;
      if (data[1] !== 1 || !allowed.has(data[0])) return;
      try { me.proc.stdin.write(data); } catch {}
    });
  });
  function handleUpgrade(req, socket, head) {
    const q = new URL(req.url, "http://x").searchParams;
    const slots = [...new Set(String(q.get("slots") || "").split(",").map(Number))]
      .filter(n => Number.isInteger(n) && n >= 0 && n < MAX_PADS).sort();
    if (!slots.length) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, slots));
  }

  async function status() {
    const st = await appsStatus();
    return {
      emulators: st?.emulators || {},
      systems: st?.systems || {},
      games: st?.games || [],
      runner: st?.ok ? { ok: true } : { ok: false, error: "Python 3 wasn't found, and the app runner needs it." },
      bridge: await bridgeStatus(),
      running: running ? { name: running.name, system: running.system, emulator: running.label, since: running.started,
        headless: !!running.headless, hidden: !!running.hidden } : null,
      lastExit,
      folder: EMU_DIR,
    };
  }
  function shutdown() { stopBridge(); if (running) { try { running.proc.kill(); } catch {} running = null; } for (const ws of wss.clients) ws.terminate(); }

  const isRunning = () => !!running;
  // Headless games: put the emulator's window back on screen (to click its menus) or off it again.
  function setWindow(show) {
    if (!running?.headless) return false;
    try { running.proc.stdin.write(show ? "show\n" : "hide\n"); } catch { return false; }
    running.hidden = !show;
    return true;
  }
  // Pretendo Network readiness for Cemu (apps.py pretendo-status), cached briefly; switching needs Cemu closed.
  let pretendo = { at: 0, value: null };
  async function pretendoStatus(fresh = false) {
    if (!fresh && pretendo.value && Date.now() - pretendo.at < 15e3) return pretendo.value;
    const py = await findPython();
    const value = py ? await pyJson(py, APPS, ["pretendo-status"]) : null;
    pretendo = { at: Date.now(), value };
    return value;
  }
  // service: pretendo (default) | custom | offline; proxy: own Pretendo server URL, "" clears, undefined leaves it.
  async function pretendoEnable({ service = "pretendo", proxy } = {}) {
    if (running?.system === "wiiu") throw new Error("Close Cemu first: it rewrites its settings when it exits.");
    const py = await findPython();
    if (!py) throw new Error("Python 3 wasn't found.");
    const args = ["pretendo-enable", "--service", service];
    if (typeof proxy === "string") args.push("--proxy", proxy);
    const r = await pyJson(py, APPS, args);
    if (!r?.ok) throw new Error(r?.error || "Couldn't change Cemu's settings.");
    pretendo.at = 0;
    return r;
  }
  // 🗡️ Opens Dolphin (its own window, not tied to the hub) set up for GBA netplay: apps.py dolphin-netplay.
  async function dolphinNetplay({ bios, players = 4, nickname = "", hostCode = "", buffer = 0 }) {
    const py = await findPython();
    if (!py) throw new Error("Python 3 wasn't found.");
    const r = await pyJson(py, APPS, ["dolphin-netplay", "--gba-bios", String(bios), "--players", String(players), "--nickname", String(nickname),
      "--host-code", String(hostCode), "--buffer", String(buffer || 0)]);
    if (!r?.ok) throw new Error(r?.error || "Couldn't start Dolphin.");
    return r;
  }
  // Copies the owner's own otp.bin / seeprom.bin / accounts from a folder ("" = Cemu's exe folder) to where Cemu reads.
  async function pretendoImport(folder = "") {
    if (running?.system === "wiiu") throw new Error("Close Cemu first.");
    const py = await findPython();
    if (!py) throw new Error("Python 3 wasn't found.");
    const r = await pyJson(py, APPS, ["pretendo-import", String(folder || "")]);
    if (!r?.ok) throw new Error(r?.error || "Couldn't copy the files.");
    pretendo.at = 0;
    return r;
  }
  return { status, launch, stopGame, setWindow, handleUpgrade, shutdown, pcGames, isRunning, pretendoStatus, pretendoEnable, pretendoImport, dolphinNetplay,
    pretendoCached: () => pretendo.value };
}
