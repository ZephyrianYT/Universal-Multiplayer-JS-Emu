#!/usr/bin/env python3
"""Retro Hub apps: native emulators and PC games for remote play.

  python apps.py                         menu: list, add a PC game, add an emulator, remove
  python apps.py list                    what is installed and registered
  python apps.py add-game NAME EXE [-- ARGS...]
  python apps.py add-emulator ID EXE --systems switch[,other] [--label L] [--args "{game}"] [--new-system ...]
  python apps.py remove ID
  python apps.py status                  JSON for the hub server
  python apps.py pretendo-status         JSON: is Cemu ready for Pretendo Network (dumps, account, service)?
  python apps.py pretendo-enable [--service pretendo|custom|offline] [--proxy URL]
                                         set the network service of Cemu's active account (backs up settings.xml);
                                         --proxy http://server:8080 = your own Pretendo server (pretendo-docker), "" clears it
  python apps.py pretendo-import FOLDER   copy your own otp.bin, seeprom.bin, network_services.xml and Wii U accounts
                                         (a Dumpling dump, or Cemu's own folder) to the folder Cemu reads (backs up first)
  python apps.py run --app ID [--game PATH] [--job NAME] [--link KEY=VALUE ...] [--headless]    used by the hub server
                                         (--link: host, port, players, role for emulators with a "link" block)
                                         (--headless: keep the program's windows off-screen; the host plays it in
                                          the browser, which captures the window. stdin "show" / "hide" toggles.)

Built-in emulators (core/runner/catalog.json) are found by dropping a portable build into emulators/<id>/.
Anything else (Ryujinx forks, other emulators anywhere on disk, PC games) is registered in emulators/apps.json.

Container: `run` starts the program inside a Windows Job Object (Linux: its own process group). Everything it
spawns (launchers, helper processes) stays in that container, the hub's keyboard mode only types into windows
inside it, and stopping closes the windows politely, then ends whatever is left. Nothing in the emulator's
folder is changed by this tool; the program gets its arguments and runs exactly as installed.
"""
import argparse
import json
import os
import re
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "core" / "runner" / "catalog.json"
WIN = sys.platform == "win32"


def _has_emulators(d):
    """True when folder d holds an emulator folder or an apps.json."""
    try:
        return any((x.is_dir() and not x.name.startswith(".")) or x.name.lower() == "apps.json" for x in os.scandir(d))
    except OSError:
        return False


def emu_dir():
    """EMULATORS_DIR from .env, else ./emulators. A configured folder that is missing or empty (a .env copied from
    an older Retro Hub folder, an unplugged drive) falls back to ./emulators when that one has emulators in it."""
    own = (ROOT / "emulators").resolve()
    cfg = os.environ.get("EMULATORS_DIR")
    if not cfg:
        return own
    p = Path(os.path.expandvars(os.path.expanduser(cfg))).resolve()
    if p != own and not _has_emulators(p) and _has_emulators(own):
        return own
    return p


def apps_file():
    return emu_dir() / "apps.json"


# ------------------------------------------------------------------ registry
def read_json(p, default):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as e:
        raise SystemExit(f"Can't read {p}: {e}")


def load_user():
    u = read_json(apps_file(), {})
    for k in ("emulators", "systems", "games", "prefer"):
        if not isinstance(u.get(k), dict):
            u[k] = {}
    return u


def save_user(u):
    apps_file().parent.mkdir(parents=True, exist_ok=True)
    tmp = apps_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(u, indent=2) + "\n", encoding="utf-8")
    tmp.replace(apps_file())


def load_catalog():
    """Built-in catalog + emulators/apps.json. User emulators go first in their systems' lists."""
    cat = read_json(CATALOG, None)
    if not cat:
        raise SystemExit(f"Missing {CATALOG}")
    u = load_user()
    systems = {k: dict(v, emulators=list(v.get("emulators", []))) for k, v in cat["systems"].items()}
    emulators = {k: dict(v) for k, v in cat["emulators"].items()}
    for sid, s in u["systems"].items():
        systems[sid] = {"label": s.get("label", sid), "ext": s.get("ext", []), "dirs": s.get("dirs", []),
                        "emulators": list(s.get("emulators", [])), "custom": True}
    for eid, e in u["emulators"].items():
        emulators[eid] = {**e, "custom": True}
        for sid in reversed(e.get("systems", [])):
            if sid in systems and eid not in systems[sid]["emulators"]:
                systems[sid]["emulators"].insert(0, eid)
    # The owner's pick per console (Retro Hub window > Settings > Consoles): it goes first, so it is used when installed.
    for sid, eid in u["prefer"].items():
        if sid in systems and eid in systems[sid]["emulators"]:
            systems[sid]["emulators"].remove(eid)
            systems[sid]["emulators"].insert(0, eid)
    return systems, emulators, u["games"]


def set_preferred(sid, eid):
    """Use emulator eid for console sid (None or "" = back to the automatic choice)."""
    systems, emulators, _ = load_catalog()
    if sid not in systems:
        raise SystemExit(f"Unknown console {sid!r}.")
    u = load_user()
    if eid:
        if eid not in systems[sid]["emulators"]:
            raise SystemExit(f"{emulators.get(eid, {}).get('label', eid)} can't run {systems[sid]['label']} games.")
        u["prefer"][sid] = eid
    else:
        u["prefer"].pop(sid, None)
    save_user(u)


def resolve_path(p):
    p = Path(os.path.expandvars(os.path.expanduser(str(p))))
    return (p if p.is_absolute() else emu_dir() / p).resolve()


_PRODUCT_CACHE = {}


