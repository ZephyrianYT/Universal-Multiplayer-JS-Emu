#!/usr/bin/env python3
"""Stop a Retro Hub server running on this computer.

Reads run/retro-hub.json (written by the server at start-up, readable by this user only) and asks the
server to shut down over loopback with the random token in that file. Players are told the server is
closing. Uses only the Python standard library (Python 3.8+).
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

RUN_FILE = Path(__file__).resolve().parent / "run" / "retro-hub.json"


def main() -> int:
    try:
        info = json.loads(RUN_FILE.read_text(encoding="utf-8"))
        port, token = int(info["port"]), str(info["token"])
    except FileNotFoundError:
        print("[retro-hub] No running server found (run/retro-hub.json is missing). Nothing to stop.")
        return 0
    except (ValueError, KeyError, TypeError, OSError) as e:
        print(f"[retro-hub] Could not read {RUN_FILE}: {e}", file=sys.stderr)
        return 1
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/shutdown", data=b"{}", method="POST",
                                 headers={"X-Shutdown-Token": token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            ok = r.status in (200, 202)
    except urllib.error.HTTPError as e:
        print(f"[retro-hub] The server refused to stop (HTTP {e.code}).", file=sys.stderr)
        return 1
    except (urllib.error.URLError, OSError):
        # Nothing answered on that port: the server already exited without cleaning up its run file.
        try:
            RUN_FILE.unlink()
        except OSError:
            pass
        print("[retro-hub] The server was not running. Cleaned up its old run file.")
        return 0
    print("[retro-hub] Server is shutting down." if ok else "[retro-hub] Unexpected answer from the server.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
