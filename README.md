# Retro Hub

Retro Hub is a self-hosted game hub for playing retro and modern console games with friends. One person (the **owner**) runs the hub on their PC or home server. Friends open a link in their browser, make an account with one click, and join a lobby.

- **Browser consoles** (NES through PS1, N64, GBA, DS, PSP and more) run inside the host's browser with [EmulatorJS](https://emulatorjs.org). The host streams video and audio to the guests over WebRTC, and the guests send back only their controller input.
- **Native consoles** (PS2, GameCube, Wii, PS3, Xbox, Xbox 360, Wii U, Switch, 3DS, Dreamcast) and **PC games** run in real desktop emulators on the owner's PC. The browser captures that window and streams it the same way.
- **Nothing is uploaded.** ROMs stay on the owner's disk or on the player's own computer. Accounts are keys kept in each browser, so the server has no account database.

This document covers installing the hub, using it day to day, and how it works inside.

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

---

## 3. Installing (fresh install)

1. Install Node.js and Python (see above).
2. Unzip `RetroHub-<version>-fresh-install.zip` anywhere, for example `C:\Games\retro-hub`. The path can contain spaces.
3. Double-click **`launch.bat`** (Windows). On macOS or Linux, run `python3 RetroHub.pyw`.
4. In the window, press **▶ Start**.

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
| Open the browser | the window | At `http://localhost:8080`, or the tunnel address. |

A fresh install has **no games, accounts, settings or emulators**. `roms/` is empty, the `emulators/<name>/` folders are empty placeholders, and `.env`, `cache/`, `run/` and `library-folders.json` are created when needed.

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

The status line shows *Starting… / Running / Stopping… / Stopped*. If a hub started some other way is already running (found through `run/retro-hub.json` and an open port), it shows **Running (started elsewhere)**, and **Stop** works on it too.

**Closing the window stops the hub**, because the hub's output runs through the window. To keep a hub running without the window, use the command-line launcher or Docker.

### Settings tab

A form over `.env`. **Save** rewrites only the keys in the form. Comments and other lines are kept, a cleared value is commented out (`# KEY=`), and values with spaces or `#` are quoted. Save checks that the port is a number, the owner password has at least 8 characters, folders exist, and a tunnel token has an `https://` public URL. If the hub is running, it offers a restart. **New owner password** generates a random one; press **Save** to keep it. **Edit .env as text** opens the file in the Files tab.

### Apps tab

The same registry as `python apps.py`. It lists emulators (built-in and yours), consoles and the emulator each one uses, and PC games, with ✔ for installed.

- **Add PC game**: asks for a name, then the `.exe`, then optional launch options.
- **Add emulator**: asks for a name, the `.exe`, the console ids it handles, and a launch-options template (`{game}` = game path).
- **Remove selected**: only works on entries you added. Files are never deleted.
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
- If no working Python is found, it says how to install one and waits for a key.

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
```

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
- The ping badges next to each lobby estimate the delay through the hub: `<50` green, `<100` amber, `100+` red.
- If allowed, extra people can join as **spectators**. A lobby holds up to 12 clients, with `MAX_PLAYERS` (2–4) seats.
- A dropped connection keeps its seat for 30 s, so you can reconnect and carry on.

### In the match

| Feature | How |
| --- | --- |
| Chat | Press **/** to type and **Enter** to send. Messages also pop up over the game. |
| Voice | The mic button. Voices travel over the same WebRTC links. |
| Save states (co-op host) | **💾 Save** or **F2**, **📂 Saves** or **F4** (loads the newest). Saves are copied to every player, so whoever hosts next can continue. Export and import as `.rhsave`. |
| Stream quality (host) | **📶 Stream**: presets (Recommended 6 Mbps 60 fps, High 12 Mbps, Balanced 4 Mbps ≤720p, Data saver 1.5 Mbps 30 fps ≤480p) or custom bitrate, frame rate, resolution, audio quality and codec (Auto, H.264, VP9, AV1, VP8). Changes apply live. Per-player stats show what limits quality (network, host CPU or TURN). |
| Lighter stream (guest) | Each guest can cap their own stream at 3 or 1.2 Mbps without affecting others. |
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
- **LiveSplit**: *PB, LiveSplit & pop-outs* downloads your splits as a `.lss` file, and **Mirror to LiveSplit on this PC** drives LiveSplit through its server (LiveSplit: *Control → Start Server*, WebSocket, default `ws://localhost:16834/livesplit`): start on GO, split, undo, reset. The page may only connect to `localhost` for this.

### RetroAchievements

**🏆 RetroAchievements** in the top bar takes your RetroAchievements username and **Web API key** (retroachievements.org → Settings → Authentication; it can only read). They stay in this browser; the hub passes them to the RetroAchievements Web API (`core/net/retroachievements.mjs`) and stores nothing. In a match the **🏆** button lists the game's achievements, your progress and rarity, and polls every minute: new unlocks pop up and (optionally) go to the lobby chat.