def product_name(p):
    """The Windows ProductName (or FileDescription) of an .exe, lowercased; "" when it has none or off Windows."""
    if not WIN:
        return ""
    p = str(p)
    try:
        key = (p, os.stat(p).st_mtime_ns)
    except OSError:
        return ""
    if key in _PRODUCT_CACHE:
        return _PRODUCT_CACHE[key]
    out = ""
    try:
        import ctypes
        from ctypes import wintypes as W
        v = ctypes.WinDLL("version")
        v.GetFileVersionInfoSizeW.argtypes = [W.LPCWSTR, ctypes.c_void_p]
        v.GetFileVersionInfoW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, ctypes.c_void_p]
        v.VerQueryValueW.argtypes = [ctypes.c_void_p, W.LPCWSTR, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(W.UINT)]
        n = v.GetFileVersionInfoSizeW(p, None)
        if n:
            buf = ctypes.create_string_buffer(n)
            if v.GetFileVersionInfoW(p, 0, n, buf):
                ptr, ln = ctypes.c_void_p(), W.UINT()
                langs = []
                if v.VerQueryValueW(buf, "\\VarFileInfo\\Translation", ctypes.byref(ptr), ctypes.byref(ln)) and ln.value >= 4:
                    arr = ctypes.cast(ptr, ctypes.POINTER(W.WORD * (ln.value // 2))).contents
                    langs = [f"{arr[i]:04x}{arr[i + 1]:04x}" for i in range(0, len(arr) - 1, 2)]
                for lang in langs + ["040904b0", "040904e4"]:
                    for field in ("ProductName", "FileDescription"):
                        if v.VerQueryValueW(buf, f"\\StringFileInfo\\{lang}\\{field}", ctypes.byref(ptr), ctypes.byref(ln)) and ln.value:
                            out = ctypes.wstring_at(ptr, ln.value).rstrip("\0").strip().lower()
                            if out:
                                break
                    if out:
                        break
    except Exception:
        out = ""
    _PRODUCT_CACHE[key] = out
    return out


def _product_ok(p, e):
    """False when the exe says it is a different program (e.g. melonDS renamed to Azahar.exe)."""
    want = [w.lower() for w in e.get("product") or []]
    if not want:
        return True
    name = product_name(p).replace(" ", "")
    return not name or any(w.replace(" ", "") in name for w in want)


def find_exe(eid, e):
    """A registered exe path, a known executable name in emulators/<folder>/ (or up to two folders below, e.g.
    ryujinx/ryujinx-canary-x-win_x64/publish/ from Windows "Extract All"), or (Windows)
    any .exe in an emulators/ subfolder whose ProductName says it is this emulator, whatever it is called."""
    if e.get("exe"):
        p = resolve_path(e["exe"])
        return p if p.is_file() else None
    names = {n.lower() for n in (e.get("win") if WIN else e.get("nix")) or []}
    for folder in e.get("folders") or [eid]:
        base = emu_dir() / folder
        hit = _look(base, names, eid, 2, e)
        if hit:
            return hit
    if WIN and e.get("product"):
        want = [w.lower().replace(" ", "") for w in e["product"]]
        try:
            subs = sorted((x for x in os.scandir(emu_dir()) if x.is_dir() and not x.name.startswith(".")), key=lambda x: x.name.lower())
        except OSError:
            subs = []
        for d in subs:
            hit = _look_product(d.path, want, 1)
            if hit:
                return hit
    return None


def _look(d, names, eid, depth, e=None):
    try:
        entries = sorted(os.scandir(d), key=lambda x: x.name.lower())
    except OSError:
        return None
    for x in entries:
        n = x.name.lower()
        if x.is_file() and (n in names or (not WIN and n.endswith(".appimage") and eid in n)):
            if e is None or _product_ok(x.path, e):
                return Path(x.path)
    if depth > 0:
        for x in entries:
            if x.is_dir() and not x.name.startswith("."):
                hit = _look(x.path, names, eid, depth - 1, e)
                if hit:
                    return hit
    return None


def _look_product(d, want, depth):
    try:
        entries = sorted(os.scandir(d), key=lambda x: x.name.lower())
    except OSError:
        return None
    for x in entries:
        if x.is_file() and x.name.lower().endswith(".exe"):
            name = product_name(x.path).replace(" ", "")
            if name and any(w in name for w in want):
                return Path(x.path)
    if depth > 0:
        for x in entries:
            if x.is_dir() and not x.name.startswith("."):
                hit = _look_product(x.path, want, depth - 1)
                if hit:
                    return hit
    return None


def status():
    systems, emulators, games = load_catalog()
    found = {eid: find_exe(eid, e) for eid, e in emulators.items()}
    out_sys = {}
    for sid, s in systems.items():
        pick = next((x for x in s["emulators"] if found.get(x)), None) or (s["emulators"][0] if s["emulators"] else None)
        out_sys[sid] = {"label": s["label"], "emulator": pick,
                        "emulatorLabel": emulators.get(pick, {}).get("label", pick) if pick else None,
                        "installed": sid == "pc" or bool(pick and found.get(pick))}
    return {
        "ok": True,
        "emulators": {eid: {"label": e.get("label", eid), "installed": bool(found[eid]), "custom": bool(e.get("custom"))}
                      for eid, e in emulators.items()},
        "systems": out_sys,
        "games": [{"id": gid, "name": g.get("name", gid), "installed": bool(g.get("exe") and resolve_path(g["exe"]).is_file())}
                  for gid, g in games.items()],
    }


# ------------------------------------------------------------------ container (Windows Job Object)
class WinJob:
    """Kill-on-close job containing this runner and everything it starts."""

    def __init__(self, name):
        import ctypes
        from ctypes import wintypes as W
        self.c, self.W = ctypes, W
        k = self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        u = self.u = ctypes.WinDLL("user32", use_last_error=True)
        k.CreateJobObjectW.restype = W.HANDLE
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, W.LPCWSTR]
        k.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]
        k.QueryInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.c_void_p]
        k.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
        k.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
        k.GetCurrentProcess.restype = W.HANDLE
        k.CloseHandle.argtypes = [W.HANDLE]
        u.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        u.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
        u.IsWindowVisible.argtypes = [W.HWND]

        # A job left over from an earlier run with the same name: end it first (one app at a time).
        for _ in range(20):
            h = k.CreateJobObjectW(None, name)
            if not h:
                raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
            if ctypes.get_last_error() != 183:  # ERROR_ALREADY_EXISTS
                break
            k.TerminateJobObject(h, 1)
            k.CloseHandle(h)
            time.sleep(0.15)
        else:
            raise OSError("an earlier app container is still closing")
        self.h = h

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", W.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", W.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", W.DWORD), ("SchedulingClass", W.DWORD)]

        class EXTENDED(ctypes.Structure):
            _fields_ = [("Basic", BASIC), ("IoInfo", ctypes.c_uint64 * 6), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        info = EXTENDED()
        info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k.SetInformationJobObject(h, 9, ctypes.byref(info), ctypes.sizeof(info)):
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
        # The runner joins first, so every process it starts is born inside the container (no race).
        if not k.AssignProcessToJobObject(h, k.GetCurrentProcess()):
            raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")

    def pids(self):
        c, W = self.c, self.W

        class LIST(c.Structure):
            _fields_ = [("Assigned", W.DWORD), ("InList", W.DWORD), ("Ids", c.c_size_t * 512)]

        lst = LIST()
        if not self.k.QueryInformationJobObject(self.h, 3, c.byref(lst), c.sizeof(lst), None):
            return set()
        return {int(lst.Ids[i]) for i in range(min(lst.InList, 512))} - {os.getpid()}

    def close_windows(self, extra=()):
        c, W = self.c, self.W
        mine = self.pids() | set(extra)
        proto = c.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

        def cb(hwnd, _):
            pid = W.DWORD()
            self.u.GetWindowThreadProcessId(hwnd, c.byref(pid))
            if pid.value in mine and self.u.IsWindowVisible(hwnd):
                self.u.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE: lets the emulator save settings / memory cards
            return True

        self.u.EnumWindows(proto(cb), 0)


# ------------------------------------------------------------------ headless windows (Windows)
class Offscreen:
    """Keeps the container's main windows just past the right edge of the desktop, so the emulator doesn't sit
    on screen as a second window: the host's browser captures it (Windows Graphics Capture keeps working for
    windows that are off-screen but not minimised) and shows it in the page. "show" puts them back where they
    were; they are also put back before the program is closed, so it doesn't save an off-screen position."""

    def __init__(self, job):
        import ctypes
        from ctypes import wintypes as W
        self.c, self.W, self.job = ctypes, W, job
        u = self.u = ctypes.WinDLL("user32", use_last_error=True)
        try:
            u.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
            u.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        except AttributeError:
            pass

        class RECT(ctypes.Structure):
            _fields_ = [("left", W.LONG), ("top", W.LONG), ("right", W.LONG), ("bottom", W.LONG)]

        self.RECT = RECT
        u.GetWindowRect.argtypes = [W.HWND, ctypes.POINTER(RECT)]
        u.SetWindowPos.argtypes = [W.HWND, W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.UINT]
        u.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
        u.IsWindowVisible.argtypes = [W.HWND]
        u.IsIconic.argtypes = [W.HWND]
        u.GetWindow.argtypes = [W.HWND, W.UINT]
        u.GetWindow.restype = W.HWND
        u.GetWindowTextLengthW.argtypes = [W.HWND]
        u.GetWindowLongW.argtypes = [W.HWND, ctypes.c_int]
        u.ShowWindow.argtypes = [W.HWND, ctypes.c_int]
        u.SetForegroundWindow.argtypes = [W.HWND]
        self.home = {}        # hwnd -> (x, y) where it was before we moved it
        self.hidden = True
        self.lock = threading.Lock()

    def _dpi(self):
        try:
            self.u.SetThreadDpiAwarenessContext(self.c.c_void_p(-4))  # per-monitor v2: real pixel coordinates
        except (AttributeError, OSError):
            pass

    def windows(self):
        c, W, mine = self.c, self.W, self.job.pids()
        found = []
        proto = c.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

        def cb(hwnd, _):
            pid = W.DWORD()
            self.u.GetWindowThreadProcessId(hwnd, c.byref(pid))
            if pid.value not in mine or not self.u.IsWindowVisible(hwnd) or self.u.GetWindow(hwnd, 4):  # GW_OWNER: dialogs stay
                return True
            if self.u.GetWindowLongW(hwnd, -20) & 0x80:  # WS_EX_TOOLWINDOW
                return True
            r = self.RECT()
            self.u.GetWindowRect(hwnd, c.byref(r))
            if r.right - r.left >= 160 and r.bottom - r.top >= 120 and self.u.GetWindowTextLengthW(hwnd) > 0:
                found.append((hwnd, r))
            return True

        self.u.EnumWindows(proto(cb), 0)
        return found

    def apply(self):
        """Move windows that are on screen off it (when hidden), or back home (when shown)."""
        with self.lock:
            self._dpi()
            vx, vw = self.u.GetSystemMetrics(76), self.u.GetSystemMetrics(78)  # virtual screen left, width
            edge = vx + vw + 64
            flags = 0x0001 | 0x0004 | 0x0010  # SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
            for hwnd, r in self.windows():
                if self.u.IsIconic(hwnd):
                    if not self.hidden:
                        continue
                    self.u.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE: a minimised window can't be captured
                    continue
                if self.hidden and r.left < edge:
                    self.home.setdefault(hwnd, (r.left, r.top))
                    self.u.SetWindowPos(hwnd, None, edge, max(0, r.top), 0, 0, flags)
                elif not self.hidden and hwnd in self.home:
                    x, y = self.home.pop(hwnd)
                    self.u.SetWindowPos(hwnd, None, x, y, 0, 0, flags & ~0x0010)
                    self.u.SetForegroundWindow(hwnd)

    def set_hidden(self, hidden):
        self.hidden = hidden
        self.apply()
        emit(t="window", hidden=hidden)

    def loop(self, stop):
        started = time.time()
        while not stop.is_set():
            if self.hidden:
                try:
                    self.apply()
                except OSError:
                    pass
            stop.wait(0.3 if time.time() - started < 30 else 1.5)  # catch the first window fast


# ------------------------------------------------------------------ run
def emit(**m):
    sys.stdout.write(json.dumps(m) + "\n")
    sys.stdout.flush()


def unquote(a):
    """Launch options are passed to the program as a list (Windows adds the quoting itself), so quotes the user
    typed around a token, like "{game}" or '--fullscreen', must go: left in, they reach the emulator as part of
    the path and it can't open the game."""
    a = str(a).strip()
    while len(a) >= 2 and a[0] == a[-1] and a[0] in "\"'":
        a = a[1:-1].strip()
    return a


def split_args(s):
    """Split typed launch options like `--fullscreen "{game}"`, keeping quoted parts (with spaces) together and
    backslashes as they are (Windows paths)."""
    return [unquote(t) for t in re.findall(r'"[^"]*"|\'[^\']*\'|\S+', s or "") if unquote(t)]


LINK_KEYS = {
    "host": re.compile(r"^[A-Za-z0-9.-]{1,253}$|^\d{1,3}(\.\d{1,3}){3}$"),
    "port": re.compile(r"^\d{1,5}$"),
    "players": re.compile(r"^[2-4]$"),
    "role": re.compile(r"^(server|client)$"),
}


def parse_link(items):
    """["host=1.2.3.4", "port=5738", ...] -> dict, every value checked (they end up on a command line)."""
    out = {}
    for it in items or []:
        k, _, v = str(it).partition("=")
        k = k.strip().lower()
        if k not in LINK_KEYS or not LINK_KEYS[k].match(v):
            raise SystemExit(f"bad link setting {it!r}")
        if k == "port" and not 1 <= int(v) <= 65535:
            raise SystemExit(f"bad link port {v!r}")
        out[k] = v
    return out


# ------------------------------------------------------------------ Dolphin: GBA (Integrated) mode
# Four Swords Adventures and other GameCube games played with Game Boy Advance controllers. Dolphin (with mGBA built in)
# turns a controller port into an emulated GBA when [Core] SIDevice<n> = 13 (SIDEVICE_GC_GBA_EMULATED) and needs the
# player's own GBA BIOS in [GBA] BIOS (Source/Core/Core/Config/MainSettings.cpp). Retro Hub sets both with Dolphin's
# own -C options and runs it with its own user folder (-u), so the owner's normal Dolphin settings are never changed.
# The GBA controls (GBA.ini, InputConfig "GBA", sections GBA1..GBA4) map GBA n to XInput pad n-1 (the host's pad and
# the guests' virtual pads); a GBA.ini the owner edited in Dolphin is kept.
GBA_SIDEVICE = 13
GBA_MARK = "retrohub-gba.txt"


def dolphin_gba_user(exe):
    return exe.parent / "retrohub-gba-user"


def write_gba_controls(user, players):
    cfg = user / "Config" / "GBA.ini"
    mark = user / GBA_MARK
    if cfg.is_file() and not mark.is_file():
        return  # the owner set it up themselves in Dolphin
    if cfg.is_file() and mark.is_file() and cfg.stat().st_mtime > mark.stat().st_mtime + 2:
        return  # changed in Dolphin after Retro Hub wrote it
    lines = []
    for i in range(4):
        q = lambda n: f"`{n}`"
        lines += [f"[GBA{i + 1}]", f"Device = XInput/{i}/Gamepad",
                  f"Buttons/B = {q('Button A')}", f"Buttons/A = {q('Button B')}",
                  f"Buttons/L = {q('Shoulder L')} | {q('Trigger L')}", f"Buttons/R = {q('Shoulder R')} | {q('Trigger R')}",
                  f"Buttons/SELECT = {q('Back')}", f"Buttons/START = {q('Start')}",
                  f"D-Pad/Up = {q('Pad N')} | {q('Left Y+')}", f"D-Pad/Down = {q('Pad S')} | {q('Left Y-')}",
                  f"D-Pad/Left = {q('Pad W')} | {q('Left X-')}", f"D-Pad/Right = {q('Pad E')} | {q('Left X+')}", ""]
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text("\n".join(lines), encoding="utf-8")
    mark.write_text("Retro Hub wrote Config/GBA.ini (GBA n = XInput pad n-1). Change it in Dolphin: Controllers > GBA (Integrated) > Configure;\n"
                    "Retro Hub then keeps your version. Delete this file and GBA.ini to get Retro Hub's mapping back.\n", encoding="utf-8")


def dolphin_gba_args(exe, bios, players):
    bios = Path(bios)
    if not bios.is_file() or bios.stat().st_size != 16384:
        raise SystemExit("GBA mode needs your own GBA BIOS (gba_bios.bin, 16 KB) dumped from a Game Boy Advance or DS.")
    players = max(1, min(4, int(players or 4)))
    user = dolphin_gba_user(exe)
    write_gba_controls(user, players)
    args = ["-u", str(user)]
    for i in range(4):
        args += ["-C", f"Dolphin.Core.SIDevice{i}={GBA_SIDEVICE if i < players else 0}"]
    args += ["-C", f"Dolphin.GBA.BIOS={bios}"]
    return args


def dolphin_netplay(bios, players=4, nickname="", host_code="", buffer=0):
    """Open Dolphin's normal window set up for GBA netplay (Four Swords Adventures with every player on their own PC):
    the GBA ports and BIOS as in dolphin_gba_args, plus [NetPlay] HideRemoteGBAs (nobody sees another player's GBA),
    traversal (no port forwarding), the player's nickname, the pad buffer and, to join, the host's code pre-filled
    (Source/Core/Core/Config/NetplaySettings.cpp). Dolphin has no command line for hosting or joining, so the player
    still presses Host or Join in Tools > Start NetPlay. Started on its own (not tied to the hub)."""
    import subprocess
    _, emulators, _ = load_catalog()
    exe = find_exe("dolphin", emulators["dolphin"]) if "dolphin" in emulators else None
    if not exe:
        raise SystemExit("Dolphin isn't installed (emulators/dolphin/).")
    args = dolphin_gba_args(exe, bios, players)
    nick = re.sub(r"[^\w .-]", "", str(nickname or ""))[:30]
    code = str(host_code or "").strip()
    if code and not re.fullmatch(r"[0-9a-fA-F]{8}", code):
        raise SystemExit("A Dolphin host code is 8 letters/digits (0-9, a-f), shown in the host's NetPlay window.")
    sets = {"HideRemoteGBAs": "True", "TraversalChoice": "traversal"}
    if nick:
        sets["Nickname"] = nick
    if code:
        sets["HostCode"] = code.lower()
    if buffer:
        sets["BufferSize"] = str(max(1, min(40, int(buffer))))
    for k, v in sets.items():
        args += ["-C", f"Dolphin.NetPlay.{k}={v}"]
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if WIN else 0
    proc = subprocess.Popen([str(exe), *args], cwd=str(exe.parent), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, creationflags=flags, start_new_session=not WIN)
    return {"ok": True, "pid": proc.pid, "settings": sets, "user": str(dolphin_gba_user(exe))}


def build_command(app, game, link=None, gba=None):
    systems, emulators, games = load_catalog()
    if app in games:
        g = games[app]
        exe = resolve_path(g.get("exe", ""))
        args = [unquote(a) for a in g.get("args", []) if unquote(a)]
        cwd = resolve_path(g["workdir"]) if g.get("workdir") else exe.parent
        label = g.get("name", app)
    elif app in emulators:
        e = emulators[app]
        exe = find_exe(app, e)
        if not exe:
            raise SystemExit(f"{e.get('label', app)} isn't installed (emulators/{(e.get('folders') or [app])[0]}/).")
        tpl = [unquote(a) for a in e.get("args", ["{game}"]) if unquote(a)]
        if game is None:
            args = [a for a in tpl if "{game}" not in a and a != "--"]
        else:
            args = [a.replace("{game}", game) for a in tpl]
            if not any("{game}" in a for a in tpl):
                args.append(game)
        if e.get("link") and game and "=" in game:
            # VBA-M reads every NAME=VALUE argument as a setting, so a game path with "=" would not load.
            raise SystemExit(f"{e.get('label', app)} can't open a game whose path contains '=': rename {Path(game).name!r} or its folder.")
        if link:
            # Network link cable (e.g. VBA-M): the emulator's "link" block lists extra arguments with
            # {link_host} {link_port} {link_players} {link_role} filled in from the hub's link session.
            lt = (e.get("link") or {}).get("args")
            if not lt:
                raise SystemExit(f"{e.get('label', app)} has no network link support in the catalog.")
            vals = {"link_host": link.get("host", ""), "link_port": link.get("port", ""),
                    "link_players": link.get("players", "2"), "link_role": link.get("role", "client")}
            for a in lt:
                for k, v in vals.items():
                    a = a.replace("{" + k + "}", v)
                args.append(a)
        if gba:
            if app != "dolphin":
                raise SystemExit("GBA mode is only for Dolphin (GameCube).")
            args = dolphin_gba_args(exe, gba["bios"], gba.get("players", 4)) + args
        cwd = exe.parent
        label = e.get("label", app)
    else:
        raise SystemExit(f"Unknown app {app!r}. See: python apps.py list")
    if not exe or not exe.is_file():
        raise SystemExit(f"{label}: program not found ({exe}).")
    if WIN and exe.suffix.lower() != ".exe":
        # .bat/.cmd go through cmd.exe, which re-parses arguments; only real programs are started.
        raise SystemExit(f"{label}: only .exe programs can be started ({exe.name}).")
    return label, [str(exe), *args], str(cwd)


def run(app, game, job, link=None, headless=False, gba=None):
    import subprocess
    label, cmd, cwd = build_command(app, game, link, gba)
    container = WinJob(job) if WIN and job else None
    offscreen = Offscreen(container) if headless and container else None
    proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=not WIN)
    emit(t="started", app=app, label=label, pid=proc.pid, container=bool(container))

    stop = threading.Event()

    def watch_stdin():  # "stop" from the hub, or the hub going away (EOF); "show" / "hide" for headless windows
        for line in sys.stdin:
            cmd = line.strip()
            if cmd == "stop":
                break
            if offscreen and cmd in ("show", "hide"):
                try:
                    offscreen.set_hidden(cmd == "hide")
                except OSError:
                    pass
        stop.set()

    threading.Thread(target=watch_stdin, daemon=True).start()
    if offscreen:
        threading.Thread(target=offscreen.loop, args=(stop,), daemon=True).start()

    def alive():
        if proc.poll() is None:
            return True
        # Launchers often start the real game and exit: keep going while anything is left in the container.
        return bool(container and container.pids())

    while alive() and not stop.is_set():
        stop.wait(0.5)

    if stop.is_set() and alive():
        if offscreen:  # back on screen first, so the emulator doesn't save an off-screen window position
            try:
                offscreen.hidden = False
                offscreen.apply()
            except OSError:
                pass
        if container:
            container.close_windows(extra=(proc.pid,))     # the program we started, even if it isn't in the container
        elif proc.poll() is None:
            import signal
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except OSError:
                pass
        deadline = time.time() + 5
        while alive() and time.time() < deadline:
            time.sleep(0.2)
        # Still open (an error dialog, a hung emulator): end it. Not only by closing the container's last handle,
        # which another process holding it (or a program that left the container) would quietly defeat.
        if WIN and alive():
            if container:
                try:
                    container.k.TerminateJobObject(container.h, 1)
                except OSError:
                    pass
            if proc.poll() is None:
                try:
                    proc.kill()
                except OSError:
                    pass
            time.sleep(0.3)
        if not WIN and proc.poll() is None:
            import signal
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
        emit(t="stopped", forced=alive())
    else:
        emit(t="exited", code=proc.poll())
    # Exiting closes the container's last handle: Windows ends anything still inside it.
    sys.stdout.flush()
    os._exit(0)


