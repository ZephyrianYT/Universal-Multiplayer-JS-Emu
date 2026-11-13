# Retro Hub

A self-hosted, private retro game hub with built-in browser multiplayer. Run it in Docker on your home server, share a link with friends, and play N64, SNES, PS1, GBA and more together in the browser — no installs, no sign-ups, no ROMs sent to anyone.

## Quick start

1. Install [Node.js](https://nodejs.org) 18 or newer and [Python](https://www.python.org) 3.8 or newer.
2. Download this repository (**Code → Download ZIP**) and unzip it.
3. Double-click **`launch.bat`** (Windows) or run **`./launch.sh`** (macOS / Linux). Your browser opens the hub.
4. Type a name and press **Make account**, pick a game file, then **Open lobby** and **Copy invite link**.

Friends on the same Wi-Fi use the LAN link the launcher prints. For friends anywhere else, start **`launch-tunnel.bat`** instead; see [Playing over the internet](#playing-over-the-internet).

## How it works

- **The host's browser runs the game** ([EmulatorJS](https://emulatorjs.org)) as Player 1 and streams video and audio to each guest over WebRTC.
- **Guests send only their controller input** back over a WebRTC data channel. Guests never need, receive or download the game.
- **The server is tiny**: a Node.js app that checks account keys, lists who is hosting, and relays WebRTC signaling. It never runs games itself and stores no accounts.

## Features

- **Local accounts, no passwords**: "Make account" creates an Ed25519 key pair that lives only in that browser. To sign in, the browser signs a one-time challenge from the server; the server checks the signature and issues a session cookie. There is no password, no email, and no account database — and no way to sign in to an account from anywhere else. Each account keeps its own game saves and settings, and can be exported to a backup file to move it to another device.
- **Hosts list with lobby passwords**: everyone hosting shows up live with their name and account ID. Each host sets their own lobby password (or leaves the lobby open); guests must enter it to join. A lobby belongs to the account that created it and can't be taken over.
- **Private library**: the owner's ROM folder is visible and playable only by the owner — unlock it with `ADMIN_PASSWORD` from inside the hub, or list your account ID in `ADMIN_KEYS` (optionally shared with `LIBRARY_ACCESS=all`).
- **Bring your own ROMs**: friends can host games from files on their own computer. Files stay local and are never uploaded.
- **Library grid with cover art**: the server library shows as a grid of game tiles with search, a console filter and sorting (A–Z, recently played, by console). Drop a `<game name>.png` / `.jpg` / `.webp` next to a ROM (or in a `covers/` folder beside it) and it becomes that game's cover; without one, a tile shows the console and the game's initials.
- **Lobby and in-game chat**: text chat in every room lobby, and in a pop-out drawer during the match (press **/** to type, **Enter** sends and hands the keyboard back to the game). New messages pop up briefly over the game. The hub also posts joins, leaves and saves in the chat.
- **Shared save states**: in Co-op Netplay the host can save the match at any time (**💾 Save** or **F2**) and load any save (**📂 Saves** or **F4** for the newest). Each save is also copied to every player's browser over the existing connection, so if the host has to leave, whoever hosts next can carry on from the same point. Saves can be downloaded as `.rhsave` files and imported again.
- **Single-Player Ghost mode**: everyone in the lobby runs their own copy of a single-player game on their own computer, side by side. Other players appear over your game as translucent ghosts (60% by default, tinted per player: P2 cyan, P3 magenta, P4 yellow). Ghosts are visual only: no collisions, shared items or interference, and your own input latency is unaffected. Each player loads their own ROM; only a CRC32 checksum is shared, so the lobby shows **ROM Verified (Match)** or a warning when dumps differ. All runs boot paused and start together on **GO!**
- Invite links (`/?join=CODE`, the password is never put in the link), up to 4 players.
- **Local + online seats**: the host can seat extra players on the same PC (two keyboard layouts or gamepads) and leave the rest open online.
- **Controls everywhere**: keyboard, any standard gamepad, and an on-screen **touch controller** (analog stick, d-pad, per-console buttons) for phones and tablets.
- **Many consoles**: N64, NES, SNES, GB/GBC, GBA, DS, PS1, Genesis, Master System, Game Gear, 32X, Atari, PC Engine, Neo Geo Pocket, WonderSwan and more. Each console's core is fetched once by the server from the official EmulatorJS CDN and cached.
- **Play over the internet in one click**: `launch-tunnel.bat` puts the hub on a free HTTPS address with a Cloudflare Tunnel, so you can paste an invite link into Discord. See [Playing over the internet](#playing-over-the-internet).

## Three ways to run it

| | Best for | Needs |
| --- | --- | --- |
| **[Local launcher](#1-local-launcher-python)** | Playing from your own PC tonight | Python 3.8+ and Node.js 18+ |
| **[Docker](#2-docker-home-server--nas)** | An always-on home server or NAS (Unraid, Synology, a Pi) | Docker |
| **[Manual](#3-manual-node)** | Developers | Node.js 18+ |

Whichever you pick, the emulator itself (EmulatorJS loader and scripts) is served from this project's own `public/data` folder. Browsers never load anything from a third-party CDN. Emulator cores are downloaded **by the server** the first time someone plays that console, then cached in `cache/cores`.

A fresh install contains no games, accounts or settings: `roms/` and `cache/` start empty, and `.env` is created on first launch.

### 1. Local launcher (Python)

Download or clone this repo, then:

- **Windows:** double-click `launch.bat`
- **macOS / Linux:** run `./launch.sh` (or `python3 launch.py`)

The launcher checks Node.js, installs the one server dependency on first run, creates a `.env` with a random owner password, starts the hub and opens your browser. It prints the link to give your friends and your owner unlock password. Press **Ctrl+C** to stop, or run `stop.bat` / `./stop.sh`.

To play with friends **outside your home**, use `launch-tunnel.bat` (Windows) or `./launch-tunnel.sh` instead. See [Playing over the internet](#playing-over-the-internet).

Options:

```bash
python launch.py --roms "D:/Games/ROMs"     # use your ROM folder as the owner's library
python launch.py --port 9000                # different port
python launch.py --tunnel                   # share over the internet (Cloudflare Tunnel)
python launch.py --tunnel --lan             # ...and keep the Wi-Fi link working too
python launch.py --localhost-only           # don't accept connections from other devices
python launch.py --no-browser
```

Friends on the same Wi-Fi can use the LAN link it prints.

### 2. Docker (home server / NAS)

**Using the published image** (no build). Each tagged release is published to GitHub Container Registry for amd64 and arm64:

```bash
docker run -d --name retro-hub -p 8080:8080 \
  -e ADMIN_PASSWORD=<pick-a-long-password> \
  -v /path/to/roms:/roms:ro -v retro-hub-cache:/cache \
  --restart unless-stopped ghcr.io/<github-user>/<repo>:latest
```

**Building it yourself** with Compose. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` (8+ characters), point the `roms` volume in `docker-compose.yml` at your ROM folder, then:

```bash
docker compose up -d --build
```

For internet play with your own domain, add the Cloudflare tunnel container (see [Your own domain](#your-own-domain-named-tunnel)):

```bash
docker compose --profile tunnel up -d --build
```

Open `http://<server-ip>:8080`, make an account, click **Unlock library** (owner password), pick a game, set a lobby password and click **Host lobby**. Friends open the same address, make their own account, and join you from **Hosting now**.

**Unraid:** install the **Compose Manager** plugin, copy this folder to e.g. `/mnt/user/appdata/retro-hub/src`, adjust the paths noted in `docker-compose.yml`, then **Compose Up**. Or add a container using the `ghcr.io` image above.

### 3. Manual (Node)

```bash
npm ci --omit=dev
ADMIN_PASSWORD=pick-a-long-password node server.mjs   # or: node --env-file=.env server.mjs
```

ROMs are read from `./roms` by default.

## Configuration

All settings are environment variables (see `.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | unset | Owner password for **Unlock library** inside the hub (8+ characters; placeholders like `change-me` are ignored) |
| `ADMIN_KEYS` | unset | Comma-separated account IDs that get the library automatically (the 16 characters after `#` in the top bar) |
| `ACCESS_PASSWORD` | unset (open) | Optional server-wide access code, asked once when an account first connects |
| `LIBRARY_ACCESS` | `admin` | `all` lets friends use the server library too |
| `SESSION_SECRET` | random, saved as `session.key` next to the core cache | Cookie signing key |
| `MAX_PLAYERS` | `4` | Seats per room (2–4) |
| `PORT` | `8080` | HTTP port |
| `ROMS_DIR` | `./roms` (`/roms` in Docker) | ROM library folder, scanned recursively |
| `CORES_CACHE` | `./cache/cores` (`/cache/cores` in Docker) | Where downloaded emulator cores are cached |
| `PUBLIC_URL` | unset | The hub's public address (e.g. `https://play.example.com`). Invite links use it. Set automatically by `--tunnel` quick tunnels |
| `TUNNEL_TOKEN` | unset | Cloudflare named-tunnel token for `--tunnel` or the compose `tunnel` profile |
| `TRUST_PROXY` | off | Set to `1` when a proxy on **another** machine or container fronts the hub, so client IPs are detected. A proxy on the same computer (local `cloudflared`) is trusted automatically |
| `STUN_URLS` | Google STUN | Comma-separated STUN servers |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | unset | Optional TURN relay for players behind strict NATs |

Console detection uses folder names (`n64`, `snes`, `psx`/`ps1`, `gba`, `genesis`, …) or file extensions. Folders named `bios` are skipped.

Optional cover art: an image with the same name as the ROM (`Super Game (USA).png` next to `Super Game (USA).sfc`), either in the same folder or in a `covers/`, `boxart/` or `media/` subfolder. PNG, JPEG and WebP work. Covers follow the same access rule as the library.

## Playing over the internet

Your friends need **nothing installed**: just a desktop browser (Chrome, Edge or Firefox) and your invite link. What you need is a public HTTPS address for your hub. The easiest way is a free **Cloudflare Tunnel**: no router setup, no port forwarding, and no Cloudflare account for the quick version.

### Quick tunnel (free, no account)

1. Install `cloudflared` once from Cloudflare:
   - Windows: `winget install --id Cloudflare.cloudflared`
   - macOS: `brew install cloudflared`
   - Linux: [Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Double-click **`launch-tunnel.bat`** (Windows) or run `./launch-tunnel.sh`. It prints an address like `https://random-words.trycloudflare.com` and opens the hub there.
3. Pick a game, set a lobby password, **Host lobby**, then **Copy invite link** and paste it into Discord. Send the lobby password separately; it is never put in the link.
4. Your friend opens the link, makes an account (type a name, one click), enters the lobby password, takes a seat and presses **Ready**.

In **Co-op Netplay** your browser runs the game and streams it, so friends do **not** need the ROM. In **Ghost mode** each player loads their own copy.

The quick-tunnel address changes every time you start it, and Cloudflare offers quick tunnels without an uptime guarantee. For a permanent address, use a named tunnel.

### Your own domain (named tunnel)

1. In the Cloudflare dashboard (**Zero Trust → Networks → Tunnels**), create a tunnel and add a **public hostname**, e.g. `play.example.com`, pointing to:
   - `http://localhost:8080` when you use the launcher, or
   - `http://retro-hub:8080` when you use Docker Compose.
2. Put these in `.env`:
   ```ini
   TUNNEL_TOKEN=<the token Cloudflare shows>
   PUBLIC_URL=https://play.example.com
   ACCESS_PASSWORD=<a code you give your friends>   # recommended for a permanent address
   TRUST_PROXY=1                                   # Docker Compose only
   ```
3. Start it with `launch-tunnel.bat` / `./launch-tunnel.sh`, or `docker compose --profile tunnel up -d --build`.

### Good to know

- With `--tunnel` the hub listens only on this computer and `cloudflared` is its one way in. Add `--lan` to keep the Wi-Fi link working too.
- Invite links always use the public address. If you copy one while the hub has no public address and you're on `localhost`, the hub warns you that the link only works on your PC.
- HTTPS also enables cross-origin isolation, which lets the faster **multi-threaded** cores run. On plain HTTP over a LAN IP, the single-threaded cores are used.
- Anyone who has your hub's address can make an account and see who is hosting (not join a password lobby, and not see your library). To keep strangers out entirely, set `ACCESS_PASSWORD`; each account is asked for it once.
- Game video, audio and controls go **directly between players' browsers** (WebRTC), not through the tunnel. The tunnel only carries the website and the lobby. Most home connections work with STUN alone. If a guest sees "Couldn't connect to the host directly", configure a TURN server (e.g. coturn).
- Other HTTPS reverse proxies (Nginx Proxy Manager, SWAG, Caddy) work too. Forward **WebSockets** on `/ws`, set `PUBLIC_URL`, and set `TRUST_PROXY=1` if the proxy runs on another machine or container.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The game stays on "Download Game Core" | The hub downloads each console's emulator core once, the first time it is played. The computer running the hub needs internet access for that. Afterwards the core is cached in `cache/cores`. |
| A guest sees "Couldn't connect to the host directly" | Some networks block direct connections. Set up a TURN server (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` in `.env`). |
| No sound for a guest | Browsers block sound until you click. Press **Turn sound on** in the top bar. |
| "Server library" tab is missing | The library is owner-only. Press **Unlock library** and enter the `ADMIN_PASSWORD` from `.env` (the launcher prints it). |
| Windows warns about `launch.bat` | It's a plain text script; open it in Notepad to see what it does. It starts `launch.py`. |
| Port 8080 is already in use | `python launch.py --port 9000` |
| An account is gone after clearing browser data | Accounts live only in the browser. Use **Export account** to keep a backup file and **Import backup** to restore it. |

## Legal

This project does not include any games. Only play games you own. ROM files are excluded from this repository and never leave the owner's server or the host's computer.

## License

GPL-3.0 — see [LICENSE](LICENSE). Retro Hub bundles [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (GPL-3.0) in `public/data` and [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) 1.0.3 (public domain, Unlicense) in `public/vendor`; emulator cores are licensed by their respective authors. The look follows the design tokens of the Canary design system.

See [CHANGELOG.md](CHANGELOG.md) for release notes.
