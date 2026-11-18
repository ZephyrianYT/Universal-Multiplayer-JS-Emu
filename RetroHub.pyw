#!/usr/bin/env python3
"""Retro Hub control panel: one window to start/stop the hub, edit settings and files, and run admin commands.

Double-click launch.bat (Windows) or run:  python RetroHub.pyw
Uses only the Python standard library (Python 3.8+ with tkinter).

Tabs:
  Server    start / stop the hub (local, Wi-Fi, or Cloudflare Tunnel), live log, copy links
  Settings  edit .env (owner password, access code, port, ROM folder, tunnel...); Consoles... sets each
            console's games folder and emulator
  Apps      native emulators and PC games (same as apps.py); Check requirements
On Windows it checks for Node.js and controller support (ViGEmBus + vgamepad) when it opens and offers to
download, safety-check and install what's missing (setup/deps.ps1).
  Files     browse and edit the hub's own files
  Console   simple admin terminal (shortcuts: help, start, stop, apps ..., env, clear)
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import queue
import re
import shlex
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, simpledialog, ttk
except ImportError:  # pragma: no cover - only on Pythons built without Tk
    print("This Python has no tkinter. Install Python from https://www.python.org (tick 'tcl/tk'), "
          "or run: python launch.py")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
RUN_FILE = ROOT / "run" / "retro-hub.json"
LIB_FILE = ROOT / "library-folders.json"         # per-console games folders (shared with the hub's "Library folders")
DEPS = ROOT / "setup" / "deps.ps1"                # checks / downloads / safety-checks / installs requirements
UPDATER = ROOT / "setup" / "update.py"            # newest GitHub release: check, download, safety-check, install
ICON_DIR = ROOT / "assets" / "icon"               # the mascot icon (assets/icon/make_icon.py builds it)
SKIP_FILE = ROOT / "cache" / "setup-skipped.json"  # requirements the owner said No to (not asked again at startup)
WIN = sys.platform == "win32"
NO_WINDOW = 0x08000000 if WIN else 0  # CREATE_NO_WINDOW: child consoles stay hidden
PY = sys.executable
if WIN and Path(PY).name.lower() == "pythonw.exe":  # children need a real console python for their output
    cand = Path(PY).with_name("python.exe")
    if cand.is_file():
        PY = str(cand)

URL_RE = re.compile(r"Retro Hub is running:\s+(\S+)")
LAN_RE = re.compile(r"Friends on your Wi-Fi:\s+(\S+)")
PUBLIC_RE = re.compile(r"Public address:\s+(\S+)")   # tunnel: the address friends use
SKIP_DIRS = {"node_modules", ".git", "__pycache__", "run", "cores"}
MAX_EDIT = 2 * 1024 * 1024

SETTINGS = [
    # key, label, kind, help
    ("ADMIN_PASSWORD", "Owner password", "secret", "Unlocks the library in the hub (8+ characters)."),
    ("ACCESS_PASSWORD", "Server access code", "secret", "Asked once per account. Empty = anyone with the link."),
    ("PORT", "Port", "text", "Web port, default 8080."),
    ("MAX_PLAYERS", "Max players", "text", "Players per lobby (default 4)."),
    ("ROMS_DIR", "ROM folder", "dir", "Your game library. Empty = ./roms"),
    ("EMULATORS_DIR", "Emulators folder", "dir", "Native emulator builds. Empty = ./emulators"),
    ("LIBRARY_ACCESS", "Library access", "choice:admin,all", "admin = owner only, all = every account."),
    ("ADMIN_KEYS", "Owner account IDs", "text", "Comma-separated account IDs that are always owner."),
    ("NATIVE_INPUT", "Native guest input", "choice:auto,gamepad,keyboard", "How guests control native emulators."),
    ("PUBLIC_URL", "Public URL", "text", "Your own https address (named tunnel / reverse proxy)."),
    ("TUNNEL_TOKEN", "Tunnel token", "secret", "Cloudflare named tunnel token. Needs Public URL too."),
    ("UPDATE_CHECK", "Check for updates", "choice:on,off", "Look for a new Retro Hub release when this window opens."),
    ("UPDATE_REPO", "Update source", "text", "GitHub owner/repo for updates. Empty = the official one."),
]


# ------------------------------------------------------------------ .env helpers
def read_env() -> dict[str, str]:
    """Same rules as launch.py's read_env."""
    out: dict[str, str] = {}
    if not ENV_FILE.is_file():
        return out
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        val = val.strip()
        if val.startswith("#"):
            val = ""
        elif val[:1] in "\"'" and val[-1:] == val[:1] and len(val) >= 2:
            val = val[1:-1]
        else:
            val = re.split(r"\s+#", val, maxsplit=1)[0].strip()
        out[key.strip()] = val
    return out


def fmt_val(v: str) -> str:
    return f'"{v}"' if (re.search(r"\s|#", v) and '"' not in v) else v


def write_env(values: dict[str, str]) -> None:
    """Update keys in place (keeping comments and other lines), comment out cleared ones, append new ones."""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.is_file() else []
    done = set()
    for i, raw in enumerate(lines):
        m = re.match(r"\s*(#\s*)?([A-Z][A-Z0-9_]*)\s*=", raw)
        if not m:
            continue
        key, commented = m.group(2), bool(m.group(1))
        if key not in values or key in done:
            continue
        v = values[key]
        if v:
            lines[i] = f"{key}={fmt_val(v)}"
        elif not commented:
            lines[i] = f"# {key}="
        done.add(key)
    for key, v in values.items():
        if key not in done and v:
            lines.append(f"{key}={fmt_val(v)}")
    tmp = ENV_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    tmp.replace(ENV_FILE)


def hub_answers(port: int, instance: str | None = None) -> bool:
    """Retro Hub itself (not another program) answers on http://localhost:<port>, on both addresses that "localhost"
    can mean. With an instance id (from run/retro-hub.json), it must be that very run. Servers before 1.26.1 have
    no /api/instance and count as not answering, so a stale run file never vouches for another program."""
    seen = False
    for addr in ("127.0.0.1", "[::1]"):
        try:
            with urllib.request.urlopen(f"http://{addr}:{port}/api/instance", timeout=1.5) as r:
                info = json.loads(r.read(4096).decode("utf-8", "replace"))
        except urllib.error.HTTPError:          # some other web server
            return False
        except urllib.error.URLError as e:
            if isinstance(e.reason, ConnectionRefusedError) or (isinstance(e.reason, OSError) and not isinstance(e.reason, TimeoutError)):
                continue     # nothing on this address (or no IPv6 here): browsers skip it
            return False
        except (OSError, ValueError):           # timed out, or not JSON
            return False
        if not isinstance(info, dict) or info.get("app") != "retro-hub" or (instance and info.get("instance") != instance):
            return False
        seen = True
    return seen


def port_open(port: int) -> bool:
    """Something accepts connections on this port on 127.0.0.1 or ::1 (the two addresses "localhost" means)."""
    for family, addr in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                if s.connect_ex((addr, port)) == 0:
                    return True
        except OSError:      # no IPv6 on this computer
            continue
    return False


def kill_tree(pid: int) -> None:
    if WIN:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW)
    else:
        import signal
        with contextlib.suppress(OSError):
            os.killpg(pid, signal.SIGTERM)


def open_path(p: Path) -> None:
    if WIN:
        os.startfile(str(p))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)])


def refresh_path() -> None:
    """Pick up PATH changes an installer just made (Node.js), so the hub can be started without reopening."""
    if not WIN:
        return
    import winreg  # noqa: PLC0415
    parts = []
    for hive, key in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
                      (winreg.HKEY_CURRENT_USER, "Environment")):
        try:
            with winreg.OpenKey(hive, key) as k:
                parts.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        except OSError:
            pass
    if parts:
        os.environ["PATH"] = ";".join(parts)