# ------------------------------------------------------------------ registry commands
def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "app"


def store_path(p):
    """Inside the emulators folder: stored relative (the folder can move). Elsewhere: absolute."""
    p = Path(p).expanduser().resolve()
    try:
        return p.relative_to(emu_dir()).as_posix()
    except ValueError:
        return str(p)


def check_exe(p):
    p = Path(str(p).strip().strip('"')).expanduser()
    if not p.is_file():
        raise SystemExit(f"Not a file: {p}")
    if WIN and p.suffix.lower() != ".exe":
        raise SystemExit("Pick the program's .exe (shortcuts and .bat files can't be contained).")
    return p


def add_game(name, exe, args):
    u = load_user()
    exe = check_exe(exe)
    gid = slug(name)
    systems, emulators, _ = load_catalog()
    if gid in emulators:
        gid = "game-" + gid
    u["games"][gid] = {"name": name.strip()[:80], "exe": store_path(exe), "args": list(args or [])}
    save_user(u)
    print(f"Added PC game '{name}' ({gid}). It shows in the hub's library under 'PC games' (restart not needed).")


def add_emulator(eid, exe, systems_csv, label, args, new_system):
    u = load_user()
    systems, emulators, _ = load_catalog()
    eid = slug(eid)
    exe = check_exe(exe)
    tpl = split_args(args) or ["{game}"]
    sys_ids = [s.strip() for s in (systems_csv or "").split(",") if s.strip()]
    if new_system:
        sid, slabel, ext, dirs = (new_system + ":::").split(":")[:4]
        sid = slug(sid).replace("-", "")
        u["systems"][sid] = {"label": slabel or sid, "ext": [x.strip().lower() for x in ext.split(",") if x.strip()],
                             "dirs": [x.strip() for x in dirs.split(",") if x.strip()] or [sid], "emulators": [eid]}
        sys_ids.append(sid)
        systems[sid] = u["systems"][sid]
    unknown = [s for s in sys_ids if s not in systems]
    if unknown or not sys_ids:
        raise SystemExit(f"Give --systems from: {', '.join(k for k in systems if k != 'pc')} (or --new-system id:Label:ext1,ext2:folder)")
    u["emulators"][eid] = {"label": label or eid, "exe": store_path(exe), "args": tpl, "systems": sys_ids}
    save_user(u)
    print(f"Added emulator {label or eid} ({eid}) for {', '.join(sys_ids)}. Restart the hub to pick up new consoles.")


