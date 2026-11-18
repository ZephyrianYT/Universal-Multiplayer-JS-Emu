# Retro Hub: advanced guide

> New here? [README.md](README.md) is the short version: install, start, invite friends.

Retro Hub is a self-hosted game hub for playing retro and modern console games with friends. One person (the **owner**) runs the hub on their PC or home server. Friends open a link in their browser, make an account with one click, and join a lobby.

- **Browser consoles** (NES through PS1, N64, GBA, DS, PSP and more) run inside the host's browser with [EmulatorJS](https://emulatorjs.org). The host streams video and audio to the guests over WebRTC, and the guests send back only their controller input.
- **Native consoles** (PS2, GameCube, Wii, PS3, Xbox, Xbox 360, Wii U, Switch, 3DS, Dreamcast) and **PC games** run in real desktop emulators on the owner's PC. The browser captures that window and streams it the same way.
- **Nothing is uploaded.** ROMs stay on the owner's disk or on the player's own computer. Accounts are keys kept in each browser, so the server has no account database.

This guide covers installing the hub, using it day to day, and how it works inside.

---

## Contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Requirements](#2-requirements)
3. [Installing (fresh install)](#3-installing-fresh-install)
4. [The Retro Hub window (launcher and admin panel)](#4-the-retro-hub-window-launcher-and-admin-panel)
5. [Command-line launcher](#5-command-line-launcher)
6. [Using the hub](#6-using-the-hub)
7. [The ROM library](#7-the-rom-library)
8. [Native emulators and PC games](#8-native-emulators-and-pc-games)
9. [Playing over the internet](#9-playing-over-the-internet)
10. [Docker and NAS](#10-docker-and-nas)
11. [Configuration reference](#11-configuration-reference)
12. [Security model](#12-security-model)
13. [Internals: API, WebSocket protocol, WebRTC](#13-internals-api-websocket-protocol-webrtc)
14. [Files and folders](#14-files-and-folders)
15. [Troubleshooting](#15-troubleshooting)
16. [Legal and license](#16-legal-and-license)

---

## 1. Architecture at a glance

```
                        ┌──────────────────────────── Owner's PC ────────────────────────────┐
                        │                                                                    │
  launch.bat ──► RetroHub.pyw (Tk window) ──► launch.py ──► node server.mjs  (port 8080)      │
                        │                         │            │  HTTP: pages, API, ROMs, cores│
                        │                         │            │  WS /ws: lobbies + signaling  │
                        │                         └► cloudflared (optional tunnel)             │
                        │                                      │                              │
                        │        native games only:  server.mjs ─► apps.py run (Job Object)   │
                        │                                      │      └► PCSX2 / Dolphin / …  │
                        │                                      └► input_bridge.py (virtual pads/keys)
                        └────────────────────────────────────────────────────────────────────┘
                                   ▲  website + lobby (HTTP/WS)       ▲
                                   │                                  │
   ┌──── Host's browser ────┐      │                                  │      ┌──── Guest's browser ────┐
   │ EmulatorJS core (P1)    │◄─────┘                                  └─────►│ video <element>          │
   │ or captured emu window  │════ WebRTC: video + audio  ═══════════════════►│                          │
   │ HostNet                 │◄═══ WebRTC data channel: controller state ═════│ gamepad / keys / touch   │
   └─────────────────────────┘                                                └──────────────────────────┘
```

| Part | Role |
| --- | --- |
| `server.mjs` | The Node.js server. It verifies accounts, issues session cookies, serves the site and EmulatorJS, and serves the owner's ROMs to the owner only. It keeps the lobby list, relays WebRTC signaling over `/ws`, and downloads and caches emulator cores. It never runs browser games itself. |
| Host's browser | Runs the game as Player 1, or captures a native emulator's window. It encodes the stream and applies guests' input. |
| Guests' browsers | Show the stream and send controller state. They never receive the ROM. |
| `RetroHub.pyw` | The desktop control panel: start/stop, settings, apps, a file editor and an admin console. |
| `launch.py` | Checks Node, installs the dependency, creates `.env`, starts the server and the optional Cloudflare tunnel. |
| `apps.py` | Registry and runner for native emulators and PC games. |
| `core/streaming/` | `native.mjs` (server side of native games) and `input_bridge.py` (turns guest input into virtual gamepads or keys). |

Game media (video, audio and input) travels **directly between browsers** over WebRTC. The server, or the tunnel, only carries the website and the lobby messages.

---

## 2. Requirements

| | Needed for | Notes |
| --- | --- | --- |
| **Node.js 18+** | Always | [nodejs.org](https://nodejs.org), LTS build. Includes `npm`. |
| **Python 3.8+ with tkinter** | The launcher window, `apps.py`, native emulators | [python.org](https://www.python.org/downloads/). On Windows, tick **Add python.exe to PATH**. The python.org installer includes tkinter. On Linux you may need `python3-tk`. |
| Chrome, Edge or Firefox | Everyone | Desktop browsers are best. Phones and tablets work as guests with the touch controller. |
| `cloudflared` | Internet play only | `winget install --id Cloudflare.cloudflared` (Windows), `brew install cloudflared` (macOS). |
| Internet on the hub PC | The first time each console is played | Cores are downloaded once from the official EmulatorJS CDN, then cached. |
| Native emulator builds | Native consoles only | You supply portable builds plus your own BIOS, firmware and keys. See [section 8](#8-native-emulators-and-pc-games). |
| `vgamepad` + ViGEmBus (Windows) or `evdev` (Linux) | Optional | Analog virtual gamepads for guests in native games. Without them, keyboard mode is used. |

On Windows you don't have to install these by hand: `launch.bat` offers Python and Node.js, and the Retro Hub window offers Node.js, ViGEmBus and `vgamepad`. Each one is downloaded from its official source and checked first (`setup/deps.ps1`: SHA-256 against the publisher's checksum where one is published, publisher signature, Microsoft Defender scan). Run it yourself with `powershell -ExecutionPolicy Bypass -File setup\deps.ps1` (`-Check` only reports).

---

## 3. Installing (fresh install)

1. Install Node.js and Python (see above).
2. Unzip the release zip (for example `RetroHub0.3.3.zip`, which holds a `retro-hub-0.3.3` folder) anywhere, for example `C:\Games\retro-hub`. The path can contain spaces.
3. Double-click **`launch.bat`** (Windows). On macOS or Linux, run `python3 RetroHub.pyw` (or `./launch.sh` for the console launcher).
4. The first time, the window asks **Would you like to create a RetroHub desktop shortcut?** Yes puts a RetroHub shortcut with the duck icon on your Desktop (see [Desktop shortcut](#desktop-shortcut)).
5. In the window, press **▶ Start**.

What happens on the first start:

| Step | Done by | Result |
| --- | --- | --- |
| Find a Python that really runs | `launch.bat` | It runs `py -3`, then `python`, then `python3`. Windows' Microsoft Store shortcuts are skipped because they fail when run. |
| Check tkinter, find `pythonw.exe` | `launch.bat` | The window opens with no console behind it. Without tkinter it falls back to the console launcher. |
| Check Node.js ≥ 18 | `launch.py` | Clear error if it's missing or too old. |
| `npm ci --omit=dev --ignore-scripts` | `launch.py` | Installs the only dependency, `ws`, into `node_modules/`. Needs internet once. |
| Create `.env` | `launch.py` | Random 16-character `ADMIN_PASSWORD`, `PORT=8080`, `MAX_PLAYERS=4`. |
| Create `cache/session.key` | `server.mjs` | Random 32-byte cookie-signing key, so sign-ins survive restarts. |
| Write `run/retro-hub.json` | `server.mjs` | PID, port and a random shutdown token, used by Stop and `stop.py`. |
| Offer a desktop shortcut | the window / `launch.py` | Asked once; the answer is kept in `.retrohub-config.json`. |
| Check the setup | the window | Warnings with a fix button (empty emulators folder, unreachable console folders…). |
| Check for updates | the window | Quietly; an available release shows in the warnings box. `UPDATE_CHECK=off` turns it off. |
| Open the browser | the window | At `http://localhost:8080`, or the tunnel address. |

A fresh install has **no games, accounts, settings or emulators**. `roms/` is empty, the `emulators/<name>/` folders are empty placeholders, and `.env`, `cache/`, `run/`, `library-folders.json` and `.retrohub-config.json` are created when needed.

### Desktop shortcut

`setup/shortcut.py` makes it, with the Retro Hub mascot icon from `assets/icon/`:

| System | What is created | Opens |
| --- | --- | --- |
| Windows | `RetroHub.lnk` on the Desktop (the real one, also when OneDrive moves it; found with `[Environment]::GetFolderPath('Desktop')`), made with PowerShell's `WScript.Shell`. Icon `assets/icon/retrohub.ico`, working folder = the hub folder, started minimised. | `launch.bat` (the window) |
| Linux | `RetroHub.desktop` on the Desktop (`xdg-user-dir DESKTOP`) and in `~/.local/share/applications`, `chmod +x`, marked trusted on GNOME. `Icon=` `assets/icon/retrohub.png`, `Path=` the hub folder. | the window (`RetroHub.pyw`), or `launch.sh` in a terminal without tkinter |
| macOS | `RetroHub.app` on the Desktop: a small app bundle with `retrohub.icns`. | the window, or `launch.sh` in Terminal without tkinter |

The question comes once (the answer is saved as `"promptedDesktopShortcut": true` in `.retrohub-config.json`). Make one any time with **Settings → Desktop shortcut**, `launch.bat --create-shortcut`, `python launch.py --create-shortcut` or `python setup/shortcut.py create`; `--setup` asks again. After creating it, the path is printed and the shortcut and its icon are checked on disk. Moving the hub folder breaks the shortcut: make it again. `RETROHUB_DESKTOP=<folder>` puts it somewhere else.

### Updating

**Server → Check for updates** (also checked quietly when the window opens) installs the newest GitHub release of `UPDATE_REPO` into this folder (`setup/update.py`):

- **Kept**: `.env`, `library-folders.json`, `library-hidden.json`, `.retrohub-config.json`, `emulators/` (your builds and `apps.json`; only its README / KEYBOARD / INSTRUMENTS docs update), `roms/`, `cache/`, `run/`, `node_modules/`.
- **Backed up**: every file it replaces goes to `backup/<date-time>-before-<release>/` first.
- **Checked** before anything changes: downloaded only from GitHub over HTTPS, SHA-256 against the checksum GitHub publishes for the file, a Microsoft Defender scan (Windows), and the zip itself (no paths outside its folder, must contain `server.mjs`, `package.json`, `apps.py`). A failed check deletes the download and changes nothing.
- **Newer?** It compares release numbers: this install's (`"release"` in `package.json`) against the newest release's name or tag (e.g. `RetroHub0.3.3`, `v0.3.3`). Release zips may have the Retro Hub folder at any depth.
- An older version than the one installed isn't installed unless you confirm. The hub is stopped first; the window restarts itself afterwards.
- From a terminal: `python setup/update.py check` / `apply` (`--force` for an older release).

The owner password is shown in the **Settings** tab (press **Show**), in `.env`, and in the server log.

---

## 4. The Retro Hub window (launcher and admin panel)

`RetroHub.pyw` is a single-file Tk program that uses only the standard library. It is the intended way to run the hub on a desktop PC.

### Server tab

| Control | What it does |
| --- | --- |
| **▶ Start** | Runs `python -u launch.py --no-browser [mode flags]` as a hidden child process and streams its output into the log. |
| **■ Stop** | Sends `POST /api/shutdown` with the token from `run/retro-hub.json`. Players see "server is closing". If the server hasn't exited after 8 s, it ends the whole process tree (`taskkill /T /F`). |
| **↻ Restart** | Stop, then Start with the same options. Needed after changing settings. |
| **This computer + Wi-Fi/LAN** | Default. Listens on all interfaces, and the log shows a *Friends on your Wi-Fi* link. |
| **This computer only** | `--localhost-only`: listens on `127.0.0.1`. |
| **Internet (Cloudflare Tunnel)** | `--tunnel`: starts `cloudflared` and gives the hub a public HTTPS address. The hub then listens on `127.0.0.1` only, unless **Tunnel: keep Wi-Fi link too** (`--lan`) is ticked. |
| **Open browser when ready** | Opens the hub address once the log shows *Retro Hub is running*. |
| **Open hub / Copy link / Copy Wi-Fi link** | Uses the addresses read from the log. |
| **Check for updates** | See [Updating](#updating). |

**Setup needs a look** appears above the connection options when something would stop the hub finding games or emulators, each with a button that fixes it: an emulators or ROM folder that is missing, empty or inside another Retro Hub folder (a `.env` copied from an older version), console folders that can't be reached (a drive that isn't plugged in), consoles that share a games folder, and an available update.

The status line shows *Starting… / Running / Stopping… / Stopped*. If a hub started some other way is already running (found through `run/retro-hub.json` and an open port), it shows **Running (started elsewhere)**, and **Stop** works on it too.

**Closing the window stops the hub**, because the hub's output runs through the window. To keep a hub running without the window, use the command-line launcher or Docker.

### Settings tab

A form over `.env`. **Save** rewrites only the keys in the form. Comments and other lines are kept, a cleared value is commented out (`# KEY=`), and values with spaces or `#` are quoted. Save checks that the port is a number, the owner password has at least 8 characters, folders exist, and a tunnel token has an `https://` public URL. If the hub is running, it offers a restart. **New owner password** generates a random one; press **Save** to keep it. **Edit .env as text** opens the file in the Files tab. **Desktop shortcut** makes the RetroHub shortcut.

**Consoles…** (next to the ROM folder) opens a window listing every console. For each one, pick the folder its games are in (**Browse** / **Clear**; empty = found by name under the ROM folder) and, for native consoles, the emulator that runs them (**Automatic** = the first installed one). **Save** writes `library-folders.json` and `prefer` in `emulators/apps.json`; the hub uses them the next time it starts, and offers a restart if it's running.

### Apps tab

The same registry as `python apps.py`. It lists emulators (built-in and yours), consoles and the emulator each one uses, and PC games, with ✔ for installed.

- **Add PC game**: asks for a name, then the `.exe`, then optional launch options.
- **Add emulator**: asks for a name, the `.exe`, the console ids it handles, and a launch-options template (`{game}` = game path).
- **Remove selected**: only works on entries you added. Files are never deleted.
- **Check requirements**: checks for Node.js, ViGEmBus and `vgamepad` and offers to download, safety-check and install what's missing (the window also does this when it opens).
- **Consoles…**: the same window as in Settings.
- **Open emulators folder**.

### Files tab

A tree of the hub folder (`node_modules`, `.git`, `run`, `cores` and `__pycache__` are hidden) and a text editor.

- Click a file to open it. **Ctrl+S** or **Save** writes it, and **Revert** reloads it from disk.
- The title shows **●** while there are unsaved changes, and the window asks before discarding them.
- `.json` files are checked before saving, and the window warns if the JSON is invalid.
- Binary files, or files over 2 MB, are offered to open in their own program instead.
- **New file** creates a file inside the hub folder. **Open externally** opens the selected item in Explorer or the default program.
- Changes to server files take effect after **Restart**.

### Console tab (admin terminal)

| Command | Effect |
| --- | --- |
| `help` | Lists these commands. |
| `start`, `stop`, `restart`, `status` | Same as the Server tab buttons. |
| `apps list` · `apps add-game "Name" "C:\path\game.exe"` · `apps remove ID` | Runs `apps.py` with those arguments and refreshes the Apps tab. |
| `env` | Shows `.env` with passwords, tokens and secrets hidden. |
| `edit FILE` | Opens a file (relative to the hub folder) in the Files tab. |
| `npm ci` | Reinstalls the server dependency. |
| `clear` | Clears the console. |
| anything else | Runs in the system shell (`cmd` on Windows) in the hub folder, with output streamed. **Stop command** ends it. Programs that wait for typed input aren't supported. Use the ↑ and ↓ keys for history. |

### `launch.bat` behaviour

- `launch.bat` with no arguments opens the window.
- `launch.bat --tunnel`, or any other option, runs the console launcher with those options. See the next section.
- `launch.bat --create-shortcut` makes the desktop shortcut, then starts the console launcher.
- If Python or Node.js is missing, it offers to download them from python.org / nodejs.org, checks each download (checksum, signature, Defender scan) and installs it, then continues. If you decline, it says how to install them yourself.

---

## 5. Command-line launcher

`launch.py` (`launch.sh` on macOS and Linux) runs the hub in a terminal. Stop it with **Ctrl+C**, or with `python stop.py` / `./stop.sh` from another terminal.

```bash
python launch.py                          # LAN mode, opens the browser
python launch.py --port 9000              # another port (default: PORT from .env, else 8080)
python launch.py --roms "D:/Games/ROMs"   # main ROM folder (sets ROMS_DIR)
python launch.py --localhost-only         # listen on 127.0.0.1 only
python launch.py --tunnel                 # Cloudflare tunnel (listens on 127.0.0.1 only)
python launch.py --tunnel --lan           # tunnel + keep the Wi-Fi link
python launch.py --access-password CODE   # override ACCESS_PASSWORD for this run
python launch.py --admin-password PASS    # override ADMIN_PASSWORD for this run
python launch.py --no-browser
python launch.py --create-shortcut        # make the desktop shortcut, then start
python launch.py --setup                  # ask the first-run questions again
```

On the first run in a terminal, the launcher asks *Would you like to create a RetroHub desktop shortcut? (Y/n)* (Enter = yes). It isn't asked when nobody can answer (Docker, a service, the window starting it).

`launch-tunnel.sh` is `launch.sh --tunnel`. Settings come from `.env`. Real environment variables take priority over `.env`, and command-line options take priority over both.

Manual start, without the launcher:

```bash
npm ci --omit=dev
node --env-file=.env server.mjs
```

---

## 6. Using the hub

### Accounts

- **Make account**: type a name. The browser creates an **Ed25519 key pair** (TweetNaCl) and keeps it in its own storage. Your account ID is the `#XXXX-XXXX-…` shown in the top bar.
- **Sign-in**: automatic. The server sends a one-time challenge, the browser signs it, and the server checks the signature and sets a 30-day cookie.
- **Export account** downloads a backup file, and **Import backup** on the sign-in page restores it on another device or browser. Clearing browser data without a backup loses the account, and its saves and settings.
- **Switch account** goes to the sign-in page, where 🗑 removes an account from this browser. Accounts that fail their own checks are marked **Damaged**.
- If `ACCESS_PASSWORD` is set, each account is asked for that code once.

### Hosting a game

1. In **Host a game**, choose a mode:
   - **Co-op Netplay**: your browser runs the game and streams it. Friends play in your game and don't need the ROM.
   - **Single-Player Ghost**: everyone runs their own copy side by side. Other players appear as translucent ghosts (P2 cyan, P3 magenta, P4 yellow). Only a CRC32 of each ROM is shared, and the lobby shows **ROM Verified (Match)** or a warning. Everyone starts together on **GO!**
2. Pick the game:
   - **My files**: a ROM on this computer. It never leaves this computer.
   - **Server library**: the owner's library. You need to unlock it first (see [section 7](#7-the-rom-library)).
3. Optionally set a **lobby password** and seat extra **players on this computer** (P2 to P4 with a second keyboard layout or gamepads).
4. Press **Open lobby**, then **Copy invite link**. The link is `/?join=CODE`. The lobby password is never put in the link, so send it separately.
5. When every player is ready, the host starts a 3-2-1 countdown. Everyone loads the core, with a progress bar, and the match begins.

### Joining

- Click a lobby in **Hosting now**, use an invite link, or type a code into **Have a lobby code?**
- Enter the lobby password if it has one, take a seat, and press **Ready**.
- The ping badges next to each lobby estimate the delay through the hub: `<50` green, `<100` amber, `100+` red. Joining a **Co-op** lobby at 150 ms or more shows a warning first (each button press reaches the host that late), and suggests Ghost or Race mode at 250 ms or more.
- If allowed, extra people can join as **spectators**. A lobby holds up to 12 clients, with `MAX_PLAYERS` (2–4) seats.
- A dropped connection keeps its seat for 30 s, so you can reconnect and carry on. **Reloading the page** (or reopening a closed tab with Ctrl+Shift+T within 30 s) puts you back in the same seat; the host keeps a library game. Closing the tab holds the seat for those 30 s too; **Leave** frees it at once.

### In the match

| Feature | How |
| --- | --- |
| Chat | Press **/** to type and **Enter** to send. Messages also pop up over the game. |
| Voice | The mic button. Voices travel over the same WebRTC links. |
| Save states (co-op host) | **💾 Save** or **F2**, **📂 Saves** or **F4** (loads the newest). Saves are copied to every player, so whoever hosts next can continue. Export and import as `.rhsave`. |
| Stream quality (host) | **📶 Stream**: presets (Recommended 6 Mbps 60 fps, High 12 Mbps, Balanced 4 Mbps ≤720p, Data saver 1.5 Mbps 30 fps ≤480p) or custom bitrate, frame rate, resolution, audio quality and codec (Auto, H.264, VP9, AV1, VP8). Changes apply live. Per-player stats show what limits quality (network, host CPU or TURN). |
| Lighter stream (guest) | Each guest can cap their own stream at 3 or 1.2 Mbps without affecting others. |
| Play again (host) | **↻ Play again**: everyone goes back to the lobby with the same game, mode and splits, and readies up again. A game file from a player's own computer is kept in their browser (IndexedDB, up to 768 MB, two minutes) during the reload and comes back; after a plain reload (F5) it has to be picked again. |
| Controls | Keyboard, any standard gamepad, and an on-screen touch controller. **Calibrate controllers** measures lag and stick deadzones. **⌨** lists the shortcuts. |

### Check for Emus

Below the ping legend in **Hosting now**, **Check for Emus** asks the hub which native emulators it can find:

- **✔ green**: the emulator's program was found, so its consoles can be hosted.
- **✖ red**: not found. The emulator's folder is empty, or doesn't have the expected `.exe`.
- **✖ "folder not recognized"**: a folder in `emulators/` that doesn't match any known emulator. Rename it, or register the emulator in the Apps tab.

The summary reads *N of M loaded*, and the owner also sees the emulators folder path. The check runs `apps.py status`, so it needs Python on the hub PC. Any signed-in player can run it.

### Race / speedrun mode

Pick **Race / Speedrun** when hosting (or in the lobby's *Mode*). It is Single-Player Ghost plus a timer: everyone runs their own copy, the 3-2-1 starts every game together, and the **hub** times everyone with one clock (a split is stamped when it reaches the hub, minus half that player's ping, so nobody's PC clock matters).

- **Splits**: the host types split names in the lobby (one per line, up to 40; remembered per game). With none, the run is just a finish time.
- In the game, the timer panel (top right) shows your splits, the difference to your personal best (green ahead, red behind, gold for a best segment) and the standings. **F6** splits (the last split finishes), **F7** undoes, **Forfeit** gives up. The hub posts each finish and a final result in chat.
- **Alone it's a speedrun timer**: personal bests and best segments are kept in this browser per game + console + split names. **Reset** restarts the clock for another attempt (reset your game too).
- **Racing with friends**: they show as ghosts over your game, or press **📺 Pop out everyone** (or drag a player's chip onto the screen) for a picture-in-picture window per player.
- **Leaderboards on speedrun.com**: an offsite link under the timer opens the game's page on speedrun.com (world records, rules, submitting runs). The hub looks the game up through speedrun.com's public API only when you point at the link (or tab to it), sending just the cleaned-up game name; if it finds no match, the link opens speedrun.com's search.
- **LiveSplit**: *PB, LiveSplit & pop-outs* downloads your splits as a `.lss` file, and **Mirror to LiveSplit on this PC** drives LiveSplit through its server (LiveSplit: *Control → Start Server*, WebSocket, default `ws://localhost:16834/livesplit`): start on GO, split, undo, reset. The page may only connect to `localhost` for this.

### RetroAchievements

**🏆 RetroAchievements** in the top bar takes your RetroAchievements username and **Web API key** (retroachievements.org → Settings → Authentication; it can only read). They stay in this browser; the hub passes them to the RetroAchievements Web API (`core/net/retroachievements.mjs`) and stores nothing. In a match the **🏆** button lists the game's achievements, your progress and rarity, and polls every minute: new unlocks pop up and (optionally) go to the lobby chat.

- The game is found by its **ROM hash** (RetroAchievements' rules: copier headers skipped, N64 byte order fixed) for cartridge consoles, else by title. Library games are hashed by the hub (a `.zip` by the ROM inside it; arcade sets by their name, as RetroAchievements does), a file from your computer is hashed in your browser. Disc consoles, DS and PSP match by title (their RetroAchievements hash needs the disc data, e.g. decoding `.chd`).
- **Offsite links**: the panel links to the game's page and your profile on retroachievements.org, and the 🏆 dialog has a sign-up link. Links to other sites are drawn with an **Offsite · site** tag and a dashed border, open in a new tab and send no referrer.
- **Unlocking happens in an emulator with RetroAchievements built in** (RetroArch, PCSX2, Dolphin, DuckStation, PPSSPP, melonDS…) signed in to your account, so native games can earn them. EmulatorJS has no RetroAchievements support: for browser games the panel shows the set and your progress only.
- Game lists (with hashes) are cached a day in `cache/retroachievements/`, badges for good.

### Owner tools

- **Unlock library**: enter `ADMIN_PASSWORD`. The **Library folders** menu opens straight away (see [section 7](#7-the-rom-library)). Accounts listed in `ADMIN_KEYS` are owners automatically.
- **Library folders**: a top-bar button, shown to owners.
- **Hide from the library**: right-click a game (BIOS files, duplicates, bad dumps). Nothing on disk changes; hidden games are saved in `library-hidden.json` (in Docker, where the app folder is read-only: `/cache/library-hidden.json`), nobody else sees them, and **Show hidden** in the library brings them back.
- Shutting down the server from the hub is owner-only.

### Library conveniences (everyone)

- **Favorites**: right-click a game or press **F** on it. Starred games come first in every sort; kept in your browser.
- **Console is remembered**: picking another console for a library game (melonDS for a DS game, VBA-M for GBA) becomes the default for that console's games, with a note saying so. Consoles that can't run the picked game are greyed out under **Console**.
- **What's new**: the first time a browser opens a new version, it shows the changelog since the version it last saw.

### Streamer Mode

For streams where viewers take turns playing. **Co-op Netplay** lobbies only (in Ghost / Race everyone runs their own copy, so it turns off).

- Turn it on in the lobby's **Match** card. From then on everyone who joins lands in the **waiting room**: a spectator getting the normal stream, in line for a seat. Viewers can **Sit out** (watch only) or **Join the line** again; the waiting room shows the order.
- Free guest seats are **offered** in line order ("You're up!", 10 s, chime, notification in a background tab). Take it with the button, Enter or any gamepad button; no answer = marked away and skipped. Seats can't be taken past the line.
- **↻ Rotate seats** (Match card, ↻ in the match top bar, or **Ctrl+Shift+R** while the hub's tab has focus) moves seated viewers to the back of the line; **👑** on a seat keeps that player (winner stays). The **turn timer** (off, 3-30 min) warns 15 s before and only rotates when someone is waiting. The host's own seats on this PC never rotate.
- Per seat (host): **🎮** mutes that player's inputs (held buttons are released), **⤺** sends them back to the waiting room. Seats change hands without reconnecting: only the host's seat-to-player mapping changes, and the old seat's buttons are released.
- **Hide the code, invite link and passwords on my screen** (any player, per browser) blurs the lobby code, passwords, the overlay address and your account ID; copy buttons still work.
- **OBS overlay**: add a Browser Source with `http://localhost:<port>/overlay/queue` (copy it from the Match card). It shows *Now playing* (P1-P4, turn time left) and *Up next* (first 5) on a transparent background and refreshes every 2 s. It answers only to the hub's own computer (not through a tunnel or proxy), so it needs no account; names only. Without `?room=CODE` it shows the Streamer Mode lobby hosted from this PC. `?side=right` and `?scale=1.5` are optional.
- Limits: a lobby holds 12 people (players + waiting room), and the host uploads one stream per viewer. A hotkey that works while a native emulator's window has focus would need a system-wide keyboard hook; that's left out on purpose (it's what keyloggers do, and antivirus flags it). Use the in-game ↻ button or the hub tab's Ctrl+Shift+R.

### Viewer effects (Streamer Mode)

Retro Hub's own take on stream "chaos" effects, for any game and without outside services. Turn on **🎲 Viewer effects** in the Streamer Mode box and untick any effect you don't want.

| Effect | Points | Lasts | Works with |
| --- | --- | --- | --- |
| Invert controls (up/down, left/right, sticks) | 3 | 15 s | all games (native: guests' seats) |
| Swap A / B (and X / Y; N64: A / B) | 2 | 20 s | all games (native: guests' seats) |
| Freeze controls | 4 | 4 s | all games (native: guests' seats) |
| Double speed / Slow motion | 3 / 2 | 15 s | browser games |
| Pause | 3 | 3 s | browser games |
| Rewind 10 s | 5 | instant | browser games (off for save states over 24 MB) |
| Upside down / Mirror / Tiny screen / Invert colors | 2 | 15 s | all games (the hub page's view) |
| Black & white | 1 | 20 s | all games (the hub page's view) |

- **Points**: every player except the host starts with 3, gets 1 every 30 s in the lobby (up to 30). The host's clicks are free (for testing).
- **Limits**: one effect per kind (controls, speed, time, picture) at a time, a cooldown per effect (30-90 s after it ends), and one effect every 8 s per viewer. Effects only fire during a match.
- **How they apply**: the hub announces each effect to everyone. Control effects change the buttons on the host's side before they reach the game (all seats of a browser game; guests' seats of a native game, since players on the host's PC use their pads directly in the emulator). Speed, pause and rewind are EmulatorJS functions on the host's page; for rewind the host's page keeps a save state every 3 s for about 20 s. Picture effects are a CSS filter / transform on every page's game view: guests see them on their stream, and so does a stream captured from the host's screen (not one captured straight from a native emulator's own window).

### Shuffler

A solo mode for "shuffler" challenges: `/shuffle.html` (linked under *Host a game*).

- Pick 2-8 games: files from your computer (they stay there) or, for the owner, games from the server library. Each needs its console (detected from the extension; ambiguous files ask). Consoles can be mixed.
- *Swap after at least / at most* sets the random interval (5-900 s). *Show the countdown* off means surprise swaps. Settings are remembered in the browser.
- While playing: **✓ Beaten** (F8) removes the current game from the pool and moves on; **⤳ Swap** (F9); **⏸ Hold** (F10) pauses swapping (the game keeps running). When one game is left it stays put. When all are beaten the win screen shows the total time, number of swaps and time in each game.
- How it works: each game runs in its own frame (`shuffle-frame.html`, the only page the hub lets itself frame) with its own EmulatorJS core, booted once and paused while it's not its turn. A swap pauses one and resumes another: instant, nothing reloads, no save states. Keys and gamepads are read by the Shuffler page and sent to the game whose turn it is (P1), and released at every swap so nothing stays held. In-game saves (battery saves) are kept by EmulatorJS per game as usual; a shuffle itself can't be resumed after closing the page.
- Memory: every game stays loaded. Small consoles are light; PS1, N64, DS, PSP, Saturn, Sega CD, Jaguar and arcade are heavy (the setup warns from 4 of those).
- **Memory saver** (on by default): with 2+ big consoles only one big game is loaded at a time; when another big game's turn comes, the loaded one is saved (save state) and closed, and the next one boots and restores its save (a few seconds, shown as *Loading…*). Small consoles always stay loaded.

**Shuffle lobbies.** *Host a game* → mode **🔀 Shuffle**: every game you pick (files or library) goes into the shuffle list (2-8, each with its console), plus the swap times and the memory saver. It's a Co-op lobby: the host's page runs the games (the same engine as the Shuffler, `public/shuffler-core.js`) and streams the one that's on; the video track is swapped at each change and the games' sound is mixed into one track, so guests don't reconnect. Guests' controllers drive P2-P4 of whichever game is on (released at each swap). The hub keeps only the list and which game is on, for everyone's title bar and swap banner. The first game waits for GO; ✓ Beaten (F8), ⤳ Swap (F9), ⏸ Hold (F10) are in the host's top bar. Save states (💾) are off in shuffle lobbies, and *Play again* brings back an empty lobby (pick the games again). Streamer Mode and viewer effects work as usual (effects act on the game that's on).

### Guitars and drum kits

Guitar Hero and Rock Band run in the native emulators (PCSX2, Dolphin, RPCS3) on the host's PC; instruments plugged into that PC are set up in the emulator as usual. For friends over the stream, **🎸 Instruments** (☰ menu, a lobby's settings, the Shuffler) teaches the hub a guitar or drum kit: pick **Guitar** or **Drums** and press each part once. The learned layout (per device id, in this browser: `rh-padmaps`) replaces the standard gamepad layout for that device everywhere (lobbies, Shuffler); D-pad "hats" and an analog whammy are handled. Parts are mapped like an Xbox 360 instrument, so on the host's PC the friend's virtual Xbox controller can be mapped to the emulator's guitar / drums: see `emulators/INSTRUMENTS.md`. Have every remote player run the game's audio / video calibration (the stream adds a little delay). Xbox 360 games in Xenia expect real instruments, so remote instruments may not work there.

### Lobby Browser

The **Lobby Browser** tab (next to *Play*) is one table of every lobby: this hub's own, other hubs on your network (LAN beacons) and the master lobby pool when this hub uses one (`MASTER_SERVER_URL`).

- **Search** matches game, host, console and player names; `|` means *or* (`Mario|Zelda`). Filters: console, mode (Co-op / Ghost / Race), at least N players, open seats, no password, not started, friends in it, this hub only. Filters and sort are remembered in the browser.
- Columns sort by clicking (game, console, players, ping, where). Lobbies with your friends in them come first, marked 👥 (see *Friends*). Click a row (or Enter) to see who's in it; player names are shown for this hub's lobbies only (other hubs don't share them).
- **Join** / **Watch** use the normal join dialog. Other hubs' lobbies open that hub (you make an account there). GBA link sessions point to the link panel on *Play*.
- **⏳ Wait for a seat** (full lobbies on this hub, or *Wait for a seat* in the join dialog after a *full* answer): the page retries as soon as the lobby list shows a free seat, using the password you typed, and stops if the lobby closes. **🔔 Alert me** saves the current filters; every lobby that opens later and matches them pops up once (sound, and a system notification while the tab is in the background if allowed). Both run while the page is open, in any tab. The server sends player names in the lobby list (`names`) for this.

### Friends

**👥 Friends** (top bar) adds friends by account ID: the *#XXXX-XXXX-XXXX-XXXX* shown next to each name (top bar, player cards, chat). In a lobby, **＋ Friend** on a player does the same.

- **Mutual only**: the hub shows two people to each other only when both have added each other. Then you see them online, in which lobby (game, host, 🔒 when it has a password) or playing; **Join** opens the normal join dialog, and from your own lobby **Invite** pops up a Join button on their screen.
- **Added you**: someone online who added you (but you haven't added back) shows with **Add back** / **Ignore**.
- **Appear offline** hides you from everyone (no presence, no requests, no invites).
- **Privacy**: lists live in each browser, per account (export the account to move it; the list stays in that browser). The page sends the list over its own socket ({t:"friends"}); the hub keeps it in memory only while that page is open and stores nothing. Invites: friends only, 6 a minute, once per 20 s per friend.
- Same hub only: friends on other hubs don't show.

### Co-op ROM hacks

Hacks that put 2-4 players into one N64 game, played in **Project64** on the hub's PC and streamed to friends like any native game.

- Pick the base ROM from the server library in **Host a game**. If `core/coop-hacks.json` knows it, the host form says **✓ Recognized** and offers **🤝 Patch for co-op: <hack>**. A close-but-wrong ROM (a retail OoT for a Debug ROM hack, the PAL Debug ROM, an already-patched build) gets a note instead.
- The patch file is found by SHA-256 next to the ROM, in the console folder up to 3 levels (e.g. `N64/Patches/...`) or in `patches/` in the hub folder; **add the file…** in the host form saves it there (only files whose checksum is in the list). Nothing is downloaded.
- When the game starts, the server writes the patched copy to `cache/coop/` (reused next time), writes the hack's required cheats to `emulators/project64/.../Config/Cheats-User/Retro Hub co-op <id>.cht` with `On By Default=1`, and launches Project64 with the copy.
- `ports` in the list sends each online seat to the controller the hack reads (`null` = not used). Map controllers 2-4 in Project64 (Options > Configure Controller Plugin, Plugged in) to the hub's virtual controllers.
- Formats: IPS, BPS (source/target checksums checked), UPS, PPF 1/2/3. Code: `core/library/romhack.mjs`, `GET /api/coop`, `POST /api/coop/patch-file`, `coop` in `POST /api/native/launch` (owner, from the hub's PC).

### Off Site Games

The **Off Site Games** tab (next to **Play**) lists games that run on other websites, by category, with search. They open in a new tab with no referrer, marked *Offsite*; lobbies, netplay, saves and achievements don't apply, and Retro Hub doesn't host or check them.

- The default list is `core/offsite-games.json`: free or open-source games, and ports that use your own game files.
- **Your own list**: copy that file to `offsite-games.json` in the hub's main folder and edit it. It replaces the default, is kept by the updater, and isn't shipped. Each game: `name`, `url` (`https://` only; anything else is dropped), `category`, optional `note`, and `"touch": true` for games that work on phones and tablets (they get a *Phone / tablet friendly* filter).
- Mind what you link to: a list of unofficial copies of commercial games, or sites with heavy ads, reflects on your hub.

---

## 7. The ROM library

### Main ROM folder

`ROMS_DIR` (default `./roms`, or `/roms` in Docker) is scanned recursively, up to 5 levels deep. The scan runs in the background (the first one at startup, folders read in parallel), so the hub never freezes while it works; the list is rescanned when it's over 30 seconds old, and the library tab shows *Scanning the library… N games found so far* during the first scan. Each file's console is found in this order:

1. **Folder name**: the nearest parent folder whose name matches a console's folder list. Case, spaces, `_`, `.` and `-` are ignored.
2. **Extension**: when it belongs to only one console.

Generic extensions (`zip 7z bin iso img`) and disc sheets (`cue ccd m3u`) need a console folder. Folders named `bios`, `covers`, `boxart`, `media` and hidden folders are skipped.

### What counts as a game (scanner rules)

The library shows one entry per game, never the pieces a game is made of (`core/library/rules.mjs`):

| Rule | Shown | Hidden |
| --- | --- | --- |
| Disc images (PS1, Saturn, Sega CD, PC Engine CD, PS2, Dreamcast…) | the `.cue`, `.ccd`, `.gdi` or `.m3u`, or a standalone `.chd` / `.pbp` / `.iso` | every file the sheet names (`.bin` `.img` `.sub` `.wav` `.ogg` `.mp3` `.raw` `.iso`…), plus files named like the sheet with a track number |
| Multi-disc games | the `.m3u` | the discs it lists (`.cue` / `.chd` / `.ccd`) |
| Wii U extracted to a folder | one game per folder with `code/*.rpx`, named from `meta/meta.xml` (`shortname_en`) or the folder (without `[Game] [id]`); Cemu runs the `.rpx` from `code/cos.xml` | everything in `code/` `content/` `meta/`; `[Update]` / `[DLC]` folders and files (title ids `0005000E…` / `0005000C…`) |
| Wii U files | `.wua`, `.wux`, `.wud` | `.zip` / `.7z` (Cemu can't open archives) |
| Switch | base games | updates and DLC (by title id: `…800` = update, other low digits = DLC) |
| 3DS | `.3ds`, `.cci`, `.cxi`, `.cia` | a `.cia` next to a `.3ds` / `.cci` of the same game |
| BIOS and system files | | `scph*.bin`, `bios*`, `gba_bios.bin`, `disksys.rom`, `syscard*.pce`, `neogeo.zip`, `pgm.zip` and other arcade BIOS sets |
| Archives | one entry per `.zip` / `.7z` (never opened and listed file by file) for browser consoles and arcade | archives in consoles whose emulator can't open them (most native emulators) |

**Disc games in the browser**: EmulatorJS needs every file of a disc at once, so the hub sends a `.cue` / `.gdi` / `.m3u` game as one zip, built while it is sent (stored, not compressed, CRCs worked out on the way and cached). EmulatorJS unpacks it and boots the sheet. The size shown in the library is the whole game's. A single zip can't be over 4 GB.

| Console | Folder names | Extensions |
| --- | --- | --- |
| Nintendo 64 | `n64`, `nintendo64` | z64 n64 v64 |
| NES | `nes`, `famicom` | nes fds unf unif |
| SNES | `snes`, `supernintendo`, `superfamicom`, `sfc` | sfc smc fig swc |
| Game Boy | `gb`, `gameboy`, `dmg` | gb dmg |
| Game Boy Color | `gbc`, `gameboycolor`, `cgb` | gbc cgb |
| Game Boy Advance | `gba`, `gameboyadvance` | gba |
| Nintendo DS | `nds`, `nintendods` | nds dsi |
| PlayStation | `psx`, `ps1`, `playstation`, `playstation1`, `psone` | chd cue ccd m3u pbp ecm |
| Genesis / Mega Drive | `genesis`, `megadrive`, `md`, `segamd` | md gen smd |
| Master System / Game Gear | `sms`, `mastersystem` / `gg`, `gamegear` | sms sg / gg |
| Sega CD / 32X / Saturn | `segacd`, `megacd` / `32x`, `sega32x` / `saturn`, `segasaturn` | chd cue ccd m3u / 32x / chd cue ccd m3u |
| Atari 2600 / 7800 / Lynx / Jaguar | `atari2600` / `atari7800` / `lynx` / `jaguar` | a26 / a78 / lnx / j64 jag |
| PC Engine / TG-16 | `pce`, `pcengine`, `tg16`, `turbografx`, `turbografx16` | pce chd cue ccd m3u |
| Neo Geo Pocket / WonderSwan / Virtual Boy / ColecoVision | `ngp`, `ngpc` / `wonderswan`, `wsc` / `virtualboy`, `vb` / `coleco` | ngp ngc / ws wsc / vb vboy / col |
| Arcade (FBNeo) | `arcade`, `fbneo`, `fba`, `neogeo` | (zip) |
| PSP | `psp` | cso pbp chd |
| Native consoles | see [section 8](#8-native-emulators-and-pc-games) | |

Every console also takes `zip`, `7z`, `bin`, `iso` and `img` from its own folder. Game Boy and Game Boy Color are separate consoles, each with its own folder; a `.gbc` in the Game Boy folder is listed as Game Boy Color unless that console has a folder of its own.

**Cover art** is optional: an image with the same name as the ROM (`Game (USA).png` for `Game (USA).sfc`), next to it or in a `covers/`, `boxart/` or `media/` subfolder. PNG, JPEG and WebP work. Without one, the tile shows the console and the game's initials.

### Library folders (per console)

Your games don't have to be in one tree. After **Unlock library**, or from **Library folders** in the top bar, the owner sees **every console** with its current source:

- `default: snes/, supernintendo/, …`: the console's sub-folders inside the main ROM folder.
- A full path, shown in green, after you picked one with **Browse…**.

**Browse…** opens a folder picker served by the hub. It starts with your drives, the main ROM folder and your home folder, and lists folders only, never files. Click into folders, use **⬑ Up**, then **Use this folder**. **Clear** goes back to the default.

How it works:

- Choices are saved in `library-folders.json` in the hub folder, as `{ "snes": "D:\\Games\\SNES", … }`. They take effect immediately, with no restart.
- Every file in a console folder, at any depth up to 5, whose extension fits that console or is ambiguous (`zip`, `iso`, `bin`…) is listed as that console. The folder name doesn't matter.
- Library paths for these games look like `@snes/sub/Game.sfc`. The server resolves `@<console>/…` against that console's folder and refuses anything that would leave it (`..` tricks return 404).
- A console folder inside the main ROM folder is fine: each file is listed once.
- **Changing** folders only works for the owner **in a browser on the hub's own computer**, not through a tunnel or from another device, because it browses that PC's disks. Owners elsewhere can see the menu, but its buttons are disabled.
- Not available in Docker. Mount volumes into `/roms/<console>` instead.

### Cover art

Besides covers next to the ROM (above, always used first), the owner can:

- **Auto covers**: in the library, *Covers: auto (libretro)* fetches box art from the libretro-thumbnails project (`thumbnails.libretro.com`, the set RetroArch uses) in the background, matched by file name: exact No-Intro names in one request, others by title against that console's list (USA / World / Europe preferred). Saved in `cache/covers/<console>/`; misses are retried after a day. Off by default.
- **Your own cover**: right-click a game → *Set cover from an image file…*, or drop a PNG / JPEG / WebP onto it. It replaces the auto cover; *Remove my cover* undoes it.
- **TheCoverProject**: right-click → *Find a cover on TheCoverProject* opens its search for that game. The site sits behind a browser check that automated tools must not get around, so the hub doesn't download from it; save the scan and drop it on the game. Wrap-around scans (back, spine, front) show their front half.

### Who can use the library

The library, its ROM downloads and its covers are owner-only by default. `LIBRARY_ACCESS=all` shares it with every signed-in account. The server adds an account prefix to each library file name, so EmulatorJS keeps separate in-game saves per account.

---

## 8. Native emulators and PC games

### Setup

1. **Drop a portable build** of each emulator into its folder. The program is found in the folder itself or one sub-folder down, so an unzipped release works as-is.

   | Folder | Emulator | Consoles | Library folder |
   | --- | --- | --- | --- |
   | `emulators/pcsx2/` | PCSX2 | PlayStation 2 | `roms/ps2/` |
   | `emulators/dolphin/` | Dolphin | GameCube, Wii | `roms/gamecube/`, `roms/wii/` |
   | `emulators/rpcs3/` | RPCS3 | PlayStation 3 | `roms/ps3/<Game>/PS3_GAME/USRDIR/EBOOT.BIN` |
   | `emulators/xenia/` | Xenia / Canary | Xbox 360 | `roms/xbox360/` |
   | `emulators/cemu/` | Cemu | Wii U | `roms/wiiu/` |
   | `emulators/ryujinx/` | Ryujinx | Switch | `roms/switch/` |
   | `emulators/eden/` (`citron/`, `sudachi/`) | Eden / Citron / Sudachi | Switch | `roms/switch/` |
   | `emulators/xemu/` | xemu | Xbox | `roms/xbox/` |
   | `emulators/azahar/` (`lime3ds/`, `citra/`) | Azahar | 3DS | `roms/3ds/` |
   | `emulators/flycast/` | Flycast | Dreamcast | `roms/dreamcast/` |

   Or use per-console **Library folders** instead of `roms/<console>/`.
2. **Set each emulator up once**, in the emulator itself: BIOS, firmware and keys (you supply these), graphics settings, **windowed mode** (fullscreen windows can't be captured reliably), and controller ports. Port 1 is your own controller. Ports 2–4 are guest seats (see below).
3. Press **Check for Emus** in the hub, or open the window's Apps tab, and confirm a green ✔.
4. As the owner, in a browser on the hub PC, pick the game from the server library and open a lobby. When the match starts, the hub launches the emulator. Press **Share the emulator window** and pick its window. For game sound, share the whole screen and tick **Share system audio** (Chrome and Edge on Windows), because a window share carries video only.

Other emulators, or emulators installed elsewhere, can be registered in the Apps tab or with `python apps.py add-emulator ID EXE --systems switch[,…] [--label L] [--args "-f {game}"] [--new-system id:Label:ext1,ext2:folder]`. PC games are added with `python apps.py add-game "Name" "C:\path\game.exe" [-- args]` and appear in the library under **PC games**. Registrations go to `emulators/apps.json`. Built-in definitions are in `core/runner/catalog.json`; don't edit that file, add your own instead. A newly added *console* needs a hub restart. New games and emulators don't.

### What happens when a native game is hosted

1. The browser calls `POST /api/native/launch` with the library path. The server only accepts this from the **owner on the hub PC**, with the `X-Retro-Hub: native` header, and only for games that are in the library.
2. The server runs `python apps.py run --app <emulator> --game <full path> --job <name>`. The runner creates a **Windows Job Object** (kill-on-close), adds itself to it, then starts the emulator with an argument list (no shell). Only `.exe` files are started. Everything the emulator spawns stays in the job.
3. The host's browser captures the window with `getDisplayMedia` and passes the track to the normal netplay pipeline, so guests get the same stream, quality controls, codecs, stats and voice.
4. Guest controller state reaches the host's browser over the data channel. The browser forwards it on a loopback-only WebSocket, `/native-input` (owner on the hub PC, same origin). `input_bridge.py` turns it into input:
   - **gamepad** mode: one virtual Xbox 360 controller per online seat (P2, P3, P4 in order). This needs `pip install -r requirements-native.txt` (Windows: `vgamepad` + the ViGEmBus driver; Linux: `evdev` with write access to `/dev/uinput`).
   - **keyboard** mode (Windows, nothing to install): each seat gets its own keys ([`emulators/KEYBOARD.md`](emulators/KEYBOARD.md)), sent with `SendInput` **only while a window inside the emulator's job has focus**. Sticks become 8-way digital.
   - `NATIVE_INPUT=auto` (the default) uses gamepads when possible and keys otherwise.
5. On stop, the runner sends `WM_CLOSE` to the job's windows so emulators save, waits up to 5 s, then ends whatever is left.

Limits: co-op only (no ghost mode); only the owner, on the hub PC, can host native games; no native emulators in Docker.

---

### Headless: play the native game in the page

**Play in this page** (under the hosting steps, on by default) keeps the emulator's window just off the right edge of the desktop instead of as a second window on screen (`apps.py run --headless`). You still pick it once with **Share the window** (the browser requires that click); after that it plays in the page, and Chrome / Edge keep the focus on the page.

- Your keyboard drives your seat through a virtual controller (map it once in the emulator's controller settings); a gamepad on this PC works in the emulator directly. Some emulators need *background input* turned on for that (Dolphin).
- **🪟 Emulator window** in the top bar brings the real window back (for its menus, or VBA-M's *Start Network Link*) and sends it off-screen again. Windows go back on screen before the emulator is closed, so it never saves an off-screen position.
- Needs Windows and virtual gamepads (ViGEmBus + `vgamepad`, see `requirements-native.txt`): in keyboard mode guests' keys only reach a focused window, so the emulator opens normally. If the picture stays black, use **🪟 Emulator window** and turn headless off for that emulator.

### GBA and Game Boy link cable (VBA-M)

Link play runs in **VBA-M**, never in EmulatorJS (its GBA and GB cores can't link). Everyone runs their own Retro Hub and ROM on the same network; see the **GBA / Game Boy link cable** panel. When you pick a GBA, GB or GBC game from the library and VBA-M is installed, **Play in → VBA-M link cable** hosts a link session straight from *Host a game* (remembered; games in VBA-M's own folders default to it). GB / GBC link depends on your VBA-M version's network link support.

## 9. Playing over the internet

Friends need only a browser and your link. You need a public HTTPS address.

### Quick tunnel (free, no account)

1. Install `cloudflared` (see [Requirements](#2-requirements)).
2. In the window choose **Internet (Cloudflare Tunnel)** and press **Start**. Or run `launch.bat --tunnel` / `./launch-tunnel.sh`.
3. The launcher waits for `cloudflared` to report a connection and reads the `https://<random>.trycloudflare.com` address. It passes that address to the server as `PUBLIC_URL`, so invite links use it.
   Your own browser still opens the hub on `http://localhost:<port>` (native emulators and Library folders only work from the hub PC's own address). The window shows both addresses, and **Copy link** copies the public one.
4. Copy the invite link into Discord and send the lobby password separately.

The quick address changes on every start, and Cloudflare gives no uptime guarantee for quick tunnels.

### Your own domain (named tunnel)

1. In Cloudflare **Zero Trust → Networks → Tunnels**, create a tunnel and add a public hostname (for example `play.example.com`) pointing to `http://localhost:8080` (or `http://retro-hub:8080` with Docker Compose).
2. In `.env` (or the Settings tab), set `TUNNEL_TOKEN`, `PUBLIC_URL=https://play.example.com` and, recommended, `ACCESS_PASSWORD`. Add `TRUST_PROXY=1` with Docker Compose only.
3. Start with the tunnel option. The token is passed to `cloudflared` through its environment, never on the command line.

### Good to know

- In tunnel mode the hub listens on `127.0.0.1`, and `cloudflared` is the only way in, so client IPs from forwarding headers can be trusted.
- HTTPS enables cross-origin isolation, which allows the faster **multi-threaded** cores. Plain-HTTP LAN addresses use single-threaded cores.
- Without `ACCESS_PASSWORD`, anyone with the address can make an account and see who is hosting. They still can't join password lobbies or see your library.
- If a guest sees *Couldn't connect to the host directly*, their network blocks direct WebRTC. Set up a TURN server (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`).
- Other reverse proxies (Caddy, Nginx Proxy Manager, SWAG) work too. Forward WebSockets on `/ws`, set `PUBLIC_URL`, and set `TRUST_PROXY=1` if the proxy is on another machine or container.

---

## 10. Docker and NAS

The image contains the server, `core/` and `public/` only. It has no Python, launcher window or native emulators.

```bash
# published image
docker run -d --name retro-hub -p 8080:8080 \
  -e ADMIN_PASSWORD=<long-password> \
  -v /path/to/roms:/roms:ro -v retro-hub-cache:/cache \
  --restart unless-stopped ghcr.io/<github-user>/<repo>:latest

# or build with Compose: copy .env.example to .env, set ADMIN_PASSWORD, point the roms volume at your ROMs
docker compose up -d --build
docker compose --profile tunnel up -d --build    # + Cloudflare named tunnel (TUNNEL_TOKEN, PUBLIC_URL, TRUST_PROXY=1)
```

The container runs as the `node` user with `ROMS_DIR=/roms` and `CORES_CACHE=/cache/cores`. Keep `/cache` on a volume so cores and `session.key` survive updates. **Unraid**: use the Compose Manager plugin with the paths noted in `docker-compose.yml`, or add the `ghcr.io` image as a container. A GitHub Actions workflow (`.github/workflows/docker.yml`) builds amd64 and arm64 images on `v*` tags.

---

## 11. Configuration reference

Settings are environment variables, usually from `.env`. Edit them in the window's Settings tab, or see `.env.example`. **Restart the hub after changes.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | random on first launch | Owner password for **Unlock library**. 8+ characters; placeholders like `change-me` are ignored. |
| `ADMIN_KEYS` | – | Comma-separated account IDs that are owners automatically. |
| `ACCESS_PASSWORD` | – (open) | Server-wide code, asked once per account. Recommended on the internet. |
| `LIBRARY_ACCESS` | `admin` | `all` shares the server library with every account. |
| `PORT` | `8080` | HTTP port. |
| `HOST` | `0.0.0.0` | Listen address. The launcher sets `127.0.0.1` for localhost-only and tunnel modes. |
| `MAX_PLAYERS` | `4` | Seats per lobby, clamped to 2–4. |
| `ROMS_DIR` | `./roms` (`/roms` in Docker) | Main ROM library. |
| `CORES_CACHE` | `./cache/cores` | Downloaded EmulatorJS cores. `session.key` sits next to it. |
| `SESSION_SECRET` | random `session.key` | Cookie signing key. Changing it signs everyone out. |
| `EMULATORS_DIR` | `./emulators` | Native emulator builds and `apps.json`. |
| `NATIVE_INPUT` | `auto` | `auto`, `gamepad` or `keyboard` for guest input in native games. |
| `NATIVE_PYTHON` | the launcher's Python (`RH_PYTHON`) | Python used for `apps.py` and `input_bridge.py`. |
| `PUBLIC_URL` | – | Public origin for invite links. Set automatically for quick tunnels. |
| `TUNNEL_TOKEN` | – | Cloudflare named-tunnel token. Requires `PUBLIC_URL`. |
| `TRUST_PROXY` | off | `1` trusts `X-Forwarded-For` / `CF-Connecting-IP` from a proxy on **another** machine. A local proxy is trusted automatically. |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | Comma-separated STUN servers. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | – | Optional TURN relay. |
| `UPDATE_CHECK` | `on` | `off` = the window doesn't look for a new release when it opens. |
| `UPDATE_REPO` | `ZephyrianYT/Universal-Multiplayer-JS-Emu` | GitHub `owner/repo` that updates come from. |
| `RETROHUB_DESKTOP` | the user's Desktop | Folder for the desktop shortcut. |

`EMULATORS_DIR`: a configured folder that is missing or empty falls back to this install's `./emulators` (with a warning), so a `.env` copied from an older Retro Hub folder doesn't hide your emulators.

Other state, not set through environment variables: `library-folders.json` (per-console folders, set in the hub), `library-hidden.json` (games the owner hid), `emulators/apps.json` (your emulators, PC games and the emulator chosen per console, set in the Apps tab, Consoles… or with `apps.py`), `.retrohub-config.json` (first-run answers) and `cache/installed-release.json` (the release the updater installed).

---

## 12. Security model

| Area | Design |
| --- | --- |
| Accounts | Ed25519 keys in the browser. Sign-in signs `retro-hub-login\n<nonce>`. Nonces are single-use and expire after 2 minutes. No passwords or account data are stored on the server. |
| Sessions | `hub` cookie: base64url JSON `{name, role, id, expiry}` + HMAC-SHA256 with the server secret. `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, 30 days. |
| Brute force | 10 failed access-code, owner-password or lobby-password attempts from one IP lock that IP out for 15 minutes. Secrets are compared in constant time. |
| Library | ROMs, covers and the library list are owner-only unless `LIBRARY_ACCESS=all`. Paths are normalized and must stay inside their base folder. |
| Owner-on-this-PC actions | Native launch/stop, `/native-input`, library folder changes and the folder picker need **all** of: owner session, a loopback connection with no forwarding headers (so not through a tunnel or proxy), and a custom `X-Retro-Hub` header (blocks cross-site requests). |
| Shutdown | `POST /api/shutdown` works for (a) loopback requests with the random token from `run/retro-hub.json` (file mode 600), or (b) an owner session with `X-Retro-Hub: shutdown`. |
| Browser hardening | Strict CSP (own origin only, no inline scripts; `unsafe-eval` only for EmulatorJS's 7-Zip worker), COOP/COEP/CORP, `X-Frame-Options: DENY`, `nosniff`, a tight `Permissions-Policy`. |
| WebSocket | Session cookie required. 64 KB max message, 200 messages/s flood limit, chat limited to 6 messages per 8 s. |
| Native runner | Argument lists, no shell. Only `.exe` files from the registry or catalog. Job Object containment. Keyboard input goes only into the contained windows. |
| Launcher | The tunnel token goes to `cloudflared` through its environment. The Console tab hides secrets in `env` output. |
| Updates | GitHub only (HTTPS, host checked after redirects), SHA-256 against GitHub's published checksum, Defender scan, zip checked for unsafe paths, user files never overwritten, replaced files backed up. |
| Offsite links | speedrun.com and retroachievements.org links open in a new tab with `noopener noreferrer`, so the hub's address isn't passed on. The page itself still talks only to the hub (the speedrun.com lookup goes through the hub, only when you point at the link). |

---

## 13. Internals: API, WebSocket protocol, WebRTC

### HTTP API

| Method & path | Who | Purpose |
| --- | --- | --- |
| `GET /api/challenge` | anyone | `{ nonce, accessCode }` for sign-in. |
| `POST /api/hello` | anyone | `{ name, pub, nonce, sig, access? }` → sets the session cookie. |
| `POST /api/unlock` | signed in | `{ password }` → owner session. |
| `POST /api/logout` | anyone | Clears the cookie. |
| `GET /api/me` | signed in | Name, role, ID, library access, version, `canUnlock`. |
| `GET /api/config` | signed in | ICE servers, max players, public URL, console list, detection tables. |
| `GET /api/library` | library access | The game list `[{ path, name, ext, system, size, cover, native?, hidden? }]` (`hidden` games only for the owner). Waits for the first scan. |
| `GET /api/library/status` | library access | `{ ready, scanning, found, seconds, games }` for the scan progress line. |
| `POST /api/library/hide` | owner + `X-Retro-Hub: library` | `{ path \| paths, hidden }` hides or unhides games. |
| `GET /roms/<path>`, `GET /covers/<path>` | library access | ROM and cover files. Supports HTTP range requests. A `.cue` / `.ccd` / `.gdi` / `.m3u` with other files is sent as one stored zip. |
| `GET /api/whatsnew?since=1.20.0` | signed in | The changelog sections newer than that version, as simple HTML. |
| `GET /api/speedrun?name=` | signed in | `{ url, title, search }`: the game's page on speedrun.com (public API, cached a day). |
| `GET /data/cores/<file>` | signed in | Cores: bundled, then cached, then fetched from `cdn.emulatorjs.org/4.2.3`. |
| `GET /api/emulators` | signed in | Check for Emus: `{ ok, error, emulators:[{id,label,installed,custom,unknown,systems}], folder? }`. |
| `GET /api/library/folders` | owner | `{ canEdit, romsDir, systems:[{id,label,native,dir,defaultDirs}] }`. |
| `POST /api/library/folders` | owner on hub PC + `X-Retro-Hub: library` | `{ system, dir \| null }` sets or clears a console folder. |
| `GET /api/fs/dirs?dir=` | owner on hub PC | `{ dir, parent, dirs:[{name,path}] }`. An empty `dir` returns the drives and places to start from. |
| `GET /api/native` | signed in | Native status for the owner on the hub PC, otherwise `{ available:false, reason }`. |
| `POST /api/native/launch`, `/api/native/stop` | owner on hub PC + `X-Retro-Hub: native` | Start or stop a native game. `launch` takes `{ path, system?, headless? }`: `system` is the console picked when hosting; any native console that takes the file's type can run it. |
| `POST /api/shutdown` | token or owner | Graceful shutdown: players are told, then the process exits. |

### WebSocket `/ws`

JSON messages with a `t` field.

- **Client → server**: `ping`, `lobby` (subscribe to the lobby list), `join` (`room`, `role`, `password`, `local` seats, `mode`, `game`, `system`), `signal` (relay to a peer), `ready`, `rom` (CRC32 in ghost mode), `ghost`, `rules`, `start`, `abort`, `progress`, `slot`, `swap`, `spectate`, `voice`, `chat`, `savestate`, `race`, `rematch` (host: back to the lobby), `leave`, `handoff`.
- **Server → client**: `pong`, `rooms`, `joined`, `roster`, `phase`, `countdown`, `signal`, `chat`, `chat-history`, `notice`, `error` (with `code`: `password`, `full`, `no-room`, `host-taken`, `limited`…), `promoted`, `rematch`, `shutdown`.

**Room lifecycle:** `lobby` → `countdown` (3 s, timed by the server) → `loading` (per-player progress; start waits for 100 %) → `playing`. If the host leaves, the next player is **promoted** and the match returns to the lobby. Changing the game or rules clears everyone's ready flag. A dropped socket keeps its seat, ID, ready flag and ROM for 30 s.

### WebRTC

- One `RTCPeerConnection` per guest, and the host always makes the offers. ICE comes from `/api/config` (STUN, plus optional TURN).
- Media: the game's video track (codec preference applied, with fallback to what both sides support), stereo Opus game audio, and voice transceivers relayed by the host.
- Data channels:
  - `input`: unordered, `maxRetransmits: 0`. The guest sends its whole controller state each time, so the newest packet always wins.
  - `ctl`: reliable and ordered (quality caps, voice and ghost maps, stats).
  - `state`: reliable, host → guest (save states).
- Controller frames use RetroPad numbering: 24 values (16 buttons and 8 stick half-axes, 0–32767). Native bridge frames are `[u8 slot][u8 version=1][24 × u16 LE]`.

---

## 14. Files and folders

| Path | In the zip? | What it is |
| --- | --- | --- |
| `launch.bat` | yes | Windows entry point (opens the window). |
| `RetroHub.pyw` | yes | Launcher and admin window. |
| `launch.py`, `launch.sh`, `launch-tunnel.sh` | yes | Console launcher. |
| `stop.py`, `stop.sh` | yes | Stop a running hub. |
| `apps.py` | yes | Native app registry and runner. |
| `server.mjs`, `package.json`, `package-lock.json` | yes | Server. |
| `public/` | yes | Web client. `public/data` is EmulatorJS 4.2.3, `public/vendor` is TweetNaCl. |
| `core/runner/catalog.json` | yes | Built-in native consoles and emulators. |
| `core/browser-systems.json` | yes | Browser (EmulatorJS) consoles: names, file types, folder names. |
| `core/library/rules.mjs` | yes | Scanner rules: what counts as a game; the disc zip for the browser. |
| `core/net/` | yes | LAN discovery, link cable, RetroAchievements, cover art. |
| `assets/icon/` | yes | The mascot icon: `retrohub.svg` (source), `.png` sizes, `.ico`, `.icns`, and `make_icon.py` that builds them (needs Pillow; only to change the icon). |
| `setup/deps.ps1` | yes | Windows: finds, downloads, safety-checks and installs Python, Node.js and controller support. |
| `setup/update.py` | yes | The updater. |
| `setup/shortcut.py` | yes | The desktop shortcut. |
| `core/streaming/native.mjs`, `input_bridge.py` | yes | Native game support. |
| `emulators/<id>/` | empty | Put portable emulator builds here. `README.md` and `KEYBOARD.md` explain the setup. |
| `roms/` | empty | The default main library. |
| `requirements-native.txt` | yes | Optional virtual-gamepad packages. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/` | yes | Docker build and publishing. |
| `.env.example` | yes | Every setting, documented. |
| `.env` | created | Your settings and secrets. |
| `node_modules/` | created | `ws`, installed on first start. |
| `cache/cores/`, `cache/session.key` | created | Core cache and cookie key. |
| `run/retro-hub.json` | created | PID, port and shutdown token while running. |
| `library-folders.json` | created | Per-console library folders. |
| `library-hidden.json` | created | Games the owner hid. |
| `emulators/apps.json` | created | Your emulators, PC games and the emulator picked per console. |
| `.retrohub-config.json` | created | First-run answers (desktop shortcut). |
| `cache/installed-release.json` | created | The release the updater installed. |
| `backup/` | created | Files the updater replaced. |

Back up `.env`, `library-folders.json`, `library-hidden.json` and `emulators/apps.json` when moving the hub to another PC. Players should keep their own account backups (**Export account**).

---

## 15. Troubleshooting

| Problem | Fix |
| --- | --- |
| `launch.bat` says Python wasn't found | Install Python 3.8+ from python.org with **Add python.exe to PATH** ticked. A `python` that opens the Microsoft Store is only a shortcut. Turn it off under *Settings → Apps → Advanced app settings → App execution aliases* if it gets in the way. |
| `launch.bat` opens a console instead of the window | That Python has no tkinter. Reinstall from python.org (tcl/tk is included) or use the console launcher. |
| Window shows "Node.js was not found" | Install Node.js 18+ LTS and reopen the window, because a new PATH needs a new process. |
| "Port 8080 is already in use" | Another hub or program is using it. Stop it, or set another port in Settings (or `launch.bat --port 9000`). |
| "npm ci failed" | First start needs internet. Then run `npm ci` in the Console tab. |
| Stuck on "Download Game Core" | The hub PC needs internet the first time each console is played. Cores are then cached in `cache/cores`. |
| Check for Emus shows ✖ for an emulator you installed | Its program must be in `emulators/<folder>/` or one level below, with one of the expected names (see `emulators/README.md`). Otherwise register it in the Apps tab. If everything is ✖ with "Python wasn't found", set `NATIVE_PYTHON` or start the hub from the window. |
| Library folders buttons are disabled | Open the hub in a browser **on the hub PC** at `http://localhost:<port>`, not through the tunnel or another device. |
| A game in a console folder doesn't show up | Its extension must belong to that console or be generic (`zip`, `7z`, `bin`, `iso`, `img`); see [what counts as a game](#what-counts-as-a-game-scanner-rules). Tracks of a `.cue` and the discs of an `.m3u` are hidden on purpose. It must be at most 5 folders deep, and not hidden (**Show hidden**). The list refreshes within 30 s. |
| Emulators show ✖ after updating to a new folder | A `.env` from the old folder points `EMULATORS_DIR` there. The window's setup warning has **Use this install's emulators folder**. |
| The desktop shortcut doesn't open anything | The hub folder was moved or renamed. **Settings → Desktop shortcut** makes it again. |
| A disc game takes long to start the first time | The hub reads the disc twice the first time (once for the zip's checksums). Later starts are quicker. |
| Guest sees "Couldn't connect to the host directly" | Configure TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`). |
| Picture stutters or looks blocky | Open **📶 Stream**. For *limited by network*, use Balanced or Data saver, or have that guest pick a lighter stream. For *limited by host CPU*, try 30 fps, 720p or H.264. |
| No sound for a guest | Browsers block sound until a click. Press **Turn sound on**. |
| Native game: no sound for guests | Share the whole screen with **Share system audio** instead of a window. |
| "Server library" tab missing | Press **Unlock library** and enter the owner password (Settings tab → Show). |
| An account won't sign in | **Switch account**, remove the damaged account (🗑) and import its backup. |
| The hub stopped when I closed the window | That's by design. Use `launch.bat --tunnel`, `launch.py` or Docker to run it without the window. |

---

## 16. Legal and license

Retro Hub contains **no games, BIOS files, firmware or keys**. Only play games you own and dump your own system files. ROMs never leave the owner's server or the host's computer.

GPL-3.0. See [LICENSE](LICENSE). Bundles [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (GPL-3.0) in `public/data` and [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) 1.0.3 (public domain) in `public/vendor`. Emulator cores and native emulators are licensed by their own authors.

Release notes: [CHANGELOG.md](CHANGELOG.md).
