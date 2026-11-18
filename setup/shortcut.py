#!/usr/bin/env python3
"""Desktop shortcut for Retro Hub, with the Retro Hub icon (assets/icon/).

  python setup/shortcut.py prompt     ask "Would you like to create a RetroHub desktop shortcut? (Y/n)" once
  python setup/shortcut.py create     create it now (no question)
  python setup/shortcut.py status     JSON: asked already? where is it?

Windows   RetroHub.lnk on the Desktop (the real one, also when OneDrive moves it), opening launch.bat in this folder,
          icon assets/icon/retrohub.ico. Made with PowerShell's WScript.Shell.
Linux     RetroHub.desktop on the Desktop and in ~/.local/share/applications (the app menu), icon retrohub.png.
macOS     RetroHub.app on the Desktop (a small app bundle that starts Retro Hub from this folder), icon retrohub.icns.

The answer is saved in .retrohub-config.json ("promptedDesktopShortcut": true), so it is asked only once; the
Retro Hub window's Settings tab, `launch.py --create-shortcut` and `launch.bat --create-shortcut` make one any time.
Standard library only.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / ".retrohub-config.json"
ICONS = ROOT / "assets" / "icon"
NAME = "RetroHub"
WIN, MAC = sys.platform == "win32", sys.platform == "darwin"
NO_WINDOW = 0x08000000 if WIN else 0
QUESTION = "Would you like to create a RetroHub desktop shortcut? (Y/n) "


# ------------------------------------------------------------------ state (.retrohub-config.json)
def load_config() -> dict:
    try:
        c = json.loads(CONFIG.read_text(encoding="utf-8"))
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def save_config(**changes) -> None:
    c = {**load_config(), **changes}
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(c, indent=2) + "\n", encoding="utf-8")
    tmp.replace(CONFIG)


def should_prompt() -> bool:
    return not load_config().get("promptedDesktopShortcut")


# ------------------------------------------------------------------ where the Desktop is
def desktop_dir() -> Path:
    if os.environ.get("RETROHUB_DESKTOP"):     # put the shortcut somewhere else (portable setups, tests)
        return Path(os.environ["RETROHUB_DESKTOP"]).expanduser()
    if WIN:
        # The shell's own answer: follows OneDrive "Desktop backup" and any moved / localised Desktop folder.
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"],
                               capture_output=True, text=True, encoding="utf-8", timeout=20, creationflags=NO_WINDOW)
            p = r.stdout.strip()
            if p and Path(p).is_dir():
                return Path(p)
        except (OSError, subprocess.SubprocessError):
            pass
        for cand in (Path(os.environ.get("OneDrive", "")) / "Desktop", Path.home() / "Desktop"):
            if str(cand) not in ("Desktop", "") and cand.is_dir():
                return cand
        return Path.home() / "Desktop"
    if not MAC:
        try:     # xdg-user-dirs: the Desktop under its localised name ("Schreibtisch", "Bureau" ...)
            p = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, timeout=5).stdout.strip()
            if p and Path(p).is_dir() and Path(p) != Path.home():
                return Path(p)
        except (OSError, subprocess.SubprocessError):
            pass
    return Path.home() / "Desktop"


# ------------------------------------------------------------------ create
def _has_tk(py: str) -> bool:
    try:
        return subprocess.run([py, "-c", "import tkinter"], capture_output=True, timeout=15).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def create_windows(desk: Path) -> tuple[Path, Path]:
    lnk, ico, target = desk / f"{NAME}.lnk", ICONS / "retrohub.ico", ROOT / "launch.bat"
    # Paths go to PowerShell as environment variables, never pasted into the command (spaces, quotes, $ are safe).
    ps = ("$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:RH_LNK); "
          "$s.TargetPath = $env:RH_TARGET; $s.WorkingDirectory = $env:RH_ROOT; "
          "$s.IconLocation = $env:RH_ICON + ',0'; $s.Description = 'Retro Hub: play retro games with friends'; "
          "$s.WindowStyle = 7; $s.Save()")
    env = {**os.environ, "RH_LNK": str(lnk), "RH_TARGET": str(target), "RH_ROOT": str(ROOT), "RH_ICON": str(ico)}
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True,
                       env=env, timeout=30, creationflags=NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "PowerShell failed")
    return lnk, ico


def create_linux(desk: Path) -> tuple[Path, Path]:
    icon = ICONS / "retrohub.png"
    py = shutil.which("python3") or sys.executable
    if _has_tk(py):    # the Retro Hub window; else the console launcher in a terminal
        exec_line, terminal = f'"{py}" "{ROOT / "RetroHub.pyw"}"', "false"
    else:
        exec_line, terminal = f'"{ROOT / "launch.sh"}"', "true"
    text = ("[Desktop Entry]\nType=Application\nVersion=1.0\nName=RetroHub\n"
            "Comment=Play retro games with friends (Retro Hub)\n"
            f"Exec={exec_line}\nPath={ROOT}\nIcon={icon}\nTerminal={terminal}\nCategories=Game;Emulator;\n"
            "StartupWMClass=RetroHub\n")
    desk.mkdir(parents=True, exist_ok=True)
    out = desk / f"{NAME}.desktop"
    for f in (out, Path.home() / ".local" / "share" / "applications" / f"{NAME}.desktop"):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
        f.chmod(0o755)
    try:     # GNOME: mark the desktop file trusted so it opens on double-click instead of asking
        subprocess.run(["gio", "set", str(out), "metadata::trusted", "true"], capture_output=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass
    return out, icon


def create_mac(desk: Path) -> tuple[Path, Path]:
    app = desk / f"{NAME}.app"
    contents = app / "Contents"
    (contents / "MacOS").mkdir(parents=True, exist_ok=True)
    (contents / "Resources").mkdir(parents=True, exist_ok=True)
    icon = contents / "Resources" / "retrohub.icns"
    shutil.copyfile(ICONS / "retrohub.icns", icon)
    (contents / "Info.plist").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>RetroHub</string>
  <key>CFBundleDisplayName</key><string>RetroHub</string>
  <key>CFBundleIdentifier</key><string>local.retrohub.launcher</string>
  <key>CFBundleExecutable</key><string>RetroHub</string>
  <key>CFBundleIconFile</key><string>retrohub</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
</dict></plist>
""", encoding="utf-8")
    q = str(ROOT).replace("'", "'\\''")
    # Starts the Retro Hub window from this folder; without tkinter, the console launcher in Terminal.
    (contents / "MacOS" / "RetroHub").write_text(f"""#!/bin/sh
cd '{q}' || exit 1
PY=$(command -v python3 || echo /usr/bin/python3)
if "$PY" -c "import tkinter" 2>/dev/null; then exec "$PY" RetroHub.pyw; fi
exec open -a Terminal '{q}/launch.sh'
""", encoding="utf-8")
    (contents / "MacOS" / "RetroHub").chmod(0o755)
    os.utime(app, None)     # Finder re-reads the icon
    return app, icon


