#!/usr/bin/env python3
"""Build the Retro Hub release zip from this git checkout.

  python scripts/make_release.py            -> release/RetroHub<release>.zip and release/notes.md
  python scripts/make_release.py --check    only check that everything is ready (versions, changelog, files)

The zip holds every file git tracks, inside one folder "retro-hub-<release>/", the layout the in-app updater
(setup/update.py) and the README's "unzip and run launch.bat" expect. Only tracked files go in, so your .env,
games, BIOS files, emulators, caches and node_modules can never end up in a release.

The version comes from package.json: "version" (e.g. 1.26.1) and "release" (e.g. 0.3.4, the number players
see). notes.md is that version's section of docs/CHANGELOG.md, used as the GitHub release text.

The GitHub workflow .github/workflows/release.yml runs this and publishes the release, so a release can be made
from the GitHub website or app (Actions > Release > Run workflow) without a PC. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "release"
# The updater refuses a zip without these three together (setup/update.py safe_members).
REQUIRED = ("server.mjs", "package.json", "apps.py")
# Files a release must have for features to work (each was missing from a git checkout once, see CHANGELOG 1.26.2).
MUST_SHIP = ("launch.bat", "launch.py", "RetroHub.pyw", "core/offsite-games.json", "public/index.html",
             "public/j2me/init.zip", "public/v86/seabios.bin", "public/v86/vgabios.bin")
FIXED_TIME = (2020, 1, 1, 0, 0, 0)   # same bytes for the same files, whenever it's built


def fail(msg: str) -> None:
    print(f"[release] {msg}", file=sys.stderr)
    sys.exit(1)


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        fail(f"git {' '.join(args)} failed: {getattr(e, 'stderr', '') or e}")
    return ""


def versions() -> tuple[str, str]:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version, release = str(pkg.get("version", "")), str(pkg.get("release", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail(f'package.json "version" should look like 1.26.1, it is {version!r}.')
    if not re.fullmatch(r"\d+\.\d+\.\d+", release):
        fail(f'package.json "release" should look like 0.3.4, it is {release!r}.')
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    for where, v in (("package-lock.json", lock.get("version")), ('package-lock.json packages[""]',
                                                                  lock.get("packages", {}).get("", {}).get("version"))):
        if v != version:
            fail(f"{where} says version {v!r} but package.json says {version!r}. Set both to the same number.")
    return version, release


def changelog_section(version: str) -> str:
    text = (ROOT / "docs" / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(rf"^## {re.escape(version)}\b.*?$\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m or not m.group(1).strip():
        fail(f"docs/CHANGELOG.md has no '## {version}' section. Add what changed before releasing.")
    return m.group(1).strip() + "\n"


def tracked_files() -> list[str]:
    if git("status", "--porcelain", "--untracked-files=no").strip():
        print("[release] Note: there are uncommitted changes; the zip uses the files as they are on disk.")
    files = [f for f in git("ls-files", "-z").split("\0") if f]
    missing = [f for f in REQUIRED + MUST_SHIP if f not in files]
    if missing:
        fail("These files aren't tracked by git, so they'd be missing from the release: " + ", ".join(missing)
             + "\n  Check .gitignore, then git add them.")
    gone = [f for f in files if not (ROOT / f).is_file()]
    if gone:
        fail("Tracked but not on disk (deleted?): " + ", ".join(gone[:10]))
    return sorted(files)


def build(version: str, release: str, files: list[str]) -> Path:
    OUT.mkdir(exist_ok=True)
    zpath = OUT / f"RetroHub{release}.zip"
    top = f"retro-hub-{release}"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            src = ROOT / f
            info = zipfile.ZipInfo(f"{top}/{f}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            executable = f.endswith(".sh") or src.stat().st_mode & 0o111
            info.external_attr = ((0o755 if executable else 0o644) | 0o100000) << 16
            z.writestr(info, src.read_bytes())
    (OUT / "notes.md").write_text(changelog_section(version), encoding="utf-8")
    return zpath


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="only check, don't build")
    args = ap.parse_args()
    version, release = versions()
    changelog_section(version)
    files = tracked_files()
    if args.check:
        print(f"[release] Ready: Retro Hub {release} (version {version}), {len(files)} files.")
        return
    zpath = build(version, release, files)
    print(f"[release] Built {zpath.relative_to(ROOT)} ({zpath.stat().st_size / 1e6:.1f} MB, {len(files)} files) "
          f"and release/notes.md")
    # For the workflow: values it reads back.
    print(f"RELEASE={release}\nVERSION={version}\nZIP={zpath.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
