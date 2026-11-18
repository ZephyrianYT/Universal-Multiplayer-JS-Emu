#!/usr/bin/env python3
"""Retro Hub updater: installs the newest GitHub release into this folder, keeping everything that is yours.

  python setup/update.py check     JSON: this install, the newest release, and whether it is newer
  python setup/update.py apply     download, safety-check and install the newest release (stop the hub first)
  python setup/update.py apply --force    the same, even when that release is an older version than this one

The Retro Hub window runs this (Server tab: "Check for updates"). Standard library only.

Where updates come from: the GitHub releases of UPDATE_REPO (.env), by default ZephyrianYT/Universal-Multiplayer-JS-Emu.
The newest release's .zip is used.

Safety (every download, nothing is skipped):
  1. only from github.com / GitHub's download servers, over HTTPS
  2. SHA-256 must match the checksum GitHub publishes for the file (a release file without one is refused)
  3. Windows: a Microsoft Defender scan must come back clean
  4. the zip is checked before anything is copied: no paths outside its folder, and it must be a Retro Hub
     (server.mjs, package.json, apps.py)
A failed check deletes the download and changes nothing.

Kept as they are (never overwritten): .env, library-folders.json, library-hidden.json, offsite-games.json, emulators/ (your emulator
builds and apps.json; only its README / KEYBOARD / INSTRUMENTS docs are updated), roms/, cache/, run/, node_modules/, backup/.
Every file the update replaces is copied to backup/<date-time>/ first, so an update can be undone by hand.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import socket
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
MARKER = ROOT / "cache" / "installed-release.json"     # which release this folder was last updated to
WORK = ROOT / "cache" / "update"
BACKUP = ROOT / "backup"
DEFAULT_REPO = "ZephyrianYT/Universal-Multiplayer-JS-Emu"
UA = "RetroHub-updater"
ALLOWED_HOSTS = ("github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
# Top-level names an update never touches (your settings, games, emulators, caches).
KEEP = {".env", "bios", "library-folders.json", "library-hidden.json", "offsite-games.json", ".retrohub-config.json", "roms", "cache", "patches",
        "run", "node_modules", "backup", ".git", "__pycache__"}
EMU_DOCS = {"readme.md", "keyboard.md", "instruments.md", "online.md"}              # the only files updated inside emulators/
MAX_ZIP = 200 * 1024 * 1024


def env_value(key: str) -> str:
    """A value from .env (same rules as the window's read_env, simplified), else the environment."""
    try:
        for raw in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$", raw)
            if m and m.group(1) == key:
                v = m.group(2).strip()
                return "" if v.startswith("#") else v.strip("\"'")
    except OSError:
        pass
    return os.environ.get(key, "")


def repo() -> str:
    r = env_value("UPDATE_REPO").strip() or DEFAULT_REPO
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", r):
        raise SystemExit(f"UPDATE_REPO {r!r} isn't owner/name.")
    return r


def check_host(url: str) -> None:
    host = urllib.parse.urlparse(url).hostname or ""
    if not url.startswith("https://") or host not in ALLOWED_HOSTS:
        raise SystemExit(f"Refusing to download from {host or url}: updates only come from GitHub.")


class GitHubOnlyRedirects(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only when it stays on GitHub over HTTPS (checked before connecting, not after)."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_host(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(GitHubOnlyRedirects)


def get(url: str, timeout: int = 20, accept: str = "application/vnd.github+json"):
    check_host(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    return OPENER.open(req, timeout=timeout)


def package() -> dict:
    try:
        p = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        return p if isinstance(p, dict) else {}
    except (OSError, ValueError):
        return {}


def local_version() -> str:
    return str(package().get("version", ""))


def release_of(text: str) -> tuple:
    """The release number in a release/tag name: 'RetroHub0.3.0' -> (0, 3, 0), 'v0.3' -> (0, 3). () when there is none."""
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", str(text or ""))
    return tuple(int(x) for x in m.groups() if x is not None) if m else ()


def installed() -> dict:
    try:
        m = json.loads(MARKER.read_text(encoding="utf-8"))
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def latest() -> dict:
    with get(f"https://api.github.com/repos/{repo()}/releases/latest") as r:
        rel = json.load(r)
    zips = [a for a in rel.get("assets", []) if str(a.get("name", "")).lower().endswith(".zip")]
    if not zips:
        raise SystemExit(f"The newest release ({rel.get('name') or rel.get('tag_name')}) has no .zip to install.")
    # One zip per release is expected; if there are more, the one named like Retro Hub wins.
    zips.sort(key=lambda a: (not re.search(r"retro.?hub", a["name"], re.I), a["name"]))
    a = zips[0]
    digest = str(a.get("digest") or "")
    return {"tag": rel.get("tag_name", ""), "name": rel.get("name") or rel.get("tag_name", ""),
            "published": rel.get("published_at", ""), "page": rel.get("html_url", ""),
            "notes": (rel.get("body") or "")[:4000], "asset": a["name"], "size": int(a.get("size") or 0),
            "url": a.get("browser_download_url", ""),
            "sha256": digest.split(":", 1)[1].lower() if digest.lower().startswith("sha256:") else ""}


def check() -> dict:
    cur = installed()
    new = latest()
    # 1. Both sides have a release number (package.json "release" since 0.3.0, or the tag the updater installed, and
    #    the newest release's tag/name like RetroHub0.3.0): compare those.
    # 2. Else by release date against the release this folder was last updated to.
    # 3. A folder that was never updated and has no release number can't tell: "unknown" (the window asks).
    mine = release_of(package().get("release", "")) or release_of(cur.get("tag", "")) or release_of(cur.get("name", ""))
    theirs = release_of(new["tag"]) or release_of(new["name"])
    if cur.get("tag") and cur.get("tag") == new["tag"] and cur.get("sha256") == new["sha256"]:
        state = "current"
    elif mine and theirs:
        state = "newer" if theirs > mine else "current"
    elif cur.get("published"):
        state = "newer" if new["published"] > cur["published"] else "current"
    else:
        state = "unknown"
    return {"ok": True, "repo": repo(), "version": local_version(), "installed": cur, "latest": new, "state": state}


# ------------------------------------------------------------------ safety checks
def find_mpcmdrun() -> Path | None:
    cands = [Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Windows Defender" / "MpCmdRun.exe"]
    plat = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft" / "Windows Defender" / "Platform"
    try:
        cands += [d / "MpCmdRun.exe" for d in sorted(plat.iterdir(), reverse=True) if d.is_dir()]
    except OSError:
        pass
    return next((p for p in cands if p.is_file()), None)


def defender_scan(f: Path) -> None:
    if sys.platform != "win32":
        return
    mp = find_mpcmdrun()
    if not mp:
        raise SystemExit("Microsoft Defender isn't available to scan the download, so it wasn't used.")
    r = subprocess.run([str(mp), "-Scan", "-ScanType", "3", "-File", str(f), "-DisableRemediation"],
                       capture_output=True, text=True, timeout=600, creationflags=0x08000000)
    if r.returncode != 0:
        raise SystemExit(f"The Defender scan didn't come back clean (code {r.returncode}). The download was deleted.")


def safe_members(z: zipfile.ZipFile) -> tuple[str, list[zipfile.ZipInfo]]:
    """The folder inside the zip that holds Retro Hub ("" = the zip's root) and the entries under it.

    Release zips have been packed as retro-hub-x/..., as RetroHub0.2.5/retro-hub-0.2.5/... (a zipped folder of the
    folder) and flat, so the Retro Hub folder is the shallowest one holding server.mjs, package.json and apps.py.
    Refuses any path that would land outside this folder."""
    infos = z.infolist()
    for i in infos:
        p = PurePosixPath(i.filename)
        if p.is_absolute() or ".." in p.parts or ":" in i.filename or "\\" in i.filename:
            raise SystemExit(f"The update zip has an unsafe path ({i.filename}); not installed.")
    names = {i.filename for i in infos}
    roots = sorted((n[: -len("server.mjs")] for n in names if n == "server.mjs" or n.endswith("/server.mjs")),
                   key=lambda r: (r.count("/"), r))
    root = next((r for r in roots if r + "package.json" in names and r + "apps.py" in names), None)
    if root is None:
        raise SystemExit("The update zip doesn't look like Retro Hub (no server.mjs, package.json and apps.py "
                         "together); not installed.")
    top = root.rstrip("/")
    return top, [i for i in infos if i.filename.startswith(root) and len(i.filename) > len(root)]


def kept(rel: PurePosixPath) -> bool:
    first = rel.parts[0]
    if first in KEEP:
        return True
    if first == "emulators":                       # your emulators stay; only emulators/README.md etc. update
        return not (len(rel.parts) == 2 and rel.parts[1].lower() in EMU_DOCS)
    return False


# ------------------------------------------------------------------ install
def vtuple(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", str(v))[:4]) or (0,)


def apply(force: bool = False) -> dict:
    new = latest()
    if not new["sha256"]:
        raise SystemExit("GitHub publishes no checksum for this release's zip, so it can't be checked. Not installed.")
    if new["size"] > MAX_ZIP:
        raise SystemExit("The release zip is unexpectedly large. Not installed.")
    dl = WORK / re.sub(r"[^A-Za-z0-9_.-]", "_", new["tag"] or "latest")
    shutil.rmtree(dl, ignore_errors=True)
    dl.mkdir(parents=True)                         # each download in its own new folder
    zpath = dl / re.sub(r"[^A-Za-z0-9_.-]", "_", new["asset"])
    try:
        h = hashlib.sha256()
        with get(new["url"], timeout=60, accept="application/octet-stream") as r, open(zpath, "wb") as out:
            final = urllib.parse.urlparse(r.geturl()).hostname or ""
            if final not in ALLOWED_HOSTS:
                raise SystemExit(f"The download was redirected to {final}, which isn't GitHub. Not installed.")
            total = 0
            while chunk := r.read(1 << 16):
                total += len(chunk)
                if total > MAX_ZIP:
                    raise SystemExit("The download is unexpectedly large. Not installed.")
                h.update(chunk)
                out.write(chunk)
        if h.hexdigest() != new["sha256"]:
            raise SystemExit("The download's SHA-256 doesn't match the checksum GitHub publishes. It was deleted; nothing changed.")
        defender_scan(zpath)
        with zipfile.ZipFile(zpath) as z:
            top, infos = safe_members(z)
            # Never go backwards by accident: the zip's own package.json version against this folder's.
            try:
                zver = json.loads(z.read((top + "/" if top else "") + "package.json")).get("version", "")
            except (KeyError, ValueError):
                zver = ""
            if not force and zver and vtuple(zver) < vtuple(local_version()):
                raise SystemExit(f"OLDER:The newest release ({new['name']}) is version {zver}, older than this install "
                                 f"({local_version()}). Nothing was changed.")
            stamp = time.strftime("%Y%m%d-%H%M%S")
            backup = BACKUP / f"{stamp}-before-{re.sub(r'[^A-Za-z0-9_.-]', '_', new['tag'])}"
            # Read (and CRC-check) every file first, so a damaged zip stops before anything in this folder changes.
            todo = []
            for i in infos:
                if i.is_dir():
                    continue
                rel = PurePosixPath(i.filename[len(top) + 1:] if top else i.filename)
                if not rel.parts or kept(rel):
                    continue
                todo.append((rel, z.read(i)))
            changed = added = 0
            for rel, data in todo:
                dest = ROOT.joinpath(*rel.parts)
                if dest.is_file():
                    if dest.read_bytes() == data:
                        continue
                    b = backup.joinpath(*rel.parts)
                    b.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dest, b)
                    changed += 1
                else:
                    added += 1
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp = dest.with_name(dest.name + ".rh-new")
                tmp.write_bytes(data)
                os.replace(tmp, dest)
    finally:
        shutil.rmtree(dl, ignore_errors=True)       # the zip isn't kept
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps({**{k: new[k] for k in ("tag", "name", "published", "asset", "sha256")},
                                  "installed_at": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2) + "\n", encoding="utf-8")
    deps = sync_dependencies()
    return {"ok": True, "release": new["name"], "version": local_version(), "changed": changed, "added": added,
            "backup": str(backup) if changed else "", "dependencies": deps}


def sync_dependencies() -> str:
    """Re-install the server's dependency (ws) when package-lock.json says a different version than installed."""
    try:
        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        want = lock.get("packages", {}).get("node_modules/ws", {}).get("version", "")
        have = json.loads((ROOT / "node_modules" / "ws" / "package.json").read_text(encoding="utf-8")).get("version", "")
        if want and want == have:
            return "unchanged"
    except (OSError, ValueError):
        pass
    npm = shutil.which("npm")
    if not npm:
        return "npm not found: the launcher installs it on the next start"
    r = subprocess.run([npm, "ci", "--omit=dev", "--ignore-scripts"], cwd=ROOT, capture_output=True, text=True, timeout=300,
                       creationflags=0x08000000 if sys.platform == "win32" else 0)
    return "installed" if r.returncode == 0 else "npm ci failed: the launcher retries on the next start"


def hub_running() -> bool:
    """run/retro-hub.json exists while the hub runs; a crashed hub leaves it behind, so also check its port answers."""
    try:
        port = int(json.loads((ROOT / "run" / "retro-hub.json").read_text(encoding="utf-8")).get("port") or 0)
    except (OSError, ValueError):
        return False
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    try:
        if cmd == "check":
            out = check()
        elif cmd == "apply":
            if hub_running():
                raise SystemExit("Stop the hub first (the Retro Hub window does this for you).")
            out = apply(force="--force" in sys.argv)
        else:
            raise SystemExit("Use: update.py check | apply")
    except SystemExit as e:
        out = {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001 - always answer in JSON for the window
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
