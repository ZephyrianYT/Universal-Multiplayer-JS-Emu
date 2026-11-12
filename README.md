# Retro Hub

A self-hosted, private retro game hub with built-in browser multiplayer. Run it in Docker on your home server, share a link with friends, and play N64, SNES, PS1, GBA and more together in the browser — no installs, no sign-ups, no ROMs sent to anyone.

## How it works

- **The host's browser runs the game** ([EmulatorJS](https://emulatorjs.org)) as Player 1 and streams video and audio to each guest over WebRTC.
- **Guests send only their controller input** back over a WebRTC data channel. Guests never need, receive or download the game.
- **The server is tiny**: a Node.js app that checks account keys, lists who is hosting, and relays WebRTC signaling. It never runs games itself and stores no accounts.

## Features

- **Local accounts, no passwords**: "Make account" creates an Ed25519 key pair that lives only in that browser. To sign in, the browser signs a one-time challenge from the server; the server checks the signature and issues a session cookie. There is no password, no email, and no account database — and no way to sign in to an account from anywhere else. Each account keeps its own game saves and settings, and can be exported to a backup file to move it to another device.
- **Hosts list with lobby passwords**: everyone hosting shows up live with their name and account ID. Each host sets their own lobby password (or leaves the lobby open); guests must enter it to join. A lobby belongs to the account that created it and can't be taken over.
- **Private library**: the owner's ROM folder is visible and playable only by the owner — unlock it with `ADMIN_PASSWORD` from inside the hub, or list your account ID in `ADMIN_KEYS` (optionally shared with `LIBRARY_ACCESS=all`).
- **Bring your own ROMs**: friends can host games from files on their own computer. Files stay local and are never uploaded.
- Invite links (`/?join=CODE`, the password is never put in the link), up to 4 players.
- **Local + online seats**: the host can seat extra players on the same PC (two keyboard layouts or gamepads) and leave the rest open online.
- **Controls everywhere**: keyboard, any standard gamepad, and an on-screen **touch controller** (analog stick, d-pad, per-console buttons) for phones and tablets.
- **Many consoles**: N64 cores ship with the app; NES, SNES, GB/GBC, GBA, DS, PS1, Genesis, Master System, Game Gear, 32X, Atari, PC Engine, Neo Geo Pocket, WonderSwan and more are fetched once from the official EmulatorJS CDN and cached.

## Three ways to run it

| | Best for | Needs |
| --- | --- | --- |
| **[Local launcher](#1-local-launcher-python)** | Playing from your own PC tonight | Python 3.8+ and Node.js 18+ |
| **[Docker](#2-docker-home-server--nas)** | An always-on home server or NAS (Unraid, Synology, a Pi) | Docker |
| **[Manual](#3-manual-node)** | Developers | Node.js 18+ |

Whichever you pick, the emulator itself (EmulatorJS loader, scripts and N64 cores) is served from this project's own `public/data` folder. Browsers never load it from a third-party CDN. Cores for other consoles are downloaded **by the server** the first time someone plays them, then cached.

### 1. Local launcher (Python)

Download or clone this repo, then:

- **Windows:** double-click `launch.bat`
- **macOS / Linux:** run `./launch.sh` (or `python3 launch.py`)

The launcher checks Node.js, installs the one server dependency on first run, creates a `.env` with a random owner password, starts the hub and opens your browser. It prints the link to give your friends and your owner unlock password. Press **Ctrl+C** to stop.

Options:

```bash
python launch.py --roms "D:/Games/ROMs"     # use your ROM folder as the owner's library
python launch.py --port 9000                # different port
python launch.py --localhost-only           # don't accept connections from other devices
python launch.py --no-browser
```

Friends on the same Wi-Fi can use the LAN link it prints. For friends over the internet, see [Playing over the internet](#playing-over-the-internet).

### 2. Docker (home server / NAS)

**Using the published image** (no build). Each tagged release is published to GitHub Container Registry for amd64 and arm64:

```bash
docker run -d --name retro-hub -p 8080:8080 \
  -e ADMIN_PASSWORD=change-me-owner \
  -v /path/to/roms:/roms:ro -v retro-hub-cache:/cache \
  --restart unless-stopped ghcr.io/<github-user>/<repo>:latest
```

**Building it yourself** with Compose. Edit `docker-compose.yml` (owner password and your ROM folder), then:

```bash
docker compose up -d --build
```

Open `http://<server-ip>:8080`, make an account, click **Unlock library** (owner password), pick a game, set a lobby password and click **Host lobby**. Friends open the same address, make their own account, and join you from **Hosting now**.

**Unraid:** install the **Compose Manager** plugin, copy this folder to e.g. `/mnt/user/appdata/retro-hub/src`, adjust the paths noted in `docker-compose.yml`, then **Compose Up**. Or add a container using the `ghcr.io` image above.

### 3. Manual (Node)

```bash
npm ci --omit=dev
ADMIN_PASSWORD=owner node server.mjs
```

ROMs are read from `./roms` by default.

## Configuration

All settings are environment variables (see `.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | unset | Owner password for **Unlock library** inside the hub |
| `ADMIN_KEYS` | unset | Comma-separated account IDs that get the library automatically (the 16 characters after `#` in the top bar) |
| `ACCESS_PASSWORD` | unset (open) | Optional server-wide access code, asked once when an account first connects |
| `LIBRARY_ACCESS` | `admin` | `all` lets friends use the server library too |
| `SESSION_SECRET` | random, saved as `session.key` next to the core cache | Cookie signing key |
| `MAX_PLAYERS` | `4` | Seats per room (2–4) |
| `PORT` | `8080` | HTTP port |
| `ROMS_DIR` | `./roms` (`/roms` in Docker) | ROM library folder, scanned recursively |
| `CORES_CACHE` | `./cache/cores` (`/cache/cores` in Docker) | Where downloaded emulator cores are cached |
| `TRUST_PROXY` | off | Set to `1` behind your own reverse proxy so client IPs and HTTPS are detected |
| `STUN_URLS` | Google STUN | Comma-separated STUN servers |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | unset | Optional TURN relay for players behind strict NATs |

Console detection uses folder names (`n64`, `snes`, `psx`/`ps1`, `gba`, `genesis`, …) or file extensions. Folders named `bios` are skipped.

## Playing over the internet

- Put the hub behind a reverse proxy with **HTTPS** (Nginx Proxy Manager, SWAG, Caddy, a Cloudflare tunnel, …) and make sure it forwards **WebSockets** on `/ws`. Set `TRUST_PROXY=1`.
- HTTPS also enables cross-origin isolation, which lets the faster **multi-threaded** cores run. On plain HTTP over a LAN IP, the single-threaded cores are used.
- Anyone who has your hub's address can make an account and see who is hosting (not join a password lobby, and not see your library). To keep strangers out entirely, set `ACCESS_PASSWORD`; each account is asked for it once.
- Most home connections work with STUN alone. If a guest sees "Couldn't connect to the host directly", configure a TURN server (e.g. coturn).

## Legal

This project does not include any games. Only play games you own. ROM files are excluded from this repository and never leave the owner's server or the host's computer.

## License

GPL-3.0 — see [LICENSE](LICENSE). Retro Hub bundles [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (GPL-3.0) in `public/data` and [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) 1.0.3 (public domain, Unlicense) in `public/vendor`; emulator cores are licensed by their respective authors. The look follows the design tokens of the Canary design system.

See [CHANGELOG.md](CHANGELOG.md) for release notes.
