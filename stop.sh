#!/bin/sh
# Stop the Retro Hub server running on this computer (macOS / Linux).
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 stop.py; fi
if command -v python >/dev/null 2>&1; then exec python stop.py; fi
echo "Python 3 was not found. Press Ctrl+C in the Retro Hub window instead." >&2
exit 1
