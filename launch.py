#!/usr/bin/env python3
"""Retro Hub local launcher.

Runs the hub on this computer and opens it in your browser:
  1. checks that Node.js 18+ is installed,
  2. installs the server dependency on first run,
  3. loads settings from .env (creating one with random passwords the first time),
  4. starts the server and opens http://localhost:<port>.

With --tunnel it also starts a Cloudflare Tunnel (cloudflared must be installed) so friends anywhere can
join over HTTPS: a free random *.trycloudflare.com address by default, or your own hostname when
TUNNEL_TOKEN and PUBLIC_URL are set in .env.

Press Ctrl+C to stop. Uses only the Python standard library (Python 3.8+).
"""
from __future__ import annotations

import argparse
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
MIN_NODE = 18


def fail(msg: str) -> "None":
    print(f"\n[retro-hub] {msg}\n", file=sys.stderr)
    sys.exit(1)


def find_node() -> str:
    node = shutil.which("node")
    if not node:
        fail("Node.js was not found. Install Node.js 18 or newer from https://nodejs.org "
             "(LTS), then run this launcher again. Or use Docker instead (see README.md).")
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15).stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
        fail(f"Could not run Node.js: {e}")
    m = re.match(r"v(\d+)", out)
    if not m or int(m.group(1)) < MIN_NODE:
        fail(f"Node.js {out or '(unknown version)'} is too old. Retro Hub needs Node.js {MIN_NODE} or newer.")
    print(f"[retro-hub] Node.js {out}")
    return node


def install_deps() -> None:
    if (ROOT / "node_modules" / "ws" / "package.json").is_file():
        return
    npm = shutil.which("npm")
    if not npm:
        fail("npm was not found. It normally comes with Node.js; reinstall Node.js from https://nodejs.org.")
    print("[retro-hub] First run: installing the server dependency (npm ci)...")
    if subprocess.run([npm, "ci", "--omit=dev", "--ignore-scripts"], cwd=ROOT).returncode != 0:
        fail("npm ci failed. Check your internet connection and try again.")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
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
        if val:
            values[key.strip()] = val
    return values


def first_run_env() -> None:
    if ENV_FILE.exists():
        return
    admin = secrets.token_urlsafe(12)
    ENV_FILE.write_text(
        "# Created by launch.py. Edit freely; see .env.example for every option.\n"
        "# Players make local accounts in the browser; each host sets their own lobby password.\n"
        f"ADMIN_PASSWORD={admin}\n"
        "PORT=8080\n"
        "MAX_PLAYERS=4\n",
        encoding="utf-8",
    )
    print(f"[retro-hub] Created {ENV_FILE.name} with a new owner password (change it there any time).")


CLOUDFLARED_HELP = (
    "cloudflared (Cloudflare Tunnel) was not found. Install it from Cloudflare, then run this again:\n"
    "    Windows:  winget install --id Cloudflare.cloudflared\n"
    "    macOS:    brew install cloudflared\n"
    "    Linux:    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n"
    "  (Open a new terminal after installing so it is on PATH.)"
)
QUICK_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def find_cloudflared() -> str:
    exe = shutil.which("cloudflared")
    if not exe and os.name == "nt":
        # winget installs here but a terminal opened before the install has the old PATH
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles")):
            cand = Path(base or "") / "cloudflared" / "cloudflared.exe"
            if base and cand.is_file():
                exe = str(cand)
                break
    if not exe:
        fail(CLOUDFLARED_HELP)
    return exe