- The game is found by its **ROM hash** (RetroAchievements' rules: copier headers skipped, N64 byte order fixed) for cartridge consoles, else by title. Library games are hashed by the hub, a file from your computer is hashed in your browser. Zipped games, disc consoles, DS, PSP and arcade match by title.
- **Unlocking happens in an emulator with RetroAchievements built in** (RetroArch, PCSX2, Dolphin, DuckStation, PPSSPP, melonDS…) signed in to your account, so native games can earn them. EmulatorJS has no RetroAchievements support: for browser games the panel shows the set and your progress only.
- Game lists (with hashes) are cached a day in `cache/retroachievements/`, badges for good.

### Owner tools

- **Unlock library**: enter `ADMIN_PASSWORD`. The **Library folders** menu opens straight away (see [section 7](#7-the-rom-library)). Accounts listed in `ADMIN_KEYS` are owners automatically.
- **Library folders**: a top-bar button, shown to owners.
- Shutting down the server from the hub is owner-only.

---

## 7. The ROM library

### Main ROM folder

`ROMS_DIR` (default `./roms`, or `/roms` in Docker) is scanned recursively, up to 5 levels deep. The list is cached for 30 seconds. Each file's console is found in this order:

1. **Folder name**: the nearest parent folder whose name matches a console's folder list. Case, spaces, `_`, `.` and `-` are ignored.
2. **Extension**: when it belongs to only one console.

Ambiguous extensions (`zip 7z bin iso cue img`) need a console folder. Folders named `bios`, `covers`, `boxart`, `media` and hidden folders are skipped. `.cue` sheets and extra `(Track N)` `.bin` files are hidden, so each disc appears once.

| Console | Folder names | Extensions |
| --- | --- | --- |
| Nintendo 64 | `n64`, `nintendo64` | z64 n64 v64 |
| NES | `nes`, `famicom` | nes fds unf unif |
| SNES | `snes`, `supernintendo`, `superfamicom`, `sfc` | sfc smc fig swc |
| Game Boy / Color | `gb`, `gbc`, `gameboy`, `gameboycolor` | gb gbc dmg |
| Game Boy Advance | `gba`, `gameboyadvance` | gba |
| Nintendo DS | `nds`, `nintendods` | nds |
| PlayStation | `psx`, `ps1`, `playstation`, `playstation1`, `psone` | pbp chd m3u ecm |
| Genesis / Mega Drive | `genesis`, `megadrive`, `md`, `segamd` | md gen smd |
| Master System / Game Gear | `sms`, `mastersystem` / `gg`, `gamegear` | sms / gg |
| Sega CD / 32X / Saturn | `segacd`, `megacd` / `32x`, `sega32x` / `saturn`, `segasaturn` | – / 32x / – |
| Atari 2600 / 7800 / Lynx / Jaguar | `atari2600` / `atari7800` / `lynx` / `jaguar` | a26 / a78 / lnx / j64 jag |
| PC Engine / TG-16 | `pce`, `pcengine`, `tg16`, `turbografx`, `turbografx16` | pce |
| Neo Geo Pocket / WonderSwan / Virtual Boy / ColecoVision | `ngp`, `ngpc` / `wonderswan`, `wsc` / `virtualboy`, `vb` / `coleco` | ngp ngc / ws wsc / vb vboy / col |
| Arcade (FBNeo) | `arcade`, `fbneo`, `fba`, `neogeo` | (zip) |
| PSP | `psp` | cso |
| Native consoles | see [section 8](#8-native-emulators-and-pc-games) | |

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

Other state, not set through environment variables: `library-folders.json` (per-console folders, set in the hub) and `emulators/apps.json` (your emulators and PC games, set in the Apps tab or with `apps.py`).

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
| `GET /api/library` | library access | The game list `[{ path, name, ext, system, size, cover, native? }]`. |
| `GET /roms/<path>`, `GET /covers/<path>` | library access | ROM and cover files. Supports HTTP range requests. |
| `GET /data/cores/<file>` | signed in | Cores: bundled, then cached, then fetched from `cdn.emulatorjs.org/4.2.3`. |
| `GET /api/emulators` | signed in | Check for Emus: `{ ok, error, emulators:[{id,label,installed,custom,unknown,systems}], folder? }`. |
| `GET /api/library/folders` | owner | `{ canEdit, romsDir, systems:[{id,label,native,dir,defaultDirs}] }`. |
| `POST /api/library/folders` | owner on hub PC + `X-Retro-Hub: library` | `{ system, dir \| null }` sets or clears a console folder. |
| `GET /api/fs/dirs?dir=` | owner on hub PC | `{ dir, parent, dirs:[{name,path}] }`. An empty `dir` returns the drives and places to start from. |
| `GET /api/native` | signed in | Native status for the owner on the hub PC, otherwise `{ available:false, reason }`. |
| `POST /api/native/launch`, `/api/native/stop` | owner on hub PC + `X-Retro-Hub: native` | Start or stop a native game. |
| `POST /api/shutdown` | token or owner | Graceful shutdown: players are told, then the process exits. |

### WebSocket `/ws`

JSON messages with a `t` field.

- **Client → server**: `ping`, `lobby` (subscribe to the lobby list), `join` (`room`, `role`, `password`, `local` seats, `mode`, `game`, `system`), `signal` (relay to a peer), `ready`, `rom` (CRC32 in ghost mode), `ghost`, `rules`, `start`, `abort`, `progress`, `slot`, `swap`, `spectate`, `voice`, `chat`, `savestate`, `leave`, `handoff`.
- **Server → client**: `pong`, `rooms`, `joined`, `roster`, `phase`, `countdown`, `signal`, `chat`, `chat-history`, `notice`, `error` (with `code`: `password`, `full`, `no-room`, `host-taken`, `limited`…), `promoted`, `shutdown`.

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
| `emulators/apps.json` | created | Your emulators and PC games. |

Back up `.env`, `library-folders.json` and `emulators/apps.json` when moving the hub to another PC. Players should keep their own account backups (**Export account**).

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
| A game in a console folder doesn't show up | Its extension must belong to that console or be generic (`zip`, `iso`, `bin`, `7z`, `img`, `cue`). It must be at most 5 folders deep. The list refreshes within 30 s. |
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