def remove(item):
    u = load_user()
    for k in ("games", "emulators", "systems"):
        if item in u[k]:
            del u[k][item]
            save_user(u)
            return print(f"Removed {item}.")
    raise SystemExit(f"{item!r} isn't in {apps_file()} (built-in emulators are removed by deleting their folder).")


# ------------------------------------------------------------------ Pretendo Network (Cemu)
# Cemu 2.0+ has Pretendo built in: Options > General settings > Account > Network service = Pretendo, stored in
# settings.xml as <AccountService><SelectedService PersistentId=".." Service="2"/></AccountService>
# (NetworkService: 0 Offline, 1 Nintendo, 2 Pretendo, 3 Custom). It needs the console's own otp.bin and
# seeprom.bin and an account.dat for a Pretendo Network ID (PNID). No hosts-file or DNS change is involved.
CEMU_SERVICES = {0: "Offline", 1: "Nintendo", 2: "Pretendo", 3: "Custom"}


def cemu_paths():
    """(exe, data dir) for the installed Cemu, by Cemu's own rule (src/gui/wxgui/CemuApp.cpp DeterminePaths):
    a "portable" folder next to Cemu.exe wins; on Windows a settings.xml next to Cemu.exe means the old portable
    layout (Cemu before 2.0-89), so everything is read from the exe folder; otherwise the user folder."""
    _, emulators, _ = load_catalog()
    exe = find_exe("cemu", emulators["cemu"]) if "cemu" in emulators else None
    if not exe:
        return None, None
    if (exe.parent / "portable").is_dir():
        return exe, exe.parent / "portable"
    if WIN and (exe.parent / "settings.xml").is_file():
        return exe, exe.parent
    if WIN:
        return exe, Path(os.environ.get("APPDATA", "")) / "Cemu"
    return exe, Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "Cemu"