def child_env() -> dict[str, str]:
    return {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1", "FORCE_COLOR": "0"}


# ------------------------------------------------------------------ the window
class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("Retro Hub")
        try:      # the mascot in the title bar and taskbar
            self.icon_img = tk.PhotoImage(file=str(ICON_DIR / "retrohub-64.png"))
            root.iconphoto(True, self.icon_img)
            if WIN:
                root.iconbitmap(default=str(ICON_DIR / "retrohub.ico"))
        except (tk.TclError, OSError):
            pass
        root.geometry("980x680")
        root.minsize(760, 520)
        self.q: queue.Queue = queue.Queue()
        self.server: subprocess.Popen | None = None
        self.cmd_proc: subprocess.Popen | None = None
        self.url = ""
        self.lan = ""
        self.public = ""      # tunnel address (Copy link); the hub itself always opens on localhost
        self.stopping = False
        self.cur_file: Path | None = None
        self.history: list[str] = []
        self.hist_i = 0

        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("Status.TLabel", font=("Segoe UI", 11, "bold"))

        nb = self.nb = ttk.Notebook(root)
        nb.pack(fill="both", expand=True, padx=8, pady=8)
        self.build_server(nb)
        self.build_settings(nb)
        self.build_apps(nb)
        self.build_files(nb)
        self.build_console(nb)

        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(80, self.pump)
        self.root.after(500, self.poll_status)
        self.log("Retro Hub control panel. Press Start to run the hub.\n", "info")
        self.check_external()
        self.root.after(300, self.check_setup)
        # First run (or started with --setup / --create-shortcut): offer the desktop shortcut.
        if "--create-shortcut" in sys.argv:
            self.root.after(700, lambda: self.make_shortcut(ask=False))
        elif "--setup" in sys.argv or self.shortcut_mod().should_prompt():
            self.root.after(700, lambda: self.make_shortcut(ask=True))
        if read_env().get("UPDATE_CHECK", "on").strip().lower() not in ("off", "0", "no", "false"):
            self.root.after(2500, self.check_updates)
        self.root.after(1200, self.check_requirements)

    # ---------------------------------------------------------- shared helpers
    def mono_text(self, parent: tk.Widget, **kw) -> tk.Text:
        frame = ttk.Frame(parent)
        frame.pack(fill="both", expand=True)
        t = tk.Text(frame, wrap="word", font=("Consolas", 10), bg="#14161a", fg="#d6d9de",
                    insertbackground="#ffffff", relief="flat", padx=8, pady=6, **kw)
        sb = ttk.Scrollbar(frame, command=t.yview)
        t.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        t.pack(side="left", fill="both", expand=True)
        for tag, col in (("info", "#7fb2ff"), ("err", "#ff7b7b"), ("ok", "#7ddc8a"), ("cmd", "#e5c07b")):
            t.tag_configure(tag, foreground=col)
        return t

    def append(self, widget: tk.Text, text: str, tag: str | None = None) -> None:
        at_end = widget.yview()[1] > 0.98
        widget.configure(state="normal")
        widget.insert("end", text, tag or ())
        if int(widget.index("end-1c").split(".")[0]) > 5000:
            widget.delete("1.0", "1000.0")
        widget.configure(state="disabled")
        if at_end:
            widget.see("end")

    def log(self, text: str, tag: str | None = None) -> None:
        self.q.put(("log", text, tag))

    def clog(self, text: str, tag: str | None = None) -> None:
        self.q.put(("con", text, tag))

    def call(self, fn) -> None:
        """Run fn on the Tk thread (tkinter is not thread-safe)."""
        self.q.put(("call", fn, None))

    def pump(self) -> None:
        try:
            while True:
                kind, text, tag = self.q.get_nowait()
                if kind == "call":  # work from a background thread that must touch widgets
                    text()
                    continue
                self.append(self.log_box if kind == "log" else self.con_box, text, tag)
                if kind == "log":
                    self.scan_line(text)
        except queue.Empty:
            pass
        self.root.after(80, self.pump)

    def stream(self, proc: subprocess.Popen, sink, on_exit=None) -> None:
        def run() -> None:
            assert proc.stdout is not None
            for line in iter(proc.stdout.readline, ""):
                sink(line)
            code = proc.wait()
            if on_exit:
                self.call(lambda: on_exit(code))
        threading.Thread(target=run, daemon=True).start()

    # ---------------------------------------------------------- Server tab
    def build_server(self, nb: ttk.Notebook) -> None:
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="  Server  ")
        top = ttk.Frame(f)
        top.pack(fill="x")
        self.status = ttk.Label(top, text="Stopped", style="Status.TLabel", foreground="#b33")
        self.status.pack(side="left")
        self.btn_start = ttk.Button(top, text="▶ Start", command=self.start_server)
        self.btn_start.pack(side="right", padx=3)
        self.btn_stop = ttk.Button(top, text="■ Stop", command=self.stop_server, state="disabled")
        self.btn_stop.pack(side="right", padx=3)
        self.btn_restart = ttk.Button(top, text="↻ Restart", command=self.restart_server, state="disabled")
        self.btn_restart.pack(side="right", padx=3)
        ttk.Button(top, text="Check for updates", command=lambda: self.check_updates(manual=True)).pack(side="right", padx=(3, 12))
        self.update_info: dict | None = None

        # Setup warnings (check_setup): only shown when something needs fixing.
        self.warn_box = ttk.LabelFrame(f, text="Setup needs a look", padding=(8, 4))
        self.warn_anchor = ttk.Frame(f)
        self.warn_anchor.pack(fill="x")

        opts = ttk.LabelFrame(f, text="How friends connect", padding=8)
        opts.pack(fill="x", pady=8)
        self.mode = tk.StringVar(value="lan")
        for val, txt in (("lan", "This computer + Wi-Fi/LAN"),
                         ("local", "This computer only"),
                         ("tunnel", "Internet (Cloudflare Tunnel)")):
            ttk.Radiobutton(opts, text=txt, value=val, variable=self.mode).pack(side="left", padx=6)
        self.keep_lan = tk.BooleanVar(value=False)
        ttk.Checkbutton(opts, text="Tunnel: keep Wi-Fi link too", variable=self.keep_lan).pack(side="left", padx=10)
        self.open_browser = tk.BooleanVar(value=True)
        ttk.Checkbutton(opts, text="Open browser when ready", variable=self.open_browser).pack(side="right")

        links = ttk.Frame(f)
        links.pack(fill="x")
        self.link_var = tk.StringVar(value="Hub address: -")
        ttk.Label(links, textvariable=self.link_var).pack(side="left")
        self.btn_open = ttk.Button(links, text="Open hub", command=lambda: self.url and webbrowser.open(self.url),
                                   state="disabled")
        self.btn_open.pack(side="right", padx=3)
        self.btn_copy = ttk.Button(links, text="Copy link", command=self.copy_link, state="disabled")
        self.btn_copy.pack(side="right", padx=3)
        self.btn_copy_lan = ttk.Button(links, text="Copy Wi-Fi link", command=lambda: self.copy(self.lan),
                                       state="disabled")
        self.btn_copy_lan.pack(side="right", padx=3)

        bar = ttk.Frame(f)
        bar.pack(fill="x", pady=(8, 2))
        ttk.Label(bar, text="Server log").pack(side="left")
        ttk.Button(bar, text="Clear", command=lambda: self.clear(self.log_box)).pack(side="right")
        ttk.Button(bar, text="Open folder", command=lambda: open_path(ROOT)).pack(side="right", padx=3)
        self.log_box = self.mono_text(f, state="disabled")

    def clear(self, w: tk.Text) -> None:
        w.configure(state="normal")
        w.delete("1.0", "end")
        w.configure(state="disabled")

    def copy(self, s: str) -> None:
        if s:
            self.root.clipboard_clear()
            self.root.clipboard_append(s)
            self.log(f"Copied {s}\n", "info")

    def copy_link(self) -> None:
        self.copy(self.public or self.url)

    def scan_line(self, line: str) -> None:
        m = URL_RE.search(line)
        if m:
            self.url = m.group(1)
            self.link_var.set(f"Hub address: {self.url}")
            self.set_running(True)
            if self.open_browser.get():
                webbrowser.open(self.url)
        m = PUBLIC_RE.search(line)
        if m:
            self.public = m.group(1)
            self.link_var.set(f"Hub address: {self.url}   ·   Public (for friends): {self.public}")
        m = LAN_RE.search(line)
        if m:
            self.lan = m.group(1)
            self.btn_copy_lan.configure(state="normal")

    def set_running(self, up: bool, external: bool = False) -> None:
        if up:
            self.status.configure(text="Running" + (" (started elsewhere)" if external else ""), foreground="#1a7f37")
        else:
            self.status.configure(text="Stopped", foreground="#b33")
        busy = up or (self.server is not None and self.server.poll() is None)
        self.btn_start.configure(state="disabled" if busy else "normal")
        self.btn_stop.configure(state="normal" if busy else "disabled")
        self.btn_restart.configure(state="normal" if busy else "disabled")
        for b in (self.btn_open, self.btn_copy):
            b.configure(state="normal" if up and self.url else "disabled")
        if not up:
            self.btn_copy_lan.configure(state="disabled")

    def check_external(self) -> None:
        """A hub already running (from a terminal, or an earlier window)."""
        try:
            info = json.loads(RUN_FILE.read_text(encoding="utf-8"))
            port = int(info["port"])
        except (OSError, ValueError, KeyError, TypeError):
            return
        if port_open(port) and hub_answers(port, info.get("instance")):
            self.url = f"http://localhost:{port}"
            self.link_var.set(f"Hub address: {self.url}")
            self.set_running(True, external=True)
            self.log(f"A Retro Hub server is already running on port {port}.\n", "info")

    def poll_status(self) -> None:
        if self.server is None and self.status.cget("text").startswith("Running"):
            try:
                info = json.loads(RUN_FILE.read_text(encoding="utf-8"))
                alive = hub_answers(int(info["port"]), info.get("instance"))
            except (OSError, ValueError, KeyError, TypeError):
                alive = False
            if not alive:
                self.url = self.public = ""
                self.link_var.set("Hub address: -")
                self.set_running(False)
        self.root.after(3000, self.poll_status)

    def start_server(self) -> None:
        if self.server is not None and self.server.poll() is None:
            return
        if self.dirty() and not messagebox.askyesno("Unsaved file", "A file in the Files tab has unsaved changes. "
                                                    "Start anyway (the hub uses the saved version)?"):
            return
        args = [PY, "-u", str(ROOT / "launch.py"), "--no-browser"]
        mode = self.mode.get()
        if mode == "local":
            args.append("--localhost-only")
        elif mode == "tunnel":
            args.append("--tunnel")
            if self.keep_lan.get():
                args.append("--lan")
        self.url = self.lan = self.public = ""
        self.link_var.set("Hub address: starting...")
        names = {"lan": "Wi-Fi/LAN", "local": "this computer only", "tunnel": "internet"}
        self.log(f"\n> Starting ({names[mode]})\n", "cmd")
        try:
            self.server = subprocess.Popen(args, cwd=ROOT, env=child_env(), stdin=subprocess.DEVNULL,
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                           encoding="utf-8", errors="replace", creationflags=NO_WINDOW,
                                           start_new_session=not WIN)
        except OSError as e:
            self.log(f"Could not start: {e}\n", "err")
            return
        self.set_running(False)  # buttons: Stop on, Start off while the child runs
        self.status.configure(text="Starting...", foreground="#9a6700")
        self.stream(self.server, self.log, self.server_exited)

    def server_exited(self, code: int) -> None:
        self.log(f"[server stopped, exit code {code}]\n", "ok" if code == 0 or self.stopping else "err")
        self.server = None
        self.stopping = False
        self.url = self.lan = self.public = ""
        self.link_var.set("Hub address: -")
        self.set_running(False)
        if getattr(self, "_restart", False):
            self._restart = False
            self.start_server()

    def stop_server(self, then=None) -> None:
        self.stopping = True
        self.log("> Stopping...\n", "cmd")
        self.status.configure(text="Stopping...", foreground="#9a6700")

        def work() -> None:
            ok = self.request_shutdown()
            proc = self.server
            if proc is not None:
                end = time.time() + 8
                while proc.poll() is None and time.time() < end:
                    time.sleep(0.2)
                if proc.poll() is None:
                    self.log("Server didn't stop in time; ending it.\n", "err")
                    kill_tree(proc.pid)
            elif not ok:
                self.log("Nothing answered. The server is not running.\n", "info")
            self.call(lambda: (self.server is None and self.set_running(False), then and then()))
        threading.Thread(target=work, daemon=True).start()

    def request_shutdown(self) -> bool:
        try:
            info = json.loads(RUN_FILE.read_text(encoding="utf-8"))
            port, token = int(info["port"]), str(info["token"])
        except (OSError, ValueError, KeyError, TypeError):
            return False
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/shutdown", data=b"{}", method="POST",
                                     headers={"X-Shutdown-Token": token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status in (200, 202)
        except (urllib.error.URLError, OSError):
            with contextlib.suppress(OSError):
                RUN_FILE.unlink()
            return False

    def restart_server(self) -> None:
        if self.server is not None and self.server.poll() is None:
            self._restart = True
            self.stop_server()
        else:
            self.stop_server(then=lambda: self.root.after(1500, self.start_server))

    # ---------------------------------------------------------- Settings tab
    def build_settings(self, nb: ttk.Notebook) -> None:
        f = ttk.Frame(nb, padding=12)
        nb.add(f, text="  Settings  ")
        ttk.Label(f, text="Saved to .env. Restart the hub after changing these.").grid(
            row=0, column=0, columnspan=4, sticky="w", pady=(0, 8))
        self.vars: dict[str, tk.StringVar] = {}
        for r, (key, label, kind, hint) in enumerate(SETTINGS, start=1):
            ttk.Label(f, text=label).grid(row=r, column=0, sticky="w", padx=(0, 10), pady=3)
            v = self.vars[key] = tk.StringVar()
            if kind.startswith("choice:"):
                w = ttk.Combobox(f, textvariable=v, values=[""] + kind[7:].split(","), width=40)
            else:
                w = ttk.Entry(f, textvariable=v, width=44, show="•" if kind == "secret" else "")
            w.grid(row=r, column=1, sticky="we", pady=3)
            if kind == "secret":
                ttk.Button(f, text="Show", width=6, command=lambda e=w: e.configure(
                    show="" if e.cget("show") else "•")).grid(row=r, column=2, padx=3)
            elif kind == "dir":
                ttk.Button(f, text="Browse", width=7, command=lambda vv=v: self.pick_dir(vv)).grid(
                    row=r, column=2, padx=3)
            if key == "ROMS_DIR":  # per-console folders and emulators live one click away from the main ROM folder
                h = ttk.Frame(f)
                h.grid(row=r, column=3, sticky="w", padx=6)
                ttk.Button(h, text="Consoles…", command=self.open_consoles).pack(side="left")
                ttk.Label(h, text="  " + hint, foreground="#666").pack(side="left")
                continue
            ttk.Label(f, text=hint, foreground="#666").grid(row=r, column=3, sticky="w", padx=6)
        f.columnconfigure(1, weight=1)
        b = ttk.Frame(f)
        b.grid(row=len(SETTINGS) + 1, column=0, columnspan=4, sticky="w", pady=12)
        ttk.Button(b, text="Save", command=self.save_settings).pack(side="left")
        ttk.Button(b, text="Reload", command=self.load_settings).pack(side="left", padx=6)
        ttk.Button(b, text="New owner password", command=self.new_admin_pw).pack(side="left")
        ttk.Button(b, text="Edit .env as text", command=lambda: self.open_in_editor(ENV_FILE)).pack(side="left", padx=6)
        ttk.Button(b, text="Desktop shortcut", command=lambda: self.make_shortcut(ask=False)).pack(side="left")
        self.load_settings()

    def pick_dir(self, var: tk.StringVar) -> None:
        d = filedialog.askdirectory(initialdir=var.get() or str(ROOT))
        if d:
            var.set(d)

    def load_settings(self) -> None:
        env = read_env()
        for key, v in self.vars.items():
            v.set(env.get(key, ""))

    def save_settings(self) -> None:
        vals = {k: v.get().strip() for k, v in self.vars.items()}
        if vals["PORT"] and not vals["PORT"].isdigit():
            return messagebox.showerror("Settings", "Port must be a number.")
        if vals["ADMIN_PASSWORD"] and len(vals["ADMIN_PASSWORD"]) < 8:
            return messagebox.showerror("Settings", "The owner password needs at least 8 characters.")
        if vals["TUNNEL_TOKEN"] and not vals["PUBLIC_URL"].startswith("https://"):
            return messagebox.showerror("Settings", "A tunnel token needs a Public URL starting with https://")
        for k in ("ROMS_DIR", "EMULATORS_DIR"):
            if vals[k] and not Path(vals[k]).expanduser().is_dir():
                return messagebox.showerror("Settings", f"Folder not found: {vals[k]}")
        try:
            write_env(vals)
        except OSError as e:
            return messagebox.showerror("Settings", f"Could not save .env: {e}")
        running = self.server is not None or self.status.cget("text").startswith("Running")
        self.log("Settings saved to .env." + (" Restart the hub to apply them.\n" if running else "\n"), "ok")
        self.check_setup()
        if running and messagebox.askyesno("Settings saved", "Restart the hub now to apply them?"):
            self.restart_server()
        if self.cur_file == ENV_FILE:
            self.load_file(ENV_FILE)

    # ---------------------------------------------------------- setup warnings (Server tab)
    def setup_issues(self) -> list[tuple[str, list[tuple[str, object]]]]:
        """Things that stop the hub from finding games or emulators, each with buttons that fix them.
        Runs on a background thread (a disconnected network drive can take seconds to answer)."""
        issues: list[tuple[str, list[tuple[str, object]]]] = []
        env = read_env()
        to_settings = ("Settings…", lambda: self.nb.select(1))
        consoles = ("Consoles…", self.open_consoles)

        def other_install(p: Path) -> Path | None:
            """The other Retro Hub folder p is inside (e.g. an older version's), if any."""
            for parent in [p, *p.parents]:
                if parent != ROOT and (parent / "server.mjs").is_file() and (parent / "apps.py").is_file():
                    return parent
            return None

        def has_emus(d: Path) -> bool:
            try:
                return any((x.is_dir() and not x.name.startswith(".")) or x.name.lower() == "apps.json" for x in d.iterdir())
            except OSError:
                return False

        for key, own, what in (("EMULATORS_DIR", ROOT / "emulators", "Emulators folder"), ("ROMS_DIR", ROOT / "roms", "ROM folder")):
            val = env.get(key, "").strip()
            if not val:
                continue
            p = Path(val).expanduser()
            use_own = (f"Use this install's {own.name} folder", lambda k=key: self.fix_env(k))
            old = other_install(p.resolve()) if p.exists() else None
            if not p.is_dir():
                issues.append((f"{what} {val} doesn't exist (a drive that isn't plugged in?).", [use_own, to_settings]))
            elif old:
                issues.append((f"{what} is in another Retro Hub folder ({old.name}), probably from an older version. "
                               f"Games and emulators added here won't show up.", [use_own, to_settings]))
            elif key == "EMULATORS_DIR" and not has_emus(p):
                issues.append((f"Emulators folder {val} is empty, so the hub uses ./emulators instead.", [use_own, to_settings]))

        try:
            folders = json.loads(LIB_FILE.read_text(encoding="utf-8"))
            folders = folders if isinstance(folders, dict) else {}
        except (OSError, ValueError):
            folders = {}
        gone = [f"{sid} ({d})" for sid, d in folders.items() if isinstance(d, str) and not Path(d).is_dir()]
        if gone:
            issues.append((f"{len(gone)} console folder(s) can't be reached right now: " + ", ".join(gone[:4])
                           + (" …" if len(gone) > 4 else "") + ". Their games won't be in the library.", [consoles]))
        by_dir: dict[str, list[str]] = {}
        for sid, d in folders.items():
            if isinstance(d, str):
                by_dir.setdefault(os.path.normcase(os.path.normpath(d)), []).append(sid)
        shared = [ids for ids in by_dir.values() if len(ids) > 1]
        if shared:
            issues.append(("These consoles share a games folder, so each game is listed once (under the browser console; "
                           "pick the other under Console when hosting): " + "; ".join(" + ".join(ids) for ids in shared) + ".",
                           [consoles]))
        return issues

    def check_setup(self) -> None:
        def work() -> None:
            try:
                issues = self.setup_issues()
            except Exception as e:  # noqa: BLE001 - a check must never break the window
                issues = [(f"Couldn't check the setup: {e}", [])]
            u = self.update_info
            if u and u.get("state") == "newer":
                lt = u["latest"]
                issues.insert(0, (f"Retro Hub update available: {lt['name']} ({lt['published'][:10]}). Your settings, games "
                                  f"and emulators are kept.", [("Update…", self.do_update),
                                                               ("Release notes", lambda: webbrowser.open(lt["page"]))]))
            self.call(lambda: self.show_setup(issues))
        threading.Thread(target=work, daemon=True).start()

    def show_setup(self, issues) -> None:
        for w in self.warn_box.winfo_children():
            w.destroy()
        if not issues:
            self.warn_box.pack_forget()
            return
        for text, buttons in issues:
            row = ttk.Frame(self.warn_box)
            row.pack(fill="x", pady=2)
            for label, fn in reversed(buttons):
                ttk.Button(row, text=label, command=fn).pack(side="right", padx=2)
            ttk.Label(row, text="⚠ " + text, wraplength=620, justify="left").pack(side="left", fill="x", expand=True)
        self.warn_box.pack(fill="x", pady=(8, 0), after=self.warn_anchor)

    # ---------------------------------------------------------- desktop shortcut (setup/shortcut.py)
    def shortcut_mod(self):
        if str(ROOT / "setup") not in sys.path:
            sys.path.insert(0, str(ROOT / "setup"))
        import shortcut  # noqa: PLC0415 - setup/shortcut.py
        return shortcut

    def make_shortcut(self, ask: bool) -> None:
        sc = self.shortcut_mod()
        if ask:
            yes = messagebox.askyesno("Retro Hub", "Would you like to create a RetroHub desktop shortcut?\n\n"
                                      "It opens this window, with the Retro Hub duck as its icon. You can make one "
                                      "later from Settings > Desktop shortcut.")
            if not yes:
                sc.decline()
                self.log("No desktop shortcut. Settings > Desktop shortcut makes one any time.\n", "info")
                return
        r = sc.create()
        if r["ok"]:
            self.log(f"Desktop shortcut created: {r['path']}\n", "ok")
            messagebox.showinfo("Retro Hub", f"Desktop shortcut created:\n{r['path']}")
        else:
            self.log(r["error"] + "\n", "err")
            messagebox.showerror("Retro Hub", r["error"])

    # ---------------------------------------------------------- updates (setup/update.py)
    def run_updater(self, *args: str, timeout: int = 60) -> dict:
        try:
            r = subprocess.run([PY, "-I", str(UPDATER), *args], capture_output=True, text=True, timeout=timeout,
                               cwd=ROOT, creationflags=NO_WINDOW)
            return json.loads(r.stdout.strip().splitlines()[-1])
        except (OSError, ValueError, IndexError, subprocess.TimeoutExpired) as e:
            return {"ok": False, "error": f"The updater didn't answer: {e}"}

    def check_updates(self, manual: bool = False) -> None:
        def work() -> None:
            res = self.run_updater("check")
            self.call(lambda: self.updates_checked(res, manual))
        threading.Thread(target=work, daemon=True).start()

    def updates_checked(self, res: dict, manual: bool) -> None:
        if not res.get("ok"):
            if manual:
                messagebox.showerror("Updates", res.get("error", "Couldn't check for updates."))
            return
        self.update_info = res
        self.check_setup()
        if not manual:
            return
        lt, state = res["latest"], res["state"]
        when = lt["published"][:10]
        if state == "current":
            messagebox.showinfo("Updates", f"Retro Hub is up to date ({lt['name']}, {when}).")
        elif state == "newer":
            self.do_update()
        elif messagebox.askyesno("Updates", f"The newest release is {lt['name']} ({when}).\n\nThis folder wasn't set up by "
                                 "the updater, so it can't tell whether that's newer than what you have "
                                 f"(version {res.get('version') or '?'}). Install it? Your settings, games and emulators are "
                                 "kept, and replaced files are backed up."):
            self.do_update(confirmed=True)

    def do_update(self, confirmed: bool = False, force: bool = False) -> None:
        lt = (self.update_info or {}).get("latest") or {}
        if not confirmed and not messagebox.askyesno("Update Retro Hub", f"Install {lt.get('name', 'the newest release')}?\n\n"
                                                     "The hub stops while it updates. Kept as they are: .env, library "
                                                     "folders, hidden games, emulators/, roms/, cache/. Replaced files are "
                                                     "copied to backup/ first."):
            return
        running = self.server is not None or self.status.cget("text").startswith("Running")
        if running:
            self.log("Stopping the hub to update…\n", "info")
            self.stop_server(then=lambda: self.root.after(1500, lambda: self.do_update(True, force)))
            return
        self.log(f"Updating to {lt.get('name', 'the newest release')}: downloading and checking it…\n", "info")

        def work() -> None:
            res = self.run_updater("apply", *(["--force"] if force else []), timeout=900)
            self.call(lambda: self.update_done(res))
        threading.Thread(target=work, daemon=True).start()

    def update_done(self, res: dict) -> None:
        if not res.get("ok"):
            err = res.get("error", "The update failed.")
            if err.startswith("OLDER:"):
                if messagebox.askyesno("Update Retro Hub", err[6:] + "\n\nInstall it anyway (go back to that version)?"):
                    self.do_update(confirmed=True, force=True)
                return
            self.log(f"Update failed: {err}\n", "err")
            messagebox.showerror("Update Retro Hub", err)
            return
        msg = (f"Updated to {res['release']} (version {res.get('version') or '?'}): {res['changed']} file(s) replaced, "
               f"{res['added']} added." + (f" The old files are in {res['backup']}." if res.get("backup") else ""))
        self.log(msg + "\n", "ok")
        messagebox.showinfo("Update Retro Hub", msg + "\n\nThis window restarts now to finish.")
        try:
            pyw = Path(sys.executable).with_name("pythonw.exe") if WIN else Path(sys.executable)
            subprocess.Popen([str(pyw if pyw.is_file() else sys.executable), str(ROOT / "RetroHub.pyw")], cwd=ROOT)
        except OSError as e:
            messagebox.showwarning("Update Retro Hub", f"Start Retro Hub again yourself (launch.bat): {e}")
        self.root.destroy()

    def fix_env(self, key: str) -> None:
        """Clear a folder setting so the hub uses this install's own folder (./emulators, ./roms)."""
        try:
            write_env({key: ""})
        except OSError as e:
            messagebox.showerror("Settings", f"Could not save .env: {e}")
            return
        self.load_settings()
        self.log(f"{key} cleared: using this install's own folder.\n", "ok")
        self.check_setup()
        running = self.server is not None or self.status.cget("text").startswith("Running")
        if running and messagebox.askyesno("Settings saved", "Restart the hub now to apply it?"):
            self.restart_server()

    # ---------------------------------------------------------- Consoles window (library folder + emulator per console)
    def open_consoles(self) -> None:
        """Every console the hub knows: where its games are and, for native consoles, which emulator runs them.
        Folders go to library-folders.json (the same file as the hub's "Library folders" menu); emulator picks
        go to emulators/apps.json ("prefer")."""
        if getattr(self, "cons_win", None) and self.cons_win.winfo_exists():
            self.cons_win.lift()
            return
        try:
            browser = json.loads((ROOT / "core" / "browser-systems.json").read_text(encoding="utf-8"))["systems"]
            apps = self.apps_mod()
            systems, emulators, _ = apps.load_catalog()
            found = {eid: bool(apps.find_exe(eid, e)) for eid, e in emulators.items()}
            prefer = apps.load_user()["prefer"]
        except (SystemExit, Exception) as e:  # noqa: BLE001
            return messagebox.showerror("Consoles", f"Could not read the console list: {e}")
        try:
            folders = json.loads(LIB_FILE.read_text(encoding="utf-8"))
            folders = folders if isinstance(folders, dict) else {}
        except FileNotFoundError:
            folders = {}
        except (OSError, ValueError) as e:
            return messagebox.showerror("Consoles", f"Can't read {LIB_FILE.name}: {e}")

        rows = [(sid, s["label"], None) for sid, s in browser.items()]
        rows += [(sid, s["label"], s) for sid, s in systems.items() if sid != "pc" and sid not in browser]

        w = self.cons_win = tk.Toplevel(self.root)
        w.title("Consoles: game folders and emulators")
        w.geometry("1000x620")
        w.transient(self.root)
        ttk.Label(w, padding=(10, 8, 10, 2), text=(
            "Pick the folder each console's games are in, and which emulator runs them. Empty folder = found by "
            "name under the ROM folder. Saved to library-folders.json and emulators/apps.json; the hub uses them "
            "the next time it starts.")).pack(anchor="w")
        outer = ttk.Frame(w, padding=(10, 4))
        outer.pack(fill="both", expand=True)
        canvas = tk.Canvas(outer, highlightthickness=0)
        sb = ttk.Scrollbar(outer, command=canvas.yview)
        grid = ttk.Frame(canvas)
        grid.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        win_id = canvas.create_window((0, 0), window=grid, anchor="nw")
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(win_id, width=e.width))
        canvas.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        w.bind("<MouseWheel>", lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))

        for c, h in enumerate(("Console", "Games folder", "", "Emulator")):
            ttk.Label(grid, text=h, font=("Segoe UI", 9, "bold")).grid(row=0, column=c, sticky="w", padx=4, pady=(0, 4))
        grid.columnconfigure(1, weight=1)
        self.cons_dirs: dict[str, tk.StringVar] = {}
        self.cons_emus: dict[str, tuple[tk.StringVar, dict[str, str]]] = {}
        for r, (sid, label, nat) in enumerate(rows, start=1):
            ttk.Label(grid, text=label).grid(row=r, column=0, sticky="w", padx=4, pady=2)
            dv = self.cons_dirs[sid] = tk.StringVar(value=str(folders.get(sid) or ""))
            ttk.Entry(grid, textvariable=dv).grid(row=r, column=1, sticky="we", padx=4, pady=2)
            bf = ttk.Frame(grid)
            bf.grid(row=r, column=2, sticky="w")
            ttk.Button(bf, text="Browse", width=7, command=lambda v=dv: self.pick_dir(v)).pack(side="left")
            ttk.Button(bf, text="Clear", width=5, command=lambda v=dv: v.set("")).pack(side="left", padx=2)
            if nat is None:
                ttk.Label(grid, text="In the browser (EmulatorJS)", foreground="#666").grid(
                    row=r, column=3, sticky="w", padx=4)
                continue
            choices = {"Automatic (first one installed)": ""}
            for eid in nat["emulators"]:
                lab = emulators.get(eid, {}).get("label", eid)
                choices[f"{lab}  {'✔ installed' if found.get(eid) else '- not installed'}"] = eid
            cur = next((k for k, v in choices.items() if v and v == prefer.get(sid)), "Automatic (first one installed)")
            ev = tk.StringVar(value=cur)
            ttk.Combobox(grid, textvariable=ev, values=list(choices), state="readonly", width=34).grid(
                row=r, column=3, sticky="w", padx=4, pady=2)
            self.cons_emus[sid] = (ev, choices)

        b = ttk.Frame(w, padding=10)
        b.pack(fill="x")
        ttk.Button(b, text="Save", command=self.save_consoles).pack(side="left")
        ttk.Button(b, text="Close", command=w.destroy).pack(side="left", padx=6)
        ttk.Button(b, text="Open emulators folder", command=lambda: open_path(self.apps_mod().emu_dir())).pack(
            side="right")

    def save_consoles(self) -> None:
        w = self.cons_win
        folders: dict[str, str] = {}
        missing = []
        for sid, v in self.cons_dirs.items():
            d = v.get().strip()
            if not d:
                continue
            p = Path(d).expanduser()
            if not p.is_absolute():
                return messagebox.showerror("Consoles", f"Use a full folder path (like D:\\Games\\SNES): {d}", parent=w)
            if not p.is_dir():
                missing.append(d)
            folders[sid] = str(p)
        if missing and not messagebox.askyesno("Consoles", "These folders aren't there right now (a drive that isn't "
                                               "plugged in?):\n\n" + "\n".join(missing) + "\n\nSave them anyway?",
                                               parent=w):
            return
        try:
            tmp = LIB_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(folders, indent=2) + "\n", encoding="utf-8")
            tmp.replace(LIB_FILE)
        except OSError as e:
            return messagebox.showerror("Consoles", f"Could not save {LIB_FILE.name}: {e}", parent=w)
        apps = self.apps_mod()
        try:
            prefer = apps.load_user()["prefer"]
            for sid, (ev, choices) in self.cons_emus.items():
                eid = choices.get(ev.get(), "")
                if eid != prefer.get(sid, ""):
                    apps.set_preferred(sid, eid)
        except (SystemExit, Exception) as e:  # noqa: BLE001
            return messagebox.showerror("Consoles", f"Folders saved, but the emulator choice wasn't: {e}", parent=w)
        self.log(f"Consoles saved: {len(folders)} game folder(s), emulator choices updated.\n", "ok")
        self.check_setup()
        self.load_apps()
        running = self.server is not None or self.status.cget("text").startswith("Running")
        if running and messagebox.askyesno("Consoles", "Saved. Restart the hub now so it uses them?", parent=w):
            self.restart_server()
        elif not running:
            messagebox.showinfo("Consoles", "Saved. The hub uses them when you press Start.", parent=w)

    # ---------------------------------------------------------- requirements (Python, Node.js, controllers)
    def check_requirements(self, manual: bool = False) -> None:
        """Ask setup/deps.ps1 what's missing; offer to download, safety-check and install it."""
        if not WIN or not DEPS.is_file():
            if manual:
                messagebox.showinfo("Requirements", "Automatic setup is only available on Windows.")
            return

        def work() -> None:
            try:
                out = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(DEPS),
                                      "-Check", "-Python", PY], capture_output=True, text=True, timeout=90,
                                     creationflags=NO_WINDOW).stdout
                st = json.loads(out.strip().splitlines()[-1])
            except Exception as e:  # noqa: BLE001
                self.log(f"Requirements check failed: {e}\n", "err")
                return
            self.call(lambda: self.offer_requirements(st, manual))
        threading.Thread(target=work, daemon=True).start()

    def offer_requirements(self, st: dict, manual: bool) -> None:
        names = {"node": "Node.js (runs the hub server)",
                 "vigembus": "ViGEmBus driver (guest controllers for native emulators)",
                 "vgamepad": "vgamepad Python package (guest controllers)"}
        missing = [k for k in names if not st.get(k)]
        try:
            skipped = set(json.loads(SKIP_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            skipped = set()
        ask = missing if manual else [k for k in missing if k not in skipped]
        if not missing:
            self.log("Requirements: Python, Node.js and controller support are all installed.\n", "ok")
            if manual:
                messagebox.showinfo("Requirements", "Everything Retro Hub needs is installed.")
            return
        if not ask:
            self.log("Requirements: still missing " + ", ".join(missing) + " (Apps > Check requirements).\n", "info")
            return
        if not messagebox.askyesno("Retro Hub needs a few things", "Not installed:\n\n" + "\n".join(
                "• " + names[k] for k in ask) + "\n\nDownload them from their official sources, safety-check each "
                "one (checksum, publisher signature, Microsoft Defender scan) and install them?\n\nWindows may ask "
                "for permission for the driver and Node.js."):
            try:
                SKIP_FILE.parent.mkdir(parents=True, exist_ok=True)
                SKIP_FILE.write_text(json.dumps(sorted(skipped | set(ask))), encoding="utf-8")
            except OSError:
                pass
            self.log("Requirements skipped. Apps > Check requirements installs them later.\n", "info")
            return
        self.nb.select(0)
        self.log("Installing: " + ", ".join(ask) + "\n", "cmd")
        proc = subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(DEPS),
                                 "-Need", ",".join(ask), "-Python", PY, "-Yes"],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)

        def done(code: int) -> None:
            refresh_path()
            try:
                SKIP_FILE.unlink()
            except OSError:
                pass
            self.log("Requirements installed.\n" if code == 0 else
                     "Some requirements weren't installed (see above). Apps > Check requirements tries again.\n",
                     "ok" if code == 0 else "err")
            self.load_apps()
        self.stream(proc, self.log, done)

    def new_admin_pw(self) -> None:
        import secrets
        self.vars["ADMIN_PASSWORD"].set(secrets.token_urlsafe(12))
        self.log("New owner password generated; press Save to keep it.\n", "info")

    # ---------------------------------------------------------- Apps tab
    def build_apps(self, nb: ttk.Notebook) -> None:
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="  Apps  ")
        b = ttk.Frame(f)
        b.pack(fill="x", pady=(0, 6))
        ttk.Button(b, text="Add PC game", command=self.add_game).pack(side="left")
        ttk.Button(b, text="Add emulator", command=self.add_emulator).pack(side="left", padx=4)
        ttk.Button(b, text="Remove selected", command=self.remove_app).pack(side="left")
        ttk.Button(b, text="Refresh", command=self.load_apps).pack(side="left", padx=4)
        ttk.Button(b, text="Check requirements", command=lambda: self.check_requirements(manual=True)).pack(side="left")
        ttk.Button(b, text="Consoles…", command=self.open_consoles).pack(side="left", padx=4)
        ttk.Button(b, text="Open emulators folder", command=lambda: open_path(self.apps_mod().emu_dir())).pack(
            side="right")
        cols = ("state", "id", "info")
        t = self.apps_tree = ttk.Treeview(f, columns=cols, show="tree headings")
        t.heading("#0", text="Name")
        t.heading("state", text="Installed")
        t.heading("id", text="ID")
        t.heading("info", text="Details")
        t.column("#0", width=260)
        t.column("state", width=80, anchor="center")
        t.column("id", width=140)
        t.pack(fill="both", expand=True)
        ttk.Label(f, foreground="#666", text="Built-in emulators are found by putting a portable build in "
                  "emulators/<id>/. Only items you added can be removed here.").pack(anchor="w", pady=(6, 0))
        self.load_apps()

    def apps_mod(self):
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        # apps.py finds emulators through EMULATORS_DIR: use the folder from Settings, as the hub server does.
        emu = read_env().get("EMULATORS_DIR", "").strip()
        if emu:
            os.environ["EMULATORS_DIR"] = str(Path(emu).expanduser())
        else:
            os.environ.pop("EMULATORS_DIR", None)
        import apps  # noqa: PLC0415 - the project's own apps.py
        return apps

    def apps_call(self, fn, *a) -> bool:
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                fn(*a)
        except SystemExit as e:
            messagebox.showerror("Apps", str(e))
            return False
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("Apps", f"{type(e).__name__}: {e}")
            return False
        msg = buf.getvalue().strip()
        if msg:
            self.log(msg + "\n", "ok")
            messagebox.showinfo("Apps", msg)
        return True

    def load_apps(self) -> None:
        t = self.apps_tree
        t.delete(*t.get_children())
        try:
            st = self.apps_mod().status()
        except (SystemExit, Exception) as e:  # noqa: BLE001
            t.insert("", "end", text=f"Could not read apps: {e}")
            return
        em = t.insert("", "end", text="Emulators", open=True)
        for eid, e in st["emulators"].items():
            t.insert(em, "end", text=e["label"], values=("✔" if e["installed"] else "-", eid,
                                                         "added by you" if e["custom"] else "built-in"),
                     tags=("custom",) if e["custom"] else ())
        cs = t.insert("", "end", text="Consoles", open=True)
        for sid, s in st["systems"].items():
            if sid != "pc":
                t.insert(cs, "end", text=s["label"], values=("✔" if s["installed"] else "-", sid,
                                                             f"uses {s['emulatorLabel'] or '-'}"))
        gs = t.insert("", "end", text="PC games", open=True)
        for g in st["games"]:
            t.insert(gs, "end", text=g["name"], values=("✔" if g["installed"] else "missing", g["id"], ""),
                     tags=("custom",))
        if not st["games"]:
            t.insert(gs, "end", text="(none yet)")

    def add_game(self) -> None:
        name = simpledialog.askstring("Add PC game", "Game name:", parent=self.root)
        if not name:
            return
        exe = filedialog.askopenfilename(title="Pick the game's program",
                                         filetypes=[("Programs", "*.exe")] if WIN else [])
        if not exe:
            return
        extra = simpledialog.askstring("Add PC game", "Extra launch options (optional):", parent=self.root) or ""
        if self.apps_call(self.apps_mod().add_game, name, exe, shlex.split(extra, posix=not WIN)):
            self.load_apps()

    def add_emulator(self) -> None:
        apps = self.apps_mod()
        try:
            systems, _, _ = apps.load_catalog()
        except SystemExit as e:
            return messagebox.showerror("Apps", str(e))
        label = simpledialog.askstring("Add emulator", "Emulator name (e.g. Ryujinx):", parent=self.root)
        if not label:
            return
        exe = filedialog.askopenfilename(title="Pick the emulator's program",
                                         filetypes=[("Programs", "*.exe")] if WIN else [])
        if not exe:
            return
        ids = ", ".join(k for k in systems if k != "pc")
        syscsv = simpledialog.askstring("Add emulator", f"Which consoles? Comma separated.\n\n{ids}",
                                        parent=self.root)
        if not syscsv:
            return
        args = simpledialog.askstring("Add emulator", 'Launch options ({game} = game file). Empty = "{game}"',
                                      parent=self.root) or ""
        if self.apps_call(apps.add_emulator, label, exe, syscsv, label, args, None):
            self.load_apps()

    def remove_app(self) -> None:
        sel = self.apps_tree.selection()
        if not sel or "custom" not in self.apps_tree.item(sel[0], "tags"):
            return messagebox.showinfo("Apps", "Select a PC game or an emulator you added.")
        item = self.apps_tree.item(sel[0])
        if messagebox.askyesno("Remove", f"Remove {item['text']}? (Its files are not deleted.)"):
            if self.apps_call(self.apps_mod().remove, item["values"][1]):
                self.load_apps()

    # ---------------------------------------------------------- Files tab
    def build_files(self, nb: ttk.Notebook) -> None:
        f = ttk.Frame(nb, padding=6)
        nb.add(f, text="  Files  ")
        pw = ttk.PanedWindow(f, orient="horizontal")
        pw.pack(fill="both", expand=True)
        left = ttk.Frame(pw)
        pw.add(left, weight=1)
        lb = ttk.Frame(left)
        lb.pack(fill="x")
        ttk.Button(lb, text="Refresh", command=self.load_tree).pack(side="left")
        ttk.Button(lb, text="New file", command=self.new_file).pack(side="left", padx=3)
        ttk.Button(lb, text="Open externally", command=self.open_external).pack(side="left")
        self.ftree = ttk.Treeview(left, show="tree")
        self.ftree.pack(fill="both", expand=True, pady=(4, 0))
        self.ftree.bind("<<TreeviewOpen>>", self.expand_node)
        self.ftree.bind("<<TreeviewSelect>>", self.select_file)

        right = ttk.Frame(pw)
        pw.add(right, weight=3)
        rb = ttk.Frame(right)
        rb.pack(fill="x")
        self.file_label = ttk.Label(rb, text="Pick a file on the left")
        self.file_label.pack(side="left")
        ttk.Button(rb, text="Save  (Ctrl+S)", command=self.save_file).pack(side="right")
        ttk.Button(rb, text="Revert", command=lambda: self.cur_file and self.load_file(self.cur_file, force=True)).pack(
            side="right", padx=3)
        ef = ttk.Frame(right)
        ef.pack(fill="both", expand=True, pady=(4, 0))
        self.editor = tk.Text(ef, wrap="none", undo=True, font=("Consolas", 10), relief="flat", padx=6, pady=4)
        ys = ttk.Scrollbar(ef, command=self.editor.yview)
        xs = ttk.Scrollbar(ef, orient="horizontal", command=self.editor.xview)
        self.editor.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        ys.pack(side="right", fill="y")
        xs.pack(side="bottom", fill="x")
        self.editor.pack(fill="both", expand=True)
        self.editor.bind("<Control-s>", lambda e: (self.save_file(), "break")[1])
        self.editor.bind("<<Modified>>", self.on_modified)
        self.load_tree()

    def node_path(self, node: str) -> Path:
        return Path(self.ftree.item(node, "values")[0])

    def add_children(self, parent: str, folder: Path) -> None:
        try:
            entries = sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        for p in entries:
            if p.name in SKIP_DIRS and p.is_dir():
                continue
            node = self.ftree.insert(parent, "end", text=("📁 " if p.is_dir() else "") + p.name, values=(str(p),))
            if p.is_dir():
                self.ftree.insert(node, "end", text="...", values=("",))

    def load_tree(self) -> None:
        self.ftree.delete(*self.ftree.get_children())
        self.add_children("", ROOT)

    def expand_node(self, _e=None) -> None:
        node = self.ftree.focus()
        kids = self.ftree.get_children(node)
        if len(kids) == 1 and not self.ftree.item(kids[0], "values")[0]:
            self.ftree.delete(kids[0])
            self.add_children(node, self.node_path(node))

    def select_file(self, _e=None) -> None:
        sel = self.ftree.selection()
        if sel:
            p = self.node_path(sel[0])
            if p.is_file():
                self.load_file(p)

    def dirty(self) -> bool:
        return self.cur_file is not None and bool(self.editor.edit_modified())

    def on_modified(self, _e=None) -> None:
        if self.cur_file:
            mark = " ●" if self.editor.edit_modified() else ""
            self.file_label.configure(text=f"{self.cur_file.relative_to(ROOT) if ROOT in self.cur_file.parents else self.cur_file}{mark}")

    def load_file(self, p: Path, force: bool = False) -> None:
        if not force and p != self.cur_file and self.dirty():
            ans = messagebox.askyesnocancel("Unsaved changes", f"Save changes to {self.cur_file.name}?")
            if ans is None:
                return
            if ans and not self.save_file():
                return
        try:
            if p.stat().st_size > MAX_EDIT:
                raise ValueError("too big")
            text = p.read_bytes().decode("utf-8")
            if "\x00" in text:
                raise ValueError("binary")
        except (OSError, ValueError, UnicodeDecodeError):
            if messagebox.askyesno("Can't edit here", f"{p.name} isn't a text file (or is very large). "
                                   "Open it with its own program?"):
                open_path(p)
            return
        self.cur_file = p
        self.editor.configure(state="normal")
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", text)
        self.editor.edit_reset()
        self.editor.edit_modified(False)
        self.on_modified()

    def save_file(self) -> bool:
        if not self.cur_file:
            return False
        text = self.editor.get("1.0", "end-1c")
        if self.cur_file.suffix == ".json":
            try:
                json.loads(text)
            except ValueError as e:
                if not messagebox.askyesno("JSON error", f"This isn't valid JSON ({e}). Save anyway?"):
                    return False
        try:
            self.cur_file.write_text(text, encoding="utf-8", newline="")
        except OSError as e:
            messagebox.showerror("Save", f"Could not save: {e}")
            return False
        self.editor.edit_modified(False)
        self.on_modified()
        self.log(f"Saved {self.cur_file.name}." + (" Restart the hub to use it.\n" if self.server else "\n"), "ok")
        if self.cur_file == ENV_FILE:
            self.load_settings()
        return True

    def new_file(self) -> None:
        sel = self.ftree.selection()
        base = self.node_path(sel[0]) if sel else ROOT
        base = base if base.is_dir() else base.parent
        name = simpledialog.askstring("New file", f"File name (in {base.name or base}):", parent=self.root)
        if not name:
            return
        p = (base / name).resolve()
        if ROOT not in p.parents:
            return messagebox.showerror("New file", "Keep new files inside the Retro Hub folder.")
        if p.exists():
            return messagebox.showerror("New file", "That file already exists.")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("", encoding="utf-8")
        self.load_tree()
        self.load_file(p)

    def open_external(self) -> None:
        sel = self.ftree.selection()
        open_path(self.node_path(sel[0]) if sel else ROOT)

    def open_in_editor(self, p: Path) -> None:
        if not p.exists():
            p.write_text("", encoding="utf-8")
        self.nb.select(3)
        self.load_file(p)

    # ---------------------------------------------------------- Console tab
    def build_console(self, nb: ttk.Notebook) -> None:
        f = ttk.Frame(nb, padding=8)
        nb.add(f, text="  Console  ")
        bar = ttk.Frame(f)
        bar.pack(fill="x", pady=(0, 4))
        ttk.Label(bar, text=f"Admin terminal in {ROOT}   (type 'help')").pack(side="left")
        ttk.Button(bar, text="Clear", command=lambda: self.clear(self.con_box)).pack(side="right")
        self.btn_kill = ttk.Button(bar, text="Stop command", command=self.kill_cmd, state="disabled")
        self.btn_kill.pack(side="right", padx=3)
        self.con_box = self.mono_text(f, state="disabled")
        row = ttk.Frame(f)
        row.pack(fill="x", pady=(6, 0))
        ttk.Label(row, text=">").pack(side="left")
        self.entry = ttk.Entry(row, font=("Consolas", 10))
        self.entry.pack(side="left", fill="x", expand=True, padx=4)
        self.entry.bind("<Return>", self.run_entry)
        self.entry.bind("<Up>", lambda e: self.hist(-1))
        self.entry.bind("<Down>", lambda e: self.hist(1))
        ttk.Button(row, text="Run", command=self.run_entry).pack(side="left")
        self.clog(self.HELP, "info")

    HELP = (
        "Commands:\n"
        "  start | stop | restart     the hub server\n"
        "  status                     is it running, and where\n"
        "  apps list                  emulators, consoles and PC games (apps add-game / remove ID work too)\n"
        "  env                        show .env (passwords hidden)\n"
        "  edit FILE                  open a file in the Files tab\n"
        "  npm ci                     reinstall the server dependency\n"
        "  clear | help\n"
        "  anything else runs in the system shell from the Retro Hub folder.\n\n"
    )

    def hist(self, d: int) -> str:
        if self.history:
            self.hist_i = max(0, min(len(self.history), self.hist_i + d))
            self.entry.delete(0, "end")
            if self.hist_i < len(self.history):
                self.entry.insert(0, self.history[self.hist_i])
        return "break"

    def run_entry(self, _e=None) -> None:
        line = self.entry.get().strip()
        self.entry.delete(0, "end")
        if not line:
            return
        self.history.append(line)
        self.hist_i = len(self.history)
        self.clog(f"> {line}\n", "cmd")
        word, _, rest = line.partition(" ")
        word = word.lower()
        if word == "help":
            self.clog(self.HELP, "info")
        elif word in ("clear", "cls"):
            self.clear(self.con_box)
        elif word == "start":
            self.start_server()
            self.clog("Starting; see the Server tab.\n")
        elif word == "stop":
            self.stop_server()
        elif word == "restart":
            self.restart_server()
        elif word == "status":
            self.clog(f"{self.status.cget('text')}  {self.url or ''}\n")
        elif word == "env":
            for k, v in read_env().items():
                hide = any(s in k for s in ("PASSWORD", "TOKEN", "SECRET", "CREDENTIAL"))
                self.clog(f"  {k}={'•' * 8 if hide and v else v}\n")
        elif word == "edit":
            p = (ROOT / rest.strip().strip('"')).resolve()
            if p.is_file():
                self.open_in_editor(p)
            else:
                self.clog(f"No such file: {p}\n", "err")
        elif word == "apps":
            args = shlex.split(rest, posix=not WIN) or ["list"]
            self.shell([PY, "-u", str(ROOT / "apps.py"), *args], after=self.load_apps)
        else:
            self.shell(line)

    def shell(self, cmd, after=None) -> None:
        if self.cmd_proc is not None and self.cmd_proc.poll() is None:
            self.clog("A command is still running (Stop command to end it).\n", "err")
            return
        try:
            self.cmd_proc = subprocess.Popen(cmd, shell=isinstance(cmd, str), cwd=ROOT, env=child_env(),
                                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                             stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                             errors="replace", creationflags=NO_WINDOW)
        except OSError as e:
            self.clog(f"{e}\n", "err")
            return
        self.btn_kill.configure(state="normal")

        def done(code: int) -> None:
            self.btn_kill.configure(state="disabled")
            self.clog(f"[exit {code}]\n", "ok" if code == 0 else "err")
            if after:
                after()
        self.stream(self.cmd_proc, self.clog, done)

    def kill_cmd(self) -> None:
        if self.cmd_proc is not None and self.cmd_proc.poll() is None:
            kill_tree(self.cmd_proc.pid)

    # ---------------------------------------------------------- closing
    def on_close(self) -> None:
        if self.dirty():
            ans = messagebox.askyesnocancel("Unsaved changes", f"Save changes to {self.cur_file.name}?")
            if ans is None or (ans and not self.save_file()):
                return
        if self.server is not None and self.server.poll() is None:
            # The hub's output goes through this window, so it can't outlive it.
            if not messagebox.askokcancel("Retro Hub is running",
                                          "Closing this window stops the hub (players are told it's closing)."):
                return
            self.stop_server(then=self.root.destroy)
            return
        self.kill_cmd()
        self.root.destroy()


def main() -> None:
    if WIN:
        with contextlib.suppress(Exception):
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # crisp text on high-DPI screens
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("RetroHub.ControlPanel")
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
