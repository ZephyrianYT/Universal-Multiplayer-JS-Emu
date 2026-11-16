# Changelog

## 0.2.1 - 2026-11-15

Community requests.

### Library
- **Sort by console now groups the library**: a heading per console with its game count. Click a heading to show only that console.
- **Cover art**: optional auto covers from libretro-thumbnails (owner's choice, off by default), your own cover by right-click or by dropping an image on a game, and a TheCoverProject search shortcut (its site can't be downloaded from automatically). Kept in `cache/covers/`, never in the ROM folders.

### Race / speedrun mode (new)
- **Race / Speedrun** mode: Single-Player Ghost plus a timer kept by the hub. Splits named by the host, F6 / F7 to split / undo, live standings, finish and result lines in chat.
- Alone it's a speedrun timer with personal bests, best segments and Reset.
- **Pop out everyone** opens a picture-in-picture window per player. Export splits to LiveSplit (`.lss`) or mirror the timer to LiveSplit Server on your PC.

### RetroAchievements (new)
- 🏆 in the top bar for your username + Web API key (kept in your browser), and a 🏆 panel in matches: the game's achievements, your progress, unlock pop-ups and an optional chat line.
- Games are matched by ROM hash (RetroAchievements' rules) or title. Unlocks come from emulators with RetroAchievements built in; EmulatorJS can't award them, so browser games show the list and progress.

### GBA / Game Boy link
- **Fixed: link play opened in EmulatorJS.** Library GBA / GB / GBC games can be hosted as a **VBA-M link cable** session from *Host a game* (Play in), remembered; games in VBA-M folders default to it. GB and GBC games can be used in link sessions, and a lobby with the console set to VBA-M link now starts VBA-M for browser-folder GBA games instead of failing.

### Native emulators
- **Headless**: the emulator window stays off-screen and the host plays it in the page (keyboard via a virtual controller), with a 🪟 button to bring the window back. Windows, virtual gamepads required.

## 1.19.0 - 2026-11-13

### Emulator detection
- **Xbox (xemu) is found in `emulators/xbox/`** (also `xemu/`, `originalxbox/`). It used to show as not installed.
- **melonDS** is a new native emulator, with a **Nintendo DS (melonDS)** console: `.nds` games still play in the browser, games in a `melonDS` folder run in melonDS.
- Emulators are recognised by the program's own name (Windows ProductName), so a renamed exe is found wherever it is, and can no longer pass for another emulator (a melonDS renamed `Azahar.exe` was being used for 3DS games).
- Azahar is also looked for in `3ds/` and `n3ds/`; `.3dsx` added.

### Guest controllers
- **Virtual controllers are plugged in before the emulator starts.** They used to appear only after "Share the window", so emulators that don't hot-plug (xemu, melonDS, Dolphin) never saw P2-P4.

### Lobbies across hubs
- **LAN lobbies**: hubs on the same network find each other's lobbies automatically (UDP multicast `239.255.43.21:37115`) and list them under **Other hubs nearby**. `LAN_DISCOVERY=0` turns it off.
- **Master lobby pool** (optional): `MASTER_SERVER_URL` lists this hub's lobbies in a shared pool and shows the pool's lobbies; `MASTER_SERVER=1` makes a hub the pool.

### GBA link cable (VBA-M)
- **Link-cable sessions** between hubs on the same network: everyone runs their own copy of the game in VBA-M, the host is P1 (link server), others get P2-P4 and need the exact same ROM. One click in VBA-M (Options > Link > Start Network Link) starts the link; everything is pre-filled.

### Pretendo Network (Wii U)
- Hosting a Wii U game checks whether Cemu is ready for **Pretendo Network** (Cemu 2.0+, `otp.bin`, `seeprom.bin`, a PNID account) and says what's missing. **Use Pretendo** switches Cemu's account to the Pretendo service (backs up `settings.xml`). Ready hosts show a **Pretendo** badge in other hubs' lists.

Details, causes and tests: `FIXLOG.md` sections 4-9.

## 1.8.0 - 2026-11-13

### Native emulators (Xenia and other standalone emulators)
- **Fixed: quotes in launch options broke the game path.** Typing `"{game}"` (or quoting any option) when adding an emulator with `apps.py` sent the quote marks to the emulator as part of the path, so it couldn't open the game. Quotes are now removed, including in emulators already saved in `emulators/apps.json`. Paths with spaces were always passed correctly without them.
- **The page now notices when the emulator closes.** If it is closed, quits or crashes, the loading board says so (with the exit code) and offers **Retry**, instead of waiting on "Share the window". If it closes within 10 seconds of starting, the message says it probably can't open the file or needs setup first.
- **Xbox 360: `.zar` files** are recognised as Xenia games (`.iso` already worked inside an `xbox360` folder).

## 1.7.0 - 2026-11-13

### Retro Hub window (launcher + admin panel)
- **`launch.bat` now opens a window** (`RetroHub.pyw`) instead of a console: Start / Stop / Restart, choose Wi-Fi, this computer only or Internet (Cloudflare Tunnel), live server log, copy links.
- Tabs for **Settings** (edits `.env`), **Apps** (emulators and PC games), **Files** (view and edit the hub's files) and a **Console** admin terminal.
- `launch-tunnel.bat` and `stop.bat` are gone: both are buttons in the window. `launch.bat --tunnel` still runs the console launcher.
- **Fixed: `launch.bat` failing on PCs without Python.** Windows' Microsoft Store shortcuts (`python.exe`, `py.exe`) fooled the old check, so the script ran a shortcut and stopped. It now tests that Python really runs and says how to install it.

### Hub
- **Check for Emus** (under the ping legend): lists every native emulator with a green ✔ when it's loaded and a red ✖ when it isn't, plus any folder in the emulators folder that isn't a known emulator.
- **Library folders**: after **Unlock library** (and from the new **Library folders** button) the owner sees every console with a **Browse…** button to pick the folder its games are in. Saved in `library-folders.json`. Changing folders only works from a browser on the hub's own computer. Not available in Docker (mount volumes under `/roms` instead).

### Docs
- **New README**: a full engineering guide covering architecture, installing, the launcher window, using the hub, library rules, native emulators, internet play, Docker, a configuration reference, the security model, the HTTP/WebSocket/WebRTC internals, and a file map.

## 1.6.0 - 2026-11-13

### Video codec choice (Co-op Netplay)
- The host can pick the **video codec** for the game stream under Stream quality:
  - **Auto**: the browser's choice, usually VP8.
  - **H.264**: often hardware-encoded, so lighter on the host's CPU.
  - **VP9**: sharper at low bitrates, but uses more CPU.
  - **AV1**: the best quality per Mbps, but heavy without hardware support.
  - **VP8**: plays everywhere.
- Only codecs the host's browser can send are offered.
- **Switching mid-match** briefly pauses each player's video (a second or two) while their connection renegotiates. Nobody is disconnected.
- **Nobody loses the picture**: if a player's browser can't decode the chosen codec, their stream falls back to the next codec both sides support.
- The 📶 Stream panel shows the codec actually in use for each player, and whether it's hardware or software when the browser reveals it. Chrome only reveals this after the page has microphone or camera permission.

## 1.5.0 - 2026-11-13

### Stream quality (Co-op Netplay)
- **Quality settings for the host**, in the lobby under *Sound, controls & stream* and during a match in the new **📶 Stream** panel. Presets: **Recommended** (6 Mbps, 60 fps), **High** (12 Mbps), **Balanced** (4 Mbps, up to 720p) and **Data saver** (1.5 Mbps, 30 fps, up to 480p). Or set each limit yourself:
  - max bitrate per player (0.5–20 Mbps)
  - frame rate (60 or 30 fps)
  - max resolution (native, 1080p, 720p, 480p, 360p)
  - what to give up when a connection can't keep up: sharpness, frame rate, or a balance of both
  - game audio quality (64–192 kbps)
- Changes **apply live** to every player without reconnecting, and are remembered.
- **Each player can ask for a lighter stream** (up to 3 or 1.2 Mbps) for just their own connection, without lowering it for anyone else. The host sees who asked.
- **Live stats.** The host sees, per player, the video bitrate, frame rate, picture size, packet loss and ping, plus what's holding quality back: the network, the host's CPU, or a TURN relay. Players see what they receive, including dropped frames and jitter. The panel suggests what to change when something struggles.
- The players' top bar now shows bitrate and frame rate next to the ping to the host.
- **Game audio is now stereo.** It used to be mono, which is WebRTC's default.

## 1.4.2 - 2026-11-13

### Accounts
- **Remove an account** from this browser with the 🗑 button on the sign-in page (Switch account takes you there). It asks first and reminds you to download a backup with ⤓, since a removed account can't come back without one.
- **Damaged accounts no longer get you stuck.** The sign-in page checks every saved account first. One whose saved ID or name doesn't match its key is repaired automatically. One whose key is unusable is marked **Damaged** with only a Remove button, instead of failing again on every visit.
- An account that fails to sign in is no longer retried automatically on the next visit, so you can pick another one.
- If the browser can't open its saved accounts at all, the sign-in page offers **Reset accounts in this browser**.
- A failed key check no longer counts toward the 15-minute sign-in lockout, so one broken account can't block every account on the same computer. Wrong server access codes still do.
- Clearer messages when the server can't be reached or can't verify an account.

## 1.4.1 - 2026-11-13

Quality-of-life fixes.

### Chat
- A message that can't be sent right now (no connection to the hub, or sending too fast) **stays in the box** with a short explanation, instead of disappearing.
- **Up arrow** in an empty chat box brings back your last message. **Esc** leaves the chat box in the lobby too.
- A characters-left counter appears near the 300-character limit.
- While the tab is in the background, its title shows unread messages, e.g. **(2) Retro Hub**.
- The chat now says when someone else becomes the host. A player whose page reloads no longer shows up as "left" and "joined" again.

### Hosting
- **Double-click** a game in the library (or Ctrl+Enter on it) to open a lobby with it right away.
- For files whose console can't be told from the extension (`.zip`, `.bin`, `.iso`, ...), the console you picked last time for that file type is filled in for you.
- New lobby codes leave out look-alike characters (2/Z, 5/S as well as 0/O and 1/I/L), so they're easier to read out loud.

### Connection
- When the hub is unreachable, the lobby connection retries at growing intervals (1.5 s up to 15 s) instead of every 1.5 s forever.

## 1.4.0 - 2026-11-13

### Chat
- **Text chat** in every room lobby, for players and spectators, with or without a mic. Late joiners and players who reconnect (or reload after a host change) see the recent history.
- During a match the chat moves into a **drawer** (💬 Chat in the top bar, or press **/**). **Enter** sends and gives the keyboard straight back to the game, and **Esc** closes the drawer. Keys held in the game are released the moment you start typing.
- New messages appear briefly over the game, and the Chat button shows an unread count.
- The hub posts **joins, leaves, saves and loads** in the chat. Messages are capped at 300 characters, and players sending too fast are asked to slow down.

### Shared save states (Co-op Netplay)
- The host can **save the match at any time** with 💾 Save (or **F2**). Saves are compressed and kept in the browser with a small screenshot, up to 12 per game.
- **📂 Saves** lists them with Load, Download and Delete. **F4** loads the newest. Everyone sees in the chat when the host saved or loaded.
- **Every save is copied to every player** over the existing WebRTC connection, so if the host leaves, whoever hosts next can pick the game and carry on from the same point. When a match starts and a save for the game exists, the host gets a hint to continue it.
- Saves can be downloaded as `.rhsave` files and imported on another computer. Files and copies received from other players are size-limited and checked before they're stored.

### Game library
- The server library is now a **grid of game tiles** with search, a console filter (only consoles you have) and sorting: A–Z, recently played, or by console. Arrow keys move between tiles.
- **Cover art**: put `<game name>.png` / `.jpg` / `.webp` next to the ROM or in a `covers/`, `boxart/` or `media/` folder beside it. Games without a cover get a tile with the console and the game's initials.
- Games you hosted recently are marked and can be sorted to the top.

### Polish
- **Getting started** guide on the hub (three steps, dismissible).
- **Join with a code**: type a lobby code, or paste a whole invite link, under Hosting now.
- Friendlier empty states for the hosts list and an empty library, with what to do next.
- **Phones**: the top bar keeps your name visible, cards use tighter padding, and the library grid, chat and saves panels fit a 375 px screen.

## 1.3.0 - 2026-11-13

### Internet play with Cloudflare Tunnel
- New **launch-tunnel.bat** / **launch-tunnel.sh** (or `launch.py --tunnel`) put the hub on a free HTTPS `*.trycloudflare.com` address, so invite links can be pasted into Discord. With `TUNNEL_TOKEN` and `PUBLIC_URL` in `.env` it uses your own Cloudflare named tunnel instead. In tunnel mode the hub listens on this computer only (`--lan` keeps the Wi-Fi link working).
- New optional **tunnel** profile in `docker-compose.yml` runs the official cloudflared container next to the hub.
- New `PUBLIC_URL` setting: invite links use the public address even when the host opened the hub on localhost. Copying a localhost-only link now warns that it only works on this PC.
- Client IPs behind a proxy: `CF-Connecting-IP` / `X-Forwarded-For` are trusted automatically from a proxy on the same computer, so one visitor's wrong passwords no longer rate-limit everyone coming through the tunnel.

### Fresh-install defaults
- Placeholder or short owner passwords (`change-me-owner`, under 8 characters) are ignored with a warning. `docker-compose.yml` reads its settings from `.env` instead of shipping a sample password.
- Added the **stop.py / stop.bat / stop.sh** scripts the server already supported.
- Removed a stray test ROM from `public/`, the WIP banner, and the incorrect "N64 cores ship with the app" note (every core is fetched once by the server and cached).


### Seat-keeping reconnects
- When a player's (or the host's) connection to the hub drops, the hub **holds their seat for 30 seconds** instead of removing them. Their card shows **Reconnecting…**, and the others get a toast.
- On reconnect, a secret **resume token** (given at join, bound to the account) restores the exact same player: same id, seat, ready state, loading progress and ROM check. Because the id doesn't change, the existing WebRTC game link is kept, and play continues through a short hub blip.
- Leaving on purpose (Leave button, closing the tab) frees the seat right away. A page reload without the token releases the old held seat so the new join can take it.

### Host migration
- When the host leaves, or doesn't come back within 30 seconds, the lobby **passes to the connected player in the lowest seat** (a spectator if nobody is seated) instead of stalling. Everyone gets a notice saying who hosts now.
- The game only ever ran in the old host's browser, so a running match ends and everyone returns to the lobby with their seats kept. The new host picks the game with **Change…** and starts again.
- The old host can rejoin as a player; trying to host the same code again explains who hosts it now.

### Single-Player Ghost mode
- New lobby mode next to **Co-op Netplay**: every player runs their own copy of a single-player game, and the others appear over it as **translucent ghosts**. A banner explains it when you pick the mode, and a persistent **GHOST MODE — Visual Only (No Player Interaction)** badge shows in the lobby header and the in-game corner.
- **Bring your own ROM**: each player drops their own ROM file in the lobby (it never leaves their browser). A CRC32 checksum is compared with the host's: **ROM Verified (Match)**, or a warning that a different dump may desync levels or the camera. Ready-up is locked until a ROM is loaded; player cards show **No ROM loaded / Not ready / Ready**. A new host ROM clears everyone's ready state.
- **Synchronized start**: Start loads everyone's emulator first (per-player loading bars) and holds each game on its first frame. The 3-2-1 then starts by itself and every run unpauses on **GO!** If anyone unreadies, disconnects or the host aborts, the countdown freezes; players ready up again and the host restarts it.
- **Ghost overlay**: ghosts are sent as low-rate video (about 20 fps, ~350 kbps, max 640 px, relayed by the host) and drawn over your game at 60% opacity. They are cropped to the game picture and never block clicks. The new **Ghosts** HUD panel has an opacity slider (0–80%), per-player tint colors (P2 cyan, P3 magenta, P4 yellow by default), per-player show/hide and a "Lighten" blend that hides dark backgrounds. The settings are remembered.
- **Quick controls**: a one-click **👻 Ghosts on/off** button in the top bar and the **O** key toggle all ghosts. Click a player's chip in the top bar to hide or show just their ghost.
- **Picture-in-picture**: drag a player's chip onto the game to pop their run out into a floating window (solid, untinted) that you can move by its title bar and resize from the corner. ⧉ moves it to the browser's own floating window, which stays on top of other apps or can sit on a second monitor. ✕ puts them back as a ghost. Window position and size are remembered per player slot. Keyboard: focus a chip, Enter toggles, P pops out. The Ghosts panel has Pop out / Pop in buttons too.
- Ghost tint is now **off by default**, so ghosts show in their real colors. Your saved settings were switched once.
- Spectators of a ghost run watch one player solid (choose with **Follow**) with the others as ghosts.
- Hosts list: **Ghost** badge and a mode filter (Co-op Netplay / Single-Player Ghost). The host can switch modes in the lobby rules (this clears ready states). Ghost mode is one player per computer, and seats are locked once a run has started.

### Room lobby before every match
- Hosting now opens a **room lobby** first. Player cards show each player's state (**Not ready / Loading / Ready**), hub ping and voice activity.
- The host sets the rules (game, console, spectators). Any change clears everyone's ready state.
- Players can move to an empty seat or switch to **spectating**; the host can swap seats. Full lobbies can still be watched.
- **Start match** runs a 3-second countdown with ticks. It freezes and stops at once if anyone unreadies or disconnects; the host can abort it.
- A **loading board** shows each player's progress (`P1: 100%`, `P2: 45%`) and the match starts when everyone reaches 100%.
- **Voice chat**: optional mic with live level meters next to names and a per-player local mute. Voice is relayed by the host over the existing WebRTC connections.

### Hosts list
- Color-coded ping badges (green under 50 ms, yellow under 100 ms, red above), sorted by lowest ping. Ping is estimated through the hub before you join.
- Filters for full lobbies, password lobbies and console, remembered between visits.
- One-click invite link copy with a "Copied!" toast (also works on plain-HTTP LAN addresses).

### Controller calibration
- New **Calibrate controllers** wizard: up to 4 controllers claim a slot with any button, then tap along to a 3-2-1-GO lead-in and 3 beats. Green ±40 ms, yellow up to ±150 ms with the delta shown, red shake and reset on a miss.
- Saves each controller's average input offset and auto-measured stick and trigger deadzones (sticks now use a radial deadzone). With two or more players on one computer, faster controllers can be delayed to match the slowest one. **Hold to skip** for returning players.

### Quality of life
- Escape closes dialogs and overlays, focus stays inside them, and returns to where it was afterwards.
- Join, Open lobby, Unlock, Ready and Start ignore double clicks (300 ms guard) and show a busy state. Hover, pressed and disabled states for all buttons.
- Long names, game titles and latency readouts are truncated with an ellipsis.
- Volume, voice volume, filters, selected tab, panel state and mutes are remembered.

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