def _cemu_settings(data):
    for cand in (data / "settings.xml", (Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "Cemu" / "settings.xml") if not WIN else None):
        if cand and cand.is_file():
            return cand
    return data / "settings.xml"


def pretendo_status():
    import xml.etree.ElementTree as ET
    exe, data = cemu_paths()
    out = {"ok": True, "installed": bool(exe), "ready": False, "problems": [], "service": None, "account": None, "accounts": []}
    if not exe:
        out["problems"].append("Cemu isn't installed (emulators/cemu/).")
        return out
    out["dataDir"] = str(data)
    if (exe.parent / "cemuhook.dll").is_file() and not (exe.parent / "portable").is_dir() and not data.is_dir():
        out["problems"].append("This looks like Cemu 1.x (cemuhook.dll). Pretendo needs Cemu 2.0 or newer.")
    # Cemu 2.x reads these from its data folder only (the portable folder, else the user folder): copies next to
    # Cemu.exe are ignored ("IOSU_CRYPTO: No otp.bin found" in its log). Report them so the owner can move them.
    portable = data.resolve() != Path(os.environ.get("APPDATA", "")).resolve() / "Cemu" if WIN else (exe.parent / "portable").is_dir()
    out["portable"] = portable
    out["stray"] = []
    if not portable:
        for f in ("otp.bin", "seeprom.bin", "network_services.xml"):
            if (exe.parent / f).is_file() and not (data / f).is_file():
                out["stray"].append(f)
    for f, size in (("otp.bin", 1024), ("seeprom.bin", 512)):
        p = data / f
        if not p.is_file():
            out["problems"].append(f"{f} is missing in {data}: dump it from your own Wii U (Dumpling), or make it with your own Pretendo server.")
        elif p.stat().st_size != size:
            out["problems"].append(f"{f} in {data} is {p.stat().st_size} bytes; a real one is {size}.")
    settings = _cemu_settings(data)
    persistent, service, mlc, online = None, None, data / "mlc01", None
    if settings.is_file():
        try:
            root = ET.parse(settings).getroot()
            pid = root.findtext("Account/PersistentId")
            persistent = int(pid) if pid and pid.strip().isdigit() else None
            m = (root.findtext("mlc_path") or "").strip()
            if m:
                mlc = Path(m)
            legacy = root.findtext("Account/ActiveService")
            online = (root.findtext("Account/OnlineEnabled") or "").strip().lower() == "true"
            out["proxy"] = (root.findtext("proxy_server") or "").strip()
            for el in root.findall("AccountService/SelectedService"):
                if persistent is not None and el.get("PersistentId", "").isdigit() and int(el.get("PersistentId")) == persistent:
                    service = int(el.get("Service", "0") or 0)
            if service is None and legacy and legacy.strip().lstrip("-").isdigit():
                online = (root.findtext("Account/OnlineEnabled") or "").strip().lower() == "true"
                service = int(legacy) if online else 0
        except (ET.ParseError, OSError, ValueError) as err:
            out["problems"].append(f"Couldn't read {settings.name}: {err}")
    else:
        out["problems"].append("Cemu hasn't been set up yet (no settings.xml): open Cemu once and finish its first-run setup.")
    act = mlc / "usr" / "save" / "system" / "act"
    # Accounts next to Cemu.exe that Cemu's own mlc01 doesn't have yet.
    if not portable:
        here = exe.parent / "mlc01" / "usr" / "save" / "system" / "act"
        try:
            missing = [d.name for d in here.iterdir() if d.is_dir() and (d / "account.dat").is_file() and not (act / d.name / "account.dat").is_file()]
        except OSError:
            missing = []
        if missing:
            out["stray"].append("mlc01 account " + ", ".join(sorted(missing)))
    if out["stray"]:
        out["problems"].insert(0, f"Online files are next to Cemu.exe ({', '.join(out['stray'])}), but Cemu only reads {data}: press Copy them to where Cemu reads.")
    try:
        dirs = sorted(d for d in act.iterdir() if d.is_dir())
    except OSError:
        dirs = []
    for d in dirs:
        info = {}
        try:
            for line in (d / "account.dat").read_text(encoding="utf-8", errors="replace").splitlines():
                k, _, v = line.partition("=")
                if k in ("PersistentId", "AccountId", "MiiName"):
                    info[k] = v.strip()[:64]
        except OSError:
            continue
        pid = int(info["PersistentId"], 16) if re.fullmatch(r"[0-9a-fA-F]{8}", info.get("PersistentId", "")) else int(d.name, 16) if re.fullmatch(r"[0-9a-fA-F]{8}", d.name) else None
        out["accounts"].append({"persistentId": pid, "networkId": info.get("AccountId", ""), "folder": d.name})
    if persistent is not None:
        out["account"] = next((a for a in out["accounts"] if a["persistentId"] == persistent), {"persistentId": persistent, "networkId": "", "folder": f"{persistent:08x}"})
    out["service"] = CEMU_SERVICES.get(service) if service is not None else None
    if settings.is_file():
        if not out["account"] or not (act / out["account"]["folder"] / "account.dat").is_file():
            out["problems"].append("The active Cemu account has no account.dat: download it for your PNID (Pretendo account page) or dump it from your Wii U, then pick it in Options > General settings > Account.")
        elif not out["account"]["networkId"]:
            out["problems"].append("The active Cemu account isn't linked to a network ID: use an account.dat made for your Pretendo Network ID (PNID).")
        if out["service"] not in ("Pretendo", "Custom"):
            extra = " (Nintendo Network shut down in April 2024)" if out["service"] == "Nintendo" else ""
            out["problems"].append(f"Cemu's network service is {out['service'] or 'not set'}{extra}: choose Pretendo in Options > General settings > Account (or press Use Pretendo).")
        elif out["service"] == "Custom" and not (data / "network_services.xml").is_file():
            out["problems"].append(f"The network service is Custom, but there's no network_services.xml in {data}.")
        if online is False:
            out["problems"].append("Online mode is off: tick it in Options > General settings > Account (Use Pretendo does it too).")
    out["online"] = online
    act_url = ""
    if (data / "network_services.xml").is_file():
        try:
            ns = ET.parse(data / "network_services.xml").getroot()
            out["customName"] = (ns.findtext("networkname") or "").strip()[:40]
            act_url = (ns.findtext("urls/act") or "").strip()
        except (ET.ParseError, OSError):
            out["customName"] = ""
    # SmmServer's FakeOnlineFiles (account "dummy") only work with SmmServer itself: Custom service, server running.
    fake = bool(out["account"]) and out["account"].get("networkId", "").lower() == "dummy"
    out["fakeFiles"] = fake
    if fake and out["service"] == "Pretendo":
        out["problems"].append("These are SmmServer's FakeOnlineFiles (account “dummy”): they only work with SmmServer, not Pretendo. Pick Custom (network_services.xml) and start SmmServer, or use your own Wii U files for Pretendo.")
    if out["service"] == "Custom" and act_url:
        m = re.match(r"https?://([^/:]+)(?::(\d+))?", act_url)
        if m:
            import socket
            host, port = m.group(1), int(m.group(2) or (443 if act_url.startswith("https") else 80))
            try:
                socket.create_connection((host, port), timeout=0.8).close()
                out["customUp"] = True
            except OSError:
                out["customUp"] = False
                out["problems"].append(f"The Custom server ({out.get('customName') or 'network_services.xml'}) isn't answering at {host}:{port}: start it (for SmmServer, run SmmServer and press Start) before playing.")
    out["ready"] = not out["problems"]
    return out