def create() -> dict:
    desk = desktop_dir()
    try:
        made, icon = (create_windows if WIN else create_mac if MAC else create_linux)(desk)
    except (OSError, RuntimeError, subprocess.SubprocessError) as e:
        return {"ok": False, "error": f"Couldn't create the shortcut on {desk}: {e}"}
    # Verify: the shortcut and its icon are really there.
    if not made.exists():
        return {"ok": False, "error": f"The shortcut wasn't created ({made} doesn't exist)."}
    if not icon.is_file():
        return {"ok": False, "error": f"The shortcut was created at {made}, but its icon {icon} is missing."}
    save_config(promptedDesktopShortcut=True, desktopShortcut=str(made))
    return {"ok": True, "path": str(made), "icon": str(icon)}


def decline() -> None:
    save_config(promptedDesktopShortcut=True, desktopShortcut=None)


def prompt(force: bool = False) -> None:
    """Console question (first run, or --setup / --create-shortcut with force=True)."""
    if not force and not should_prompt():
        return
    if not sys.stdin or not sys.stdin.isatty():
        return                                  # no one to ask (Docker, a service): ask next time
    try:
        ans = input(QUESTION).strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return
    if ans in ("", "y", "yes"):
        report(create())
    else:
        decline()
        print("[retro-hub] No shortcut. Make one any time: python setup/shortcut.py create")


def report(r: dict) -> None:
    if r["ok"]:
        print(f"[retro-hub] Desktop shortcut created: {r['path']}\n[retro-hub] Icon: {r['icon']}")
    else:
        print(f"[retro-hub] {r['error']}", file=sys.stderr)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "prompt"
    if cmd == "create":
        r = create()
        report(r)
        sys.exit(0 if r["ok"] else 1)
    elif cmd == "status":
        print(json.dumps({**load_config(), "desktop": str(desktop_dir())}))
    elif cmd == "prompt":
        prompt(force="--force" in sys.argv)
    else:
        sys.exit("Use: shortcut.py prompt | create | status")


if __name__ == "__main__":
    main()
