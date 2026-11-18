#!/bin/sh
# Start Retro Hub on this computer (macOS / Linux).
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 launch.py "$@"; fi
if command -v python >/dev/null 2>&1; then exec python launch.py "$@"; fi
echo "Python 3 was not found. Install it from https://www.python.org/downloads/ and try again." >&2
exit 1