SERVICE_IDS = {"offline": 0, "nintendo": 1, "pretendo": 2, "custom": 3}


def pretendo_enable(service="pretendo", proxy=None):
    """Set the network service (default Pretendo) and online mode for Cemu's active account; proxy = own server.
    Keeps settings.xml.bak-retrohub first (the first time) plus a timestamped copy in backup/."""
    import shutil
    import xml.etree.ElementTree as ET
    exe, data = cemu_paths()
    if not exe:
        raise SystemExit("Cemu isn't installed.")
    settings = _cemu_settings(data)
    if not settings.is_file():
        raise SystemExit("Cemu hasn't been set up yet (no settings.xml). Open Cemu once first.")
    tree = ET.parse(settings)
    root = tree.getroot()
    pid = (root.findtext("Account/PersistentId") or "").strip()
    if not pid.isdigit():
        raise SystemExit("Cemu has no active account. Pick one in Options > General settings > Account.")
    svc = root.find("AccountService")
    if svc is None:
        svc = ET.SubElement(root, "AccountService")
    el = next((e for e in svc.findall("SelectedService") if e.get("PersistentId") == pid), None)
    if el is None:
        el = ET.SubElement(svc, "SelectedService", {"PersistentId": pid})
    if service not in SERVICE_IDS:
        raise SystemExit(f"Unknown network service {service!r}.")
    el.set("Service", str(SERVICE_IDS[service]))
    # Older Cemu builds read <Account><ActiveService>; the online-mode tick is <Account><OnlineEnabled>.
    acct = root.find("Account")
    for tag, val in (("ActiveService", str(SERVICE_IDS[service])), ("OnlineEnabled", "false" if service == "offline" else "true")):
        e = acct.find(tag)
        if e is None:
            e = ET.SubElement(acct, tag)
        e.text = val
    if proxy is not None:
        proxy = proxy.strip()
        if proxy and not re.fullmatch(r"https?://[\w.-]+(:\d{1,5})?/?", proxy):
            raise SystemExit("The server address should look like http://192.168.1.20:8080")
        e = root.find("proxy_server")
        if e is None:
            e = ET.SubElement(root, "proxy_server")
        e.text = proxy
    backup = settings.with_name(settings.name + ".bak-retrohub")
    if not backup.exists():
        shutil.copy2(settings, backup)
    stamped = Path(__file__).resolve().parent / "backup" / f"cemu-online-{time.strftime('%Y%m%d-%H%M%S')}" / "settings.xml"
    stamped.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(settings, stamped)
    tmp = settings.with_suffix(".tmp-retrohub")
    tree.write(tmp, encoding="utf-8", xml_declaration=True)
    tmp.replace(settings)
    return {"ok": True, "backup": str(stamped), "service": service}