def start_tunnel(exe: str, port: int, env: dict[str, str]) -> tuple[subprocess.Popen, str]:
    """Start cloudflared. Returns the process and the public https address."""
    token = env.get("TUNNEL_TOKEN", "")
    if token:
        public = env.get("PUBLIC_URL", "").rstrip("/")
        if not public.startswith("https://"):
            fail("TUNNEL_TOKEN is set, so this is a named tunnel: also set PUBLIC_URL in .env to its address "
                 "(for example https://play.example.com).")
        # The token goes through the environment (TUNNEL_TOKEN), never the command line, so other
        # programs listing processes can't read it.
        cmd = [exe, "tunnel", "--no-autoupdate", "run"]
        tun_env = {**os.environ, "TUNNEL_TOKEN": token}
    else:
        public = ""
        cmd = [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"]
        tun_env = {k: v for k, v in os.environ.items() if k != "TUNNEL_TOKEN"}
    print("[retro-hub] Starting Cloudflare Tunnel...")
    proc = subprocess.Popen(cmd, cwd=ROOT, env=tun_env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, errors="replace")
    found = threading.Event()
    seen: list[str] = []
    box = {"url": public, "up": False}

    def pump() -> None:  # keep reading so cloudflared never blocks on a full pipe
        assert proc.stderr is not None
        for line in proc.stderr:
            seen.append(line.rstrip())
            del seen[:-15]
            if not box["url"]:
                m = QUICK_URL_RE.search(line)
                if m:
                    box["url"] = m.group(0)
            if "Registered tunnel connection" in line:
                box["up"] = True
            if box["url"] and box["up"]:
                found.set()

    threading.Thread(target=pump, daemon=True).start()
    end = time.time() + 45
    while time.time() < end and not found.is_set():
        if proc.poll() is not None:
            break
        found.wait(0.25)
    if not found.is_set():
        if proc.poll() is None:
            proc.terminate()
        tail = "\n    ".join(seen[-8:]) or "(no output)"
        fail(f"Cloudflare Tunnel did not come up. Last messages from cloudflared:\n    {tail}")
    return proc, box["url"]


def lan_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # UDP connect sends no packets; it only picks the outgoing interface
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        s.close()


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def wait_for_port(port: int, proc: subprocess.Popen, timeout: float = 20.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if proc.poll() is not None:
            return False
        if not port_free(port):
            return True
        time.sleep(0.25)
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description="Run Retro Hub locally and open it in the browser.")
    ap.add_argument("--port", type=int, help="HTTP port (default: PORT from .env, else 8080)")
    ap.add_argument("--roms", help="ROM library folder (default: ./roms)")
    ap.add_argument("--access-password", help="optional server-wide access code (overrides .env)")
    ap.add_argument("--admin-password", help="owner password for 'Unlock library' (overrides .env)")
    ap.add_argument("--localhost-only", action="store_true", help="only accept connections from this computer")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    ap.add_argument("--setup", action="store_true", help="ask the first-run questions again (desktop shortcut)")
    ap.add_argument("--create-shortcut", action="store_true", help="create the RetroHub desktop shortcut, then start")
    ap.add_argument("--tunnel", action="store_true",
                    help="share the hub over the internet with a Cloudflare Tunnel (needs cloudflared installed)")
    ap.add_argument("--lan", action="store_true",
                    help="with --tunnel: also keep accepting Wi-Fi/LAN connections (default: tunnel only)")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

    if sys.version_info < (3, 8):
        fail("Python 3.8 or newer is required.")
    node = find_node()
    install_deps()
    # First run (or --setup / --create-shortcut): offer a desktop shortcut with the Retro Hub icon. Asked once;
    # the answer is kept in .retrohub-config.json. Only when someone is at the terminal to answer.
    sys.path.insert(0, str(ROOT / "setup"))
    import shortcut  # noqa: E402 - setup/shortcut.py
    if args.create_shortcut:
        shortcut.report(shortcut.create())
    else:
        shortcut.prompt(force=args.setup)
    first_run_env()

    env = os.environ.copy()
    for k, v in read_env(ENV_FILE).items():
        env.setdefault(k, v)
    if args.port:
        env["PORT"] = str(args.port)
    if args.roms:
        roms = Path(args.roms).expanduser().resolve()
        if not roms.is_dir():
            fail(f"ROM folder not found: {roms}")
        env["ROMS_DIR"] = str(roms)
    if args.access_password:
        env["ACCESS_PASSWORD"] = args.access_password
    if args.admin_password:
        env["ADMIN_PASSWORD"] = args.admin_password
    if args.localhost_only:
        env["HOST"] = "127.0.0.1"
    # Native emulators: the guest-controller bridge (core/streaming/input_bridge.py) runs on this Python.
    env.setdefault("RH_PYTHON", sys.executable)

    try:
        port = int(env.get("PORT", "8080"))
    except ValueError:
        fail(f"PORT must be a number, got {env.get('PORT')!r}")
    env["PORT"] = str(port)
    if not port_free(port):
        fail(f"Port {port} is already in use. Close the other program or run: python launch.py --port {port + 1}")

    tunnel: subprocess.Popen | None = None
    public = ""
    if args.tunnel:
        cloudflared = find_cloudflared()
        # Tunnel only by default: the hub listens on this computer alone and cloudflared is its one door,
        # so forwarded client IPs can't be faked from the LAN.
        if not args.lan:
            env["HOST"] = "127.0.0.1"
        tunnel, public = start_tunnel(cloudflared, port, env)
        env["PUBLIC_URL"] = public

    proc = subprocess.Popen([node, "server.mjs"], cwd=ROOT, env=env)

    def stop(*_: object) -> None:
        for p in (proc, tunnel):
            if p is not None and p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop)

    if not wait_for_port(port, proc):
        if tunnel is not None and tunnel.poll() is None:
            tunnel.terminate()
        code = proc.poll()
        if code is not None:
            fail(f"The server exited early (code {code}). See the messages above.")
        fail(f"The server did not start listening on port {port} within 20 seconds.")

    # The host always opens the hub on localhost, tunnel or not: native emulators and Library folders only work from
    # this computer's own address, and invite links still use the public address (the server gets PUBLIC_URL).
    url = f"http://localhost:{port}"
    print("\n" + "=" * 60)
    print(f"  Retro Hub is running:   {url}")
    if public:
        print(f"  Public address:         {public}")
        print("  Send friends invite links from the hub (Copy invite link); they use the public address and work from anywhere.")
        if not env.get("TUNNEL_TOKEN"):
            print("  This free address changes every time you start with --tunnel.")
        if not env.get("ACCESS_PASSWORD"):
            print("  Tip: anyone with the address can make an account. Set ACCESS_PASSWORD in .env to require a code.")
    ip = None if (args.localhost_only or (args.tunnel and not args.lan)) else lan_ip()
    if ip:
        print(f"  Friends on your Wi-Fi:  http://{ip}:{port}")
    print("  Friends: open the link, make an account, join your lobby with its password.")
    if env.get("ACCESS_PASSWORD"):
        print(f"  Server access code:     {env['ACCESS_PASSWORD']}")
    if env.get("ADMIN_PASSWORD"):
        print(f"  Owner unlock password:  {env['ADMIN_PASSWORD']}")
    print("  Press Ctrl+C to stop.")
    print("=" * 60 + "\n")
    if not args.no_browser:
        webbrowser.open(url)

    try:
        code = proc.wait()
    except KeyboardInterrupt:
        stop()
        return
    if tunnel is not None and tunnel.poll() is None:  # server stopped (stop.py / owner button): close the tunnel too
        tunnel.terminate()
        try:
            tunnel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tunnel.kill()
    sys.exit(code)


if __name__ == "__main__":
    main()
