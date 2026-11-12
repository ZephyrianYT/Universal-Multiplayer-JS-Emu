# Changelog

## 1.2.0 — 2026-11-12

### Local accounts replace the shared password
- **Make account** creates an Ed25519 key pair that is stored only in that browser (IndexedDB). There is no password and no email, nothing about accounts is stored on the server, and there is no way to sign in to an account from another device. A backup file can move an account to another browser.
- Signing in is a key handshake: the browser signs a one-time server challenge (TweetNaCl, works on plain-HTTP LAN addresses too) and the server verifies it before issuing a session cookie. Returning players are signed in automatically.
- Every account has an ID (`#XXXX-XXXX-XXXX-XXXX`) shown in the top bar, the hosts list and the in-game player list.
- Each account keeps separate game saves, save states and per-game settings on a shared computer.
- **Breaking:** `ACCESS_PASSWORD` is no longer the friends' login. It is now an optional server-wide access code (unset = anyone with the link can make an account). The owner unlocks the library with **Unlock library** + `ADMIN_PASSWORD`, or automatically via the new `ADMIN_KEYS`.

### Hosts list and lobby passwords
- **Hosting now** lists every host live, with their name, account ID, game, players and a lock badge.
- Each host sets their own lobby password (or leaves it open). Guests are asked for it before joining; wrong guesses are rate-limited. Passwords are kept in server memory only as salted scrypt hashes and are never put in invite links.
- A lobby belongs to the account that created it: nobody else can take it over, even while the host is reconnecting. Guests can no longer create empty lobbies by opening an unknown invite code.

### Look
- New design based on the Canary design system tokens: coal background, canary-yellow accents, condensed uppercase headings, cards with a yellow top bar. Fonts fall back to local system fonts; nothing is loaded from a third party.
- Docker image `retro-hub:1.2.0`.

## 1.1.0 — 2026-11-12

### On-screen touch controls for guests
- Guests get a touch controller overlay: a draggable analog stick, d-pad, and buttons that match the console (N64: A, B, Z, L, R, Start and all four C buttons; everything else: the RetroPad layout with A/B/X/Y, shoulders, Select and Start).
- It appears automatically on phones and tablets, and can be shown or hidden any time with the **Touch pad** button in the in-game HUD. The choice is remembered.
- Touch, keyboard and gamepad all work at the same time; for each control the strongest input wins.
- Docker image `retro-hub:1.1.0`.
- Verified locally (host + guest tab, touch input reaching the host's game). Not yet tested on a real phone.

### Easier to run
- **Local launcher**: `launch.py` (double-click `launch.bat` on Windows, `launch.sh` on macOS/Linux) checks Node.js, installs dependencies, creates a `.env` with random passwords, starts the hub and opens the browser. Options: `--roms`, `--port`, `--localhost-only`, `--no-browser`.
- **Published Docker image**: a GitHub Actions workflow builds the image for amd64 and arm64 and publishes it to `ghcr.io` on every version tag.
- The project is licensed GPL-3.0 (matching the bundled EmulatorJS). Added a README.

## 1.0.0 — 2026-11-12

First release of **Retro Hub**: a self-hosted, private retro-game hub with built-in browser multiplayer.

### Access
- Login page with a name and password. `ACCESS_PASSWORD` is for friends; `ADMIN_PASSWORD` is for the owner.
- Signed HttpOnly session cookie (30 days). Login attempts are rate-limited per IP.
- Every page, file, emulator asset and the `/ws` socket requires a login.

### Library
- The owner's ROM folder (`ROMS_DIR`, mounted read-only at `/roms`) is scanned recursively, and each game's console is detected from its folder name or file extension.
- The library and the `/roms/*` downloads are owner-only (set `LIBRARY_ACCESS=all` to share them).
- Friends play their own ROMs from their computer. These files are never uploaded.

### Multiplayer
- The host's browser runs the game as P1 and streams video and audio to guests over WebRTC. Guests' controller input goes back over a data channel.
- Live **Open rooms** list, invite links (`/?join=CODE`), up to 4 seats (`MAX_PLAYERS`), and local seats on the host's PC (keyboard A/B, gamepad).
- STUN by default, with an optional TURN relay (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`).

### Consoles
- N64 (cores stored locally) plus NES, SNES, GB/GBC, GBA, DS, PS1, Genesis, Master System, Game Gear, 32X, Atari, PC Engine, Neo Geo Pocket, WonderSwan and more. Missing cores are fetched once from the official EmulatorJS 4.2.3 CDN and cached in `CORES_CACHE`.
- Controller layouts adjust to the console: N64 has its own layout, the others use RetroPad.

### Deployment
- Docker image `retro-hub:1.0.0` (node:22-alpine, runs as a non-root user), with volumes `/roms` and `/cache`.
- `docker-compose.yml` is ready for Unraid's Compose Manager. HTTPS through a reverse proxy enables threaded cores.

### Known limitations
- BIOS-dependent consoles (Sega CD, some PS1 cores) are not supported yet.
- Guests have no on-screen touch controls.
- Not yet tested: consoles other than N64 end to end, the Docker build, and play over the internet.