def pretendo_import(folder):
    """Copy the player's OWN online files into the folder Cemu reads: otp.bin, seeprom.bin, network_services.xml
    and mlc01/usr/save/system/act/<id> accounts. Source: a Dumpling dump, a pretendo-docker online-files folder,
    or "" = Cemu's own exe folder (files put there by mistake). Everything replaced is copied to backup/ first."""
    import shutil
    exe, data = cemu_paths()
    if not exe:
        raise SystemExit("Cemu isn't installed.")
    src = Path(folder).expanduser().resolve() if folder else exe.parent
    if not src.is_dir():
        raise SystemExit(f"Folder not found: {src}")
    if src == data.resolve():
        raise SystemExit("Those files are already in the folder Cemu reads.")
    otp, see = src / "otp.bin", src / "seeprom.bin"
    if not (otp.is_file() and otp.stat().st_size == 1024 and see.is_file() and see.stat().st_size == 512):
        raise SystemExit("That folder needs otp.bin (1024 bytes) and seeprom.bin (512 bytes) from your Wii U.")
    mlc = data / "mlc01"
    settings = _cemu_settings(data)
    if settings.is_file():
        try:
            import xml.etree.ElementTree as ET
            m = (ET.parse(settings).getroot().findtext("mlc_path") or "").strip()
            if m:
                mlc = Path(m)
        except (OSError, Exception):  # noqa: BLE001
            pass
    bk = Path(__file__).resolve().parent / "backup" / f"cemu-online-{time.strftime('%Y%m%d-%H%M%S')}"

    def put(s, d, rel):
        if d.exists():
            b = bk / rel
            b.parent.mkdir(parents=True, exist_ok=True)
            (shutil.copytree if d.is_dir() else shutil.copy2)(d, b)
        d.parent.mkdir(parents=True, exist_ok=True)
        if s.is_dir():
            shutil.copytree(s, d, dirs_exist_ok=True)
        else:
            shutil.copy2(s, d)

    copied = []
    for name in ("otp.bin", "seeprom.bin", "network_services.xml"):
        if (src / name).is_file():
            put(src / name, data / name, name)
            copied.append(name)
    accounts = []
    act = src / "mlc01" / "usr" / "save" / "system" / "act"
    if act.is_dir():
        for d in sorted(act.iterdir()):
            if d.is_dir() and re.fullmatch(r"8[0-9a-fA-F]{7}", d.name) and (d / "account.dat").is_file():
                put(d, mlc / "usr" / "save" / "system" / "act" / d.name, f"act/{d.name}")
                accounts.append(d.name)
    return {"ok": True, "copied": copied, "accounts": accounts, "to": str(data), "backup": str(bk) if bk.exists() else None}


def list_all():
    st = status()
    print(f"Emulators folder: {emu_dir()}\n\nEmulators:")
    for eid, e in st["emulators"].items():
        print(f"  {'[x]' if e['installed'] else '[ ]'} {e['label']:<26} {eid}{'  (yours)' if e['custom'] else ''}")
    print("\nConsoles:")
    for sid, s in st["systems"].items():
        if sid != "pc":
            print(f"  {'[x]' if s['installed'] else '[ ]'} {s['label']:<18} -> {s['emulatorLabel'] or '-'}")
    print("\nPC games:")
    for g in st["games"] or []:
        print(f"  {'[x]' if g['installed'] else '[missing]'} {g['name']}  ({g['id']})")
    if not st["games"]:
        print("  (none yet: python apps.py add-game \"Name\" \"C:\\path\\game.exe\")")


def browse():
    try:
        import tkinter as tk
        from tkinter import filedialog
        r = tk.Tk()
        r.withdraw()
        r.attributes("-topmost", True)
        p = filedialog.askopenfilename(title="Pick the program", filetypes=[("Programs", "*.exe")] if WIN else [])
        r.destroy()
        return p
    except Exception:
        return ""


def menu():
    while True:
        print()
        list_all()
        print("\n[1] Add a PC game   [2] Add an emulator   [3] Remove   [q] Quit")
        c = input("> ").strip().lower()
        try:
            if c == "1":
                name = input("Game name: ").strip()
                exe = input("Path to the game's .exe (Enter = browse): ").strip() or browse()
                extra = input("Extra launch options (optional): ").strip()
                if name and exe:
                    add_game(name, exe, split_args(extra))
            elif c == "2":
                label = input("Emulator name (e.g. Ryujinx): ").strip()
                exe = input("Path to its .exe (Enter = browse): ").strip() or browse()
                systems, _, _ = load_catalog()
                print("Consoles: " + ", ".join(k for k in systems if k != "pc"))
                syscsv = input("Which consoles (comma separated; or 'new' for a console not listed): ").strip()
                new = None
                if syscsv.lower() == "new":
                    sid = input("  console id (e.g. vita): ").strip()
                    sl = input("  console name (e.g. PS Vita): ").strip()
                    ext = input("  file extensions (e.g. vpk,zip): ").strip()
                    dirs = input("  library folder name(s) (e.g. vita): ").strip()
                    new, syscsv = f"{sid}:{sl}:{ext}:{dirs}", ""
                args = input('Launch options, {game} = game path (Enter = "{game}"): ').strip()
                if label and exe:
                    add_emulator(label, exe, syscsv, label, args, new)
            elif c == "3":
                remove(input("Id to remove: ").strip())
            elif c in ("q", "quit", "exit", ""):
                return
        except SystemExit as e:
            print(f"! {e}")


def main():
    ap = argparse.ArgumentParser(description="Retro Hub apps: native emulators and PC games")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("list")
    sub.add_parser("status")
    sub.add_parser("pretendo-status")
    pe = sub.add_parser("pretendo-enable")
    pe.add_argument("--service", default="pretendo", choices=sorted(SERVICE_IDS))
    pe.add_argument("--proxy", default=None, help="own Pretendo server, e.g. http://192.168.1.20:8080 (\"\" clears)")
    dn = sub.add_parser("dolphin-netplay")
    dn.add_argument("--gba-bios", required=True)
    dn.add_argument("--players", type=int, default=4)
    dn.add_argument("--nickname", default="")
    dn.add_argument("--host-code", default="")
    dn.add_argument("--buffer", type=int, default=0)
    pi = sub.add_parser("pretendo-import")
    pi.add_argument("folder", nargs="?", default="")
    g = sub.add_parser("add-game")
    g.add_argument("name")
    g.add_argument("exe")
    g.add_argument("args", nargs=argparse.REMAINDER)
    e = sub.add_parser("add-emulator")
    e.add_argument("id")
    e.add_argument("exe")
    e.add_argument("--systems", default="")
    e.add_argument("--label")
    e.add_argument("--args", help='launch options, e.g. "-f {game}"')
    e.add_argument("--new-system", help="id:Label:ext1,ext2:folder1,folder2")
    r = sub.add_parser("remove")
    r.add_argument("id")
    rn = sub.add_parser("run")
    rn.add_argument("--app", required=True)
    rn.add_argument("--game")
    rn.add_argument("--job", default="")
    rn.add_argument("--link", action="append", default=[], help="network link setting KEY=VALUE (host, port, players, role)")
    rn.add_argument("--headless", action="store_true", help="keep the program's windows off-screen (the browser shows it)")
    rn.add_argument("--gba-bios", default="", help="Dolphin GBA (Integrated) mode: your GBA BIOS (16 KB)")
    rn.add_argument("--gba-players", type=int, default=4, help="GBA mode: how many ports get a GBA (1-4)")
    a = ap.parse_args()
    if a.cmd == "list":
        list_all()
    elif a.cmd == "status":
        print(json.dumps(status()))
    elif a.cmd == "pretendo-status":
        print(json.dumps(pretendo_status()))
    elif a.cmd == "pretendo-enable":
        try:
            print(json.dumps(pretendo_enable(a.service, a.proxy)))
        except SystemExit as err:
            print(json.dumps({"ok": False, "error": str(err)}))
        except (OSError, Exception) as err:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"couldn't change settings.xml: {err}"}))
    elif a.cmd == "dolphin-netplay":
        try:
            print(json.dumps(dolphin_netplay(a.gba_bios, a.players, a.nickname, a.host_code, a.buffer)))
        except SystemExit as err:
            print(json.dumps({"ok": False, "error": str(err)}))
        except (OSError, Exception) as err:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"couldn't start Dolphin: {err}"}))
    elif a.cmd == "pretendo-import":
        try:
            print(json.dumps(pretendo_import(a.folder)))
        except SystemExit as err:
            print(json.dumps({"ok": False, "error": str(err)}))
        except (OSError, Exception) as err:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"couldn't copy the files: {err}"}))
    elif a.cmd == "add-game":
        add_game(a.name, a.exe, [x for x in a.args if x != "--"])
    elif a.cmd == "add-emulator":
        add_emulator(a.id, a.exe, a.systems, a.label, a.args, a.new_system)
    elif a.cmd == "remove":
        remove(a.id)
    elif a.cmd == "run":
        try:
            run(a.app, a.game, a.job, parse_link(a.link), headless=a.headless,
                gba={"bios": a.gba_bios, "players": a.gba_players} if a.gba_bios else None)
        except SystemExit as err:
            emit(t="error", error=str(err))
            sys.exit(1)
        except OSError as err:
            emit(t="error", error=f"couldn't start: {err}")
            sys.exit(1)
    else:
        menu()


if __name__ == "__main__":
    main()
