# Changelog

## 1.31.0 - 2026-11-20

Released as **Retro Hub 0.4.3**: a pop-out capture window for the OBS overlay, YouTube chat on stream, and RetroAchievements support.

### 🪟 Pop-out capture window
- ☰ → **📺 OBS overlay** → **🪟 Pop-out capture window**: the overlay in its own clean window (no bars, borders or scrollbars) for apps that capture a window instead of a Browser Source: OBS / Streamlabs Window Capture, Discord, Firefox or Chrome screen sharing, virtual cameras. Or copy its link into another browser on this computer.
- Sizes 1280 × 720, 1920 × 1080, 960 × 540 and vertical. Backgrounds: transparent, chroma green `#00FF00`, chroma magenta `#FF00FF`, solid black.
- **Mirror** and **Flip** for captures that come out reversed or upside down; also in the link (`flipX=1`, `flipY=1`), so they stay on next time.
- A toolbar that shows only while you move the mouse over the window; hold and drag it out of the way. Keys work without showing anything: B background, 1-4 pick one, X mirror, Y flip, H keep the toolbar shown.
- Follows the hub live and keeps its clock running while covered or unfocused. No game sound unless you tick it, so it never doubles your stream's audio.
- Your existing OBS Browser Source and dock links work exactly as before.

### ▶ YouTube chat on stream
- 📺 OBS overlay → **💬 Chat on stream**: type your YouTube **@handle**, channel link or live video link. The chat shows in the overlay (with a red ▶) and the dock, next to Twitch chat if you simulcast.
- Read-only with **no login and no API key**: the hub reads the public chat the way youtube.com's own chat box does, from your PC only. It can never post.
- The same chat commands and points as Twitch (`!flip`, `!points`…); a Super Chat or Super Sticker adds 5 points. Messages that were already there when it connects can't fire anything.
- Not live yet? It checks once a minute and connects when you go live.

### 🛡️ Safer chat on stream (Twitch and YouTube)
- Messages your mods **delete**, and everything from someone they **time out or ban**, now disappear from the overlay and the dock too. Before, they stayed up until newer lines pushed them out.
- **Links show as 🔗** by default, so nobody can put a scam link on your stream (*Show links* turns them back on).
- **Hide messages with these words**: your own list of words or phrases (any case, also in fancy Unicode letters). Matching names and messages are hidden and can't use chat commands.
- The hub's own lines (like *Send a test message*) carry a **HUB** badge, so a viewer named "Retro Hub" can't pass for it.

### 🏆 RetroAchievements
- Shows which consoles support RetroAchievements (PCSX2, PPSSPP, Flycast; Dolphin with notes) under Console in *Host a game*, on library tiles, in the 🏆 panel and the RA dialog.
- Owner: see whether each emulator has achievements on, is signed in and uses hardcore; switch them on in one click (backed up first), or open the emulator to sign in.
- Checks whether your game file is a dump RetroAchievements recognises, and lists the files it accepts.
- `apps.py add-ra-emulator` adds a RetroArch-family emulator you downloaded as its own console. Details: `docs/ACHIEVEMENTS.md`.

## 1.30.0 - 2026-11-20

Released as **Retro Hub 0.4.1**: everything for streamers, in one OBS Browser Source. Plus a security fix: everyone should update.

### 🛡️ Fixes
- **A signed-in user could stop the hub** by sending one oversized message on the lobby connection (also the Android view and native-input connections). Now only that connection is closed.
- **Pedals and handbrakes** that rest at full deflection no longer hold Up + Left on their seat for the whole game.

### 🎬 The game in the OBS overlay
- Host a lobby from this computer and the 📺 OBS overlay shows **the game itself**, for every console: browser games, native emulators (after *Share the window*), Android, shuffles; in a race, your own run. No Window Capture needed.
- Tick **Control audio via OBS** for the game's sound as its own mixer channel. Viewer effects like Upside down also flip the overlay's picture, with a banner saying who did it.
- The video goes straight from your lobby page to OBS on the same PC; the hub only passes the connection setup.

### 🎥 Streamer tools
- **Presets:** 🎮 Game night, 🔀 Shuffle / chairs (big seat-rotation countdown), ⏱ Speedrun, 🎲 Chat chaos. **Layouts:** Corner, Bottom bar, Full frame, Game only, **Vertical** (1080 × 1920 for Shorts / TikTok).
- **💬 Twitch chat**, read-only and anonymous (no login, it can never post): a chat box in the overlay, `!flip` `!mirror` … effects paid with chat points (bits add points), `!points`, mods and you for free, and **channel-point rewards** linked to effects. Rate-limited per person; only the effects you tick. **Send a test message** to place the chat box.
- **⏱ Speedrun timer** with splits on the overlay; race lobbies show their own clock and finishers.
- **🎛 Control dock** for OBS (Docks → Custom Browser Docks): timer (Space / Enter / Backspace), Rotate seats now, every effect as a free button, seats, up next and chat. It has its own key.
- **🎮 Controller display:** every seat's buttons and stick, live.
- **Looks:** Sharp pixels or CRT scanlines (on the game only). **Game and overlay as two sources** for OBS filters (obs-shaderfilter) and Source Record; the dialog lists plugins that pair well.
- The overlay and dock URLs stay blurred in the dialog until you point at them.

### 🎮 Controllers
- New option **Real controllers get seats first** (lobby → Sound, controls & stream): gamepads get P1, P2… first; a wheel, pedals or handbrake only gets a seat once you use it. Off by default (connection order, as before).

## 1.29.0 - 2026-11-19

Released as **Retro Hub 0.4.0**: a security release, plus the OBS overlay, simpler System Link rooms and Wii U guided setup. Everyone should update.

### 🛡️ Security
Everything that runs a program, writes a file or turns someone's input into keys on your PC was traced back to who can reach it. Details: `docs/SECURITY-LOCAL.md`.
- **Keyboard mode** (guests' buttons as keys, used when no virtual gamepad driver is installed): keys now go only to the emulator's **main** window, never to a dialog it opened. Before, a guest could type into an emulator's file dialog and confirm it.
- **Emulator cores are hash-checked:** all 200 EmulatorJS 4.2.3 core files have a pinned size and SHA-256. A changed or unknown file is never served; a damaged cached copy is replaced.
- **Websites can't reach the hub through your browser:** the OBS overlays, System Link and GBA link routes check the `Host` and refuse requests from other sites (DNS rebinding), the lobby connection checks where the page came from, and no route ever allows cross-site access.
- The link-cable host from another hub can't start with `-` (it goes on the emulator's command line); the updater never overwrites `.env` and your other files whatever their letter case; lobby messages with names like `constructor` are ignored and a bad message can't take the hub down.
- The 🌐 Online panel shows your home folder as `%USERPROFILE%`, so your Windows user name doesn't show on stream.

### 📺 OBS overlay
- ☰ → **📺 OBS overlay** (owner, on the hub's PC): Corner, Bottom bar or Full frame (transparent holes for your camera and chat), live preview, **Copy** for the Browser Source URL, **New link** to change its private key.
- Updates the moment something changes (no polling); pop-ups for joins, game changes, save states and RetroAchievements unlocks (`mute=1` for no sounds); "Reconnecting…" instead of old data while the hub restarts, then it recovers by itself.
- Stream-safe: never file paths, IP addresses or account IDs; the room code only if you tick it. Works only on the hub's own computer.

### 🎮 System Link, simpler
- **Same network (LAN)** or **Remote / virtual LAN** instead of a list of network adapters (that's under Advanced); **Copy room address** for the host.
- "2 of 4 ready · at least 2 ready to start" with a bar, and plain **Same game / Different version / Wrong game** badges (IDs under Details).

### 🧭 Wii U online, guided
- In 🌐 Online → Cemu: **Guided setup** in three steps: drop your Wii U dump (it recognises `otp.bin`, `seeprom.bin`, `account.dat`, `network_services.xml`), pick Pretendo / your own server / custom, then **Save & open Cemu**.
- Your key files stay on your PC (sizes checked, never logged), what they replace is backed up, and an existing Wii U profile is only replaced when you say so.

## 1.28.0 - 2026-11-19

Released as **Retro Hub 0.3.8**: a ROM patcher and Xbox 360 System Link rooms.

### 🩹 Patcher
- **🩹 Patcher…** in Host a game (owner, library games): patch a game and save the result **next to it** in `patched/<coop|randomizer|translation|qol|custom>/<Game> [<Patch>]`. The original ROM is never changed; the same patch again reuses the file.
- **Formats:** IPS, BPS, UPS, PPF, xdelta / VCDIFF, APS (N64 and GBA), BSDiff, and Archipelago `.ap*` patch files (the single bsdiff4 step). Shows the ROM's CRC32, MD5 and SHA-1.
- **SNES copier headers** are removed or added automatically when a patch that checks its ROM (BPS, UPS, xdelta) was made for the other kind; or choose by hand.
- **Online patches** from a catalog matched by the ROM's checksums: patch files only (never ROMs), GitHub only, SHA-256 checked before use. Built-in: Super Mario 64 Splitscreen Multiplayer. Add your own in `patches/catalog.json`.
- **Combo randomizers** (SMZ3, Archipelago): links to their generators, and drop the finished ROM in to save it in `patched/randomizer`.
- In the library, patched copies sit right after their game with a 🩹 badge; **Launch patched** picks one to host. Browser saves are separate per copy (native emulators may share saves with the original).
- 🧩 Patches & variants also reads the new formats.

### 🔗 Xbox 360 System Link rooms
- 2-4 hubs play one System Link game together, each PC running **its own** Xenia with **its own** copy of the game. Host a room, others join from the nearby hubs list or by typing the host's address.
- **Same game check:** a different game is refused; a different release, build or title update is a warning before Start.
- Start needs 2-4 players marked Ready; every hub then opens Xenia in System Link mode on the network you chose (LAN, or a virtual LAN like Radmin VPN or ZeroTier; Tailscale doesn't carry the broadcasts games use). Your Xenia settings file isn't changed.
- Needs the **Xenia Canary netplay build** (`xenia_canary_netplay.exe`) in `emulators/xenia/`; normal Xenia Canary has no System Link. Details: `docs/SYSTEM-LINK.md`.

### Fixes
- **Stop** now always closes a native emulator that hung or has no window (some Python installs left it running).

## 1.27.0 - 2026-11-19

Released as **Retro Hub 0.3.7**: zero-setup native emulators, plus the features built since 0.3.6.

### 🧰 Native emulators set themselves up
- **Pre-flight check** the first time you host with an emulator: it checks the program, the Visual C++ runtime, and the files the emulator can't start without (PS2 BIOS, PS3 firmware, Switch keys, xemu's MCPX/BIOS/HDD, Cemu's `keys.txt` for encrypted discs, TeknoParrot's game executable and .NET), says how to fix each one, and has an **Open <emulator> once** button for emulators that need their own first-run window. It only shows again when something is missing or Retro Hub's setup changes.
- **Controllers by seat:** player *n* is Xbox pad *n* (you on pad 1, guests on their virtual pads), set up right before the emulator starts. Cemu gets `controller0-3.xml` (Wii U GamePad for P1, Pro Controllers for P2-P4); Dolphin gets one GameCube port per player in the lobby and a `GCPadNew.ini` with deadzones and rumble; TeknoParrot games switch to XInput while no controls are bound yet.
- **No pop-ups that stop a stream:** Dolphin's "stop emulation?" question, analytics question and update pop-up are off (for Retro Hub's launches only, nothing saved); Cemu's update question is off; fullscreen for Cemu, Dolphin and PCSX2 unless the game is headless.
- **Your settings stay yours:** a controller profile you made is never replaced, and a setting you changed in the emulator is left alone. Anything Retro Hub replaces is copied to `backup/` first. The record is `emulators/provision.json` (safe to delete).
- For developers: every native emulator now has an adapter (`core/runner/adapters/`) with the same checklist; `python apps.py preflight|provision|first-boot`. Design and gap analysis: `docs/EMULATOR-ADAPTERS.md`.
- Still by hand (the check says so): Wii Remote mapping, TeknoParrot button binding, controller files for PCSX2, RPCS3, Ryujinx/Eden, Xenia and the others.

### Also new since 0.3.6 (less tested)
- **Android (APK) console:** installs and starts an APK on an Android emulator or phone with adb and shows it in the page (scrcpy). Tested with stand-ins only.
- **Pass the controller** and combo/multiworld **randomizer links** (samus.link, archipelago.gg).
- **🧩 Patches & variants** (off by default): play a game with your own .ips/.bps/.ups patches stacked, without changing the original file.
- **Dance mats:** a 💃 Dance mat profile in Instruments (arrows, corners, jump test, lag test) and StepMania Online in Off Site Games.
- **Themes:** four launcher-style themes (Lounge, Marquee, Couch, Shelf), a grouped picker with previews, Surprise me, Undo and Match my system light/dark.

## 1.26.3 - 2026-11-19

Released as **Retro Hub 0.3.6**: a security update. Everyone should update.

### Security
- **Lobby lists could run code from another hub.** Player and seat counts from lobbies on other hubs (the LAN list and the master lobby pool) were put into the page without escaping, so a malicious hub could run its own script in your players' browsers. They're now always shown as plain numbers, and links to other hubs are re-checked as `http(s)` right where they're opened.
- **Sign-in redirect:** after signing in, the hub only ever sends you to a page on the same hub.
- **Passwords:** the owner password and access code are compared with scrypt (a slow password hash) instead of SHA-256. Nothing is stored; login attempts were and still are rate-limited.
- **The launcher no longer prints passwords.** It says they are in `.env` instead, so they don't end up in terminal scrollback or logs. Open `.env` to see your owner password.
- **Smaller fixes:** the speedrun.com game-name cleanup can't be slowed down by a very long name; Wii U `meta.xml` titles are decoded once (`&amp;lt;` no longer turns into `<`); the RPCS3 online check matches config keys exactly; messages from the hub can only call the page's own handlers.

## 1.26.2 - 2026-11-19

Released as **Retro Hub 0.3.5**: a quality-of-life pass together with the launch fix below (1.26.1). Anyone who installed from a download of the repo since that fix also gets the files that download was missing.

### Quality of life
- **Phones:** the Buddy List no longer opens by itself on a first visit and covers most of the hub. It opens on its own only if you left it open last time, or on a first visit on a wide screen (1400 px and up) where it fits beside the hub. 👥 Buddy List is still one tap away.
- **Phones:** the Play / Lobby Browser / Off Site Games tabs fit a 390 px screen; before, the whole hub page could be dragged sideways.
- No more error in every player's browser console on each hub load: the 🌐 Online check answers "not available here" for anyone but the owner on the hub's computer, instead of a 403.
- Sign-in page: no **Back** button on a browser with no accounts yet (it only showed the same form again).
- **Retro Hub window:** when another program has the hub's port, it now asks *"Use port 8081 instead and start?"* (the next free port), saves it and starts, instead of only printing the error in the log. It says which program it is when it can tell, and reminds you that accounts are per address (make a new one or import a backup there).

### Repository
- **Downloading `main` gives a working hub.** `.gitignore` rules for `*.zip`, `*.bin`, `bios/` and `offsite-games.json` also caught files the hub ships, so a git checkout or GitHub's *Download ZIP* had no J2ME runtime image, no PC emulator BIOS, an empty Off Site Games list and no `roms/<player>/` folders. They're tracked now; your games, BIOS dumps and own `offsite-games.json` stay ignored.
- **One-click releases:** *Actions → Release → Run workflow* on GitHub (website or app) builds `RetroHub<release>.zip` from `main`, checks it installs and the hub starts, and publishes the release the updater installs. `python scripts/make_release.py` builds the same zip locally. See *Publishing a release* in README-ADVANCED.md.

## 1.26.1 - 2026-11-18

Not released on its own: ships in **Retro Hub 0.3.5**. Fixes the launch bug in 0.3.3 where the browser opened a "freej2me-web / Loading…" page instead of the hub.

### Fixes
- **The hub opened as "freej2me-web … Loading…" on launch.** The hub listened on IPv4 only (`0.0.0.0`) and the launcher only checked `127.0.0.1` to see if the port was free, but browsers open `localhost` on IPv6 (`::1`) first: Firefox always, Chrome and Edge on Windows. Another program holding `[::1]:8080` (from the screenshot, a separate freej2me-web web server) therefore got the browser, and nothing warned about it. An existing account and cached page could hide it, which is why it showed up on fresh installs. Now:
  - The hub listens on IPv4 **and** IPv6 (`HOST=::`, falling back to IPv4 on computers without IPv6). In localhost-only and tunnel modes it listens on both `127.0.0.1` and `::1`.
  - Before it says it's running, the hub asks both `127.0.0.1` and `::1` who they are (`/api/instance`). If another program answers, it stops with a message naming it (page title), the port, and how to find or avoid it. The launcher refuses to start the same way, and checks both addresses.
  - The Retro Hub window only shows "already running (started elsewhere)" when Retro Hub itself answers on that port, so a leftover `run/retro-hub.json` no longer sends **Open hub** to another program.
  - `launch.py` waits for the server's own "ready" signal (after the check), not just for the port to open, so the browser is never opened on the wrong program.

### Repository
- The full Retro Hub source is back in the repository (it was only in the release zips). Fix log renamed to `FIXLOG.md`; the OBS guide is `docs/OBS-STREAMING.md`; the duplicate controllers readme was removed (`emulators/README.md` is the one).

## 1.26.0 - 2026-11-18

Released as **Retro Hub 0.3.3**.

### 🌐 Online services for every console
- New **🌐 Online** panel (owner, on the hub's own computer): for each emulator, the service its games' own online modes use, whether it's set up, what's missing, setup steps and links. Retro Hub's own lobbies still work for every console with nothing to set up. Retro Hub never ships keys, BIOS or account files: you use your own.
- Checked automatically: **Wii U / Cemu** (Pretendo, your own Pretendo server, or SmmServer), **PS3 / RPCS3** (firmware installed, RPCN account, network on globally or per game), **PSP / PPSSPP** (networking, nickname, ad hoc server, infrastructure mode), **Xbox / xemu** (Insignia), **Xbox 360 / Xenia** (the Canary netplay fork and its server). Steps and links for Dolphin (Wiimmfi, WiiLink), melonDS (Wiimmfi / Kaeru WFC), Flycast (DCNet), PCSX2, Ryujinx; Azahar and Eden rooms are built in.
- When something is limited you get one notice, a dot on the 🌐 button, and a short warning when you host that console.
- **Cemu:** follows Cemu's own rule for which folder it reads (a `portable` folder, or a `settings.xml` next to Cemu.exe, else `%APPDATA%\Cemu`). Buttons: copy files to where Cemu reads them, import your own files (a Dumpling dump), Use Pretendo, My own server (pretendo-docker), Custom (`network_services.xml`, e.g. SmmServer), Offline. Backups first. SmmServer's FakeOnlineFiles are recognised (they only work with SmmServer), and a Custom server that isn't running is reported.
- **PS3:** community servers table (PS Rewired, Demon's Souls' The Archstones) with only addresses confirmed from a named source.
- Guide: `emulators/ONLINE.md`.

### 🎮 PPSSPP (PSP) as a native emulator
- New console **PSP (PPSSPP)**: PSP games can run in PPSSPP on the host (also takes `.iso`), next to the in-browser PSP.

### 🗡️ Four Swords Adventures: GBA screens
- GameCube games played with Game Boy Advance controllers (Four Swords Adventures, Final Fantasy Crystal Chronicles) are recognised by their disc ID.
- **GBA screens mode** (only the host needs the game): Dolphin runs every port as a built-in GBA, the host shares the TV window and each GBA window, and every player sees **only their own GBA** in a corner of their game view (bigger / smaller / tuck away). Dolphin uses its own settings folder for this, so your normal Dolphin setup isn't changed. Needs your own GBA BIOS (`bios/gba_bios.bin`) and ViGEm for guests' controllers.
- **Dolphin GBA netplay helper** (everyone owns the game): 🌐 Online → Dolphin → Open Dolphin for GBA netplay sets the 4 GBA ports, your BIOS, Hide Remote GBAs, traversal, your name, the pad buffer from your ping, and the host's code.
- New `bios/` folder for your own BIOS files: never shipped, kept by updates.

### 🎨 Themes, logo and emotes
- **Custom theme**: start from any preset and pick your own background, panel, border, text and accent colors, font, heading style, corner roundness and a background picture (with darken). Share a theme with a `RH-THEME:` code. New **Durag Duck** preset.
- The **duck mascot** is now the logo next to "Retro Hub" on every page.
- **Duck emotes** in the lobby chat and Messenger IMs: a 🦆 picker or `:name:` codes. 16 classic emotes (happy, laugh, cheer, sad, cry, angry, heart, wow, wink, shades, think, sleep, shy, nervous, ko, check) and 20 Durag Duck stickers. A message that's only emotes shows them big.

### Fixes
- Theme cards cut their descriptions off.
- Cemu's Pretendo check counted `otp.bin` / `seeprom.bin` next to Cemu.exe even when Cemu reads another folder, and missed the online-mode switch.

## 1.25.0 - 2026-11-18

Released as **Retro Hub 0.3.1**.

### 💬 Retro Hub Messenger (replaces Friends)
- The Friends panel is now a classic-style messenger: a **Buddy List** window (groups, Online / List Setup tabs, Offline group, buddy requests), **Instant Message** windows, away messages with auto-responses, profiles, buddy icons, warnings, typing indicator, door sounds (made in the browser), and a taskbar for minimized windows.
- **Find a Buddy** searches people online on this hub (not invisible ones). **Invite to my lobby** and **Join** are in the IM window and the buddy's right-click menu. Same rule as before: you see each other and can IM once you've both added each other. The hub relays messages and stores nothing; your list, away messages and profile stay in your browser.
- New IMs during a match wait in the taskbar (with a toast) instead of covering the game. Lobby chat got the chat-room look.

### 🕹️ New play pages (Off Site Games tab)
- **🎞️ Load a .SWF**: classic Flash games with Ruffle, from your computer or the hub's `roms/swf/<Game>/` folder. Nothing is uploaded; games get no internet access.
- **📱 Phone games (.JAR)**: J2ME games with freej2me-web, from your computer (its launcher) or `roms/j2me/<Game>/`. Needs internet: its Java runtime (CheerpJ) loads from Leaning Technologies.
- **🗝️ ScummVM**: point-and-click adventures from `roms/scummvm/<Game>/` (official ScummVM web build; engine files download from GitHub on first use and are checked against pinned hashes, kept in `cache/scummvm/`).
- **🖥️ PC (DOS / Win 9x)**: v86 boots your own .img / .iso disks (CD and floppy swaps, snapshots you can download and resume), or machines in `roms/x86/<Name>/`.

## 1.24.0 - 2026-11-17

Released as **Retro Hub 0.3.0** (fresh install).

### 🤝 Co-op ROM hacks (Project64)
- Pick a game from the server library in **Host a game**: when it's the base ROM of a known co-op hack, it says **✓ Recognized** and shows **🤝 Patch for co-op** next to it. One click sets the lobby up; when the game starts, the hub patches a copy (`cache/coop/`, your ROM is never changed), switches on the hack's Project64 cheats if it needs them, and plays it in **Project64**. Friends join as usual and play on the stream.
- Each online seat goes to the controller the hack reads (e.g. a hack where player 2 is controller 4), and seats a hack doesn't use stay out of the game.
- In the list (`core/coop-hacks.json`): **Super Mario 64 Splitscreen Multiplayer** (Kaze Emanuar, 2 players) and **Duke Nukem 64 co-op up to 4 players** (G. Allaux), both tested in Project64 3.0; **OoT Multiplayer 2P / 4P** (spinout182, cheat list by jmanx990 and Sho') for the Debug ROM with header 917D18F6-69BC5453 (not tested yet: the PAL Debug ROM crashes with it, so that one is refused with an explanation, as are retail OoT and already-patched builds).
- Retro Hub doesn't host or download patches. It finds them by checksum next to the ROM, in the console's folders (e.g. `N64/Patches/`) or in the hub's `patches/` folder (kept by the updater), or you add the file from the host form; a file that isn't a listed patch is refused.
- Patch formats: IPS, BPS, UPS and PPF. N64 dumps in any byte order (.z64, .v64, .n64) are recognized. Only the owner, on the hub's own PC.
- Project64 needs controllers 2-4 set to **Plugged in** (Options > Configure Controller Plugin) for friends' controllers.

### 🎨 Themes
- **🎨 Theme** in the top bar (in the ☰ menu on small screens): **Coal** (the original), **Midnight**, **Synthwave**, **Forest**, **Crimson**, **Pocket** (handheld green) and **Paper** (light mode). It applies to every Retro Hub page in that browser, including the sign-in page and the Shuffler, straight away and without a flash on load; other open tabs follow. Kept in your browser.

### Home button
- Click **Retro Hub** (top left) to get back to the home screen: on the hub page it goes to the **Play** tab at the top; in a lobby it asks first, then leaves the lobby; on the Shuffler page it goes back to the hub.

### Updater fixes
- **Fixed: updates failed with "The update zip doesn't look like Retro Hub"** when a release zip had its folder inside another folder (as the 0.2.5 zip does). The updater now finds the Retro Hub folder wherever it is in the zip.
- **Fixed: "Check for updates" could never tell whether a release was newer** on a fresh install. It now compares release numbers (this install's and the release's name, e.g. *RetroHub0.3.0*) and says *up to date* or offers the update.
- A damaged download now stops before any file is changed (everything is read and checked first), downloads can't be redirected away from GitHub, and `emulators/INSTRUMENTS.md` is updated too. `.retrohub-config.json` (first-run answers) is always kept.

### Off Site Games
- 5 more games, picked from the CC0 **AwesomeDecompGames** list (github.com/SubmitGame/awesome-decomp-games) and checked one by one with the same rules as before (free data, or your own game files): **Diablo** (diabloweb, free shareware or your own MPQ), **Halo: Combat Evolved** (your own Xbox disc image), **Half-Life / Counter-Strike 1.6** (WebXash, your own Steam files), **Quake** (NetQuake.io, free Episode 1 or your own pak1.pak) and **Doom multiplayer** (Silent Space Marine, shareware). Games that serve commercial game data themselves were left out.

### Fixes
- **No-Intro BIOS files** like `[BIOS] CX4 (World).zip` no longer show up as games in the SNES (and other) library.
- **Stop didn't close a native emulator that was stuck** (e.g. on an error pop-up) while a lobby was open: it now ends the program after 5 s if it doesn't close by itself.
- **Native emulators unpacked with Windows' "Extract All"** are found: the hub now looks two folders deep (e.g. `emulators/ryujinx/ryujinx-canary-…-win_x64/publish/Ryujinx.exe`).

### Known issue
- **PSP in the browser**: EmulatorJS's PPSSPP core starts and runs but can show a black screen (seen with Daxter). Every other browser console was booted with a real game for this release: NES, SNES, GB, GBC, GBA, Genesis, N64, DS, PS1, Sega CD, Saturn and arcade.

## 1.23.0 - 2026-11-16

Released as **Retro Hub 0.2.5** (fresh install).

### 🎸 Guitars and drum kits (Guitar Hero, Rock Band)
- **🎸 Instruments** (☰ menu, a lobby's *Sound, controls & stream*, the Shuffler): set a controller to **Guitar** or **Drums** and press each part once (frets / pads, strum, kick, Start, Star Power, whammy, tilt). Works with PS3, Wii and Rock Band / Guitar Hero dongles that browsers see as "non-standard"; Xbox 360 instruments usually work as they are. A live **Test** shows each part lighting up. Saved per device in your browser.
- Friends' instruments reach the host's PC as a virtual Xbox 360 controller laid out like a 360 guitar / drum kit, so they can be mapped to the emulated guitar or drums in **RPCS3, PCSX2 and Dolphin**: `emulators/INSTRUMENTS.md` has the button table and where to set it in each emulator. These games run in the native emulators only (EmulatorJS can't run PS2 / Wii / PS3 games).
- **Fixed: controllers could stop responding while the window was covered** (the browser stops drawing frames but still says the page is visible): gamepads are now polled every 50 ms whenever frames stop.

### Streamer Mode (Co-op Netplay lobbies)
- **Waiting room**: with *Streamer Mode* on (Match card), everyone who opens the invite link watches the stream in the waiting room and lines up for a seat. **Sit out** to just watch.
- **"You're up!"**: a free seat is offered to the next in line with a chime (and a notification in a background tab); **Take controller**, Enter or any gamepad button within 10 s, otherwise they're marked away and skipped (they can rejoin the line).
- **↻ Rotate seats** (button, in-game ↻, or **Ctrl+Shift+R** in the hub's tab) sends the seated viewers to the back of the line and offers their seats to the next ones. **👑** keeps a player (winner stays). Optional **turn timer** (3-30 min, 15 s warning; it only moves people on when someone is waiting).
- **Host controls per seat**: 🎮 mute that player's inputs (anything held is released), ⤺ send them back to the waiting room. When a seat changes hands its buttons are released, so nothing stays stuck.
- **Hide the code, invite link and passwords on my screen** blurs them (and your account ID) for streaming; copy buttons still work.
- **OBS overlay**: a Browser Source with `http://localhost:<port>/overlay/queue` shows *Now playing* (with turn time) and *Up next* on a transparent background. Only reachable from the hub's own PC; `?room=CODE`, `?side=right`, `?scale=1.5` optional.

### 🔀 Shuffle lobbies (Co-op) and the memory saver
- **🔀 Shuffle** is a mode in *Host a game*: pick 2-8 games (each one you pick is added to the list; consoles can be mixed), set the swap times, open the lobby. Friends join as usual and play P2-P4 on the stream; the host runs every game, so swaps can't get out of sync and guests need no files.
- Everyone sees which game is on (title and a banner at each swap); the host has ✓ Beaten (F8), ⤳ Swap (F9), ⏸ Hold (F10). The first game waits for GO. When all are beaten the chat says so with the time and swaps. Works with Streamer Mode and viewer effects.
- **Memory saver** (Shuffler and Shuffle lobbies, on by default): with 2 or more big consoles (PS1, N64, DS, PSP, Saturn, Sega CD, Jaguar, arcade) only one of them is loaded at a time; the others are saved and loaded again on their turn (a few seconds). Small consoles always stay loaded and swap instantly.
- The solo Shuffler and Shuffle lobbies share one engine (`public/shuffler-core.js`).

### 🔀 Shuffler (new, solo)
- **Shuffler** (link in *Host a game*, or `/shuffle.html`): load 2-8 games (your files, or the server library for the owner; consoles can be mixed). One plays; after a random 15-45 s (you choose) it freezes and another takes over exactly where you left it.
- **✓ Beaten** (F8) takes the game out of the pool, **⤳ Swap** (F9) swaps now, **⏸ Hold** (F10) stops swaps until pressed again. The last game left isn't swapped away. Beat them all for the win screen: total time, swaps, time in each game.
- Optional countdown (off = surprise swaps), swap sound, volume. Keyboard and gamepad work as in a lobby (P1).
- How: every game boots once in its own frame with its own emulator and is paused while it waits, so swaps are instant, need no save states, and different consoles mix freely. Big consoles (PS1, N64, DS…) use memory each; the page warns from 4.

### 🎲 Viewer effects (Streamer Mode)
- Turn on **Viewer effects** in the Streamer Mode box: viewers start with 3 points, earn 1 every 30 s while they're in the lobby (up to 30) and spend them in the **🎲 Effects** panel (lobby, or 🎲 in the match top bar). Works on any game, no game-specific setup.
- **Controls**: Invert controls, Swap A/B, Freeze controls. **Speed** (browser games): Double speed, Slow motion, Pause. **Rewind 10 s** (browser games; the host's page keeps a few snapshots). **Picture**: Upside down, Mirror, Black & white, Invert colors, Tiny screen (on everyone's view and the host's screen, so a stream captured from the host shows it).
- One effect per kind at a time, a cooldown per effect, one effect every 8 s per viewer; the host chooses which effects are allowed and can fire any of them for free to test. A banner on the game shows what's running and who sent it; chat logs it too.
- Native emulator games: control effects apply to guests' seats and picture effects to the hub page's view; speed, pause and rewind are browser-only.

### Quality of life
- **Fixed: the lobby chat and stream settings showed at the bottom of the hub page** (under the footer, unusable there) and made the page scroll sideways. They only appear in a lobby / match now.
- **Smaller top bar**: below 1100 px wide, *Keyboard shortcuts*, *Calibrate controllers*, *Library folders*, *Export account* and *Switch account* move into a **☰** menu (on a phone the bar went from about a quarter of the screen to two short rows); on phones 🏆 shows without its label.
- The 🏆 achievements panel closes with **Esc**, and the 👥 Friends and 🏆 panels no longer open on top of each other.
- The *Ghost mode* banner in a lobby wraps on phones instead of being cut off.

### Lobby Browser
- A **Lobby Browser** tab (next to *Play*) lists every lobby the hub knows in one table: this hub's, other hubs' on your network, and the shared lobby pool's. The tab shows how many there are.
- **Search** games, hosts and players (`Mario|Zelda` for either), filter by console, mode, minimum players, open seats, no password, not started, friends in it, or this hub only. Click a column to sort; lobbies with friends in them come first and are marked 👥. Click a row to see who's in it.
- **⏳ Wait for a seat**: on a full lobby (or from the join dialog when it says *full*), the page joins by itself the moment a seat opens, with a sound and a notification if the tab is in the background. Works with lobby passwords.
- **🔔 Alert me**: turns the current filters into an alert. When a new lobby like that opens you get a pop-up with Join, a sound, and (if you allow it) a system notification. Only lobbies that open after you turn it on count; it's kept in your browser and works while the page is open.

### Friends
- **👥 Friends** in the top bar: add a friend by their account ID (the *#XXXX-XXXX-XXXX-XXXX* next to their name), or press **＋ Friend** on a player in a lobby.
- Once you've **both** added each other you see them online on this hub, which lobby they're in and whether they're playing: **Join** opens the usual join dialog (password if the lobby has one). From your own lobby, **Invite** sends them a pop-up with a Join button (friends only, at most 6 a minute and once per 20 s per friend).
- Someone who added you shows under *Added you* (Add back / Ignore). **Appear offline** hides you from everyone.
- Lists are kept in your browser, per account; the hub only holds them in memory while the page is open, and works on this hub only.

### Off Site Games tab
- A new **Off Site Games** tab next to **Play**: games that run on other websites, by category, with search. Each one is an *Offsite* link (new tab, no referrer) and the tab says plainly that lobbies, netplay, saves and achievements don't apply there.
- The default list (`core/offsite-games.json`, 15 games checked one by one) has only free / open-source games, officially free data, or ports that use your own game files. Owners can use their own list: copy it to `offsite-games.json` in the main folder (the updater keeps it). Only `https://` links are shown; mark a game `"touch": true` to list it under *Phone / tablet friendly*.

### Internet mode opens on localhost
- With the Cloudflare Tunnel, the hub now opens **on localhost** for the host (window and `launch.py`): native emulators and Library folders only work from the hub PC's own address. Invite links still use the public address, and the window's **Copy link** copies it; the address line shows both.

## 1.22.0 - 2026-11-16

Released as **Retro Hub 0.2.3** (fresh install), together with 1.21.1 below.

### Desktop shortcut and the Retro Hub icon
- **Desktop shortcut on first run**: the Retro Hub window (or `launch.py` in a terminal: *Would you like to create a RetroHub desktop shortcut? (Y/n)*) offers a shortcut with the Retro Hub icon, once. The answer is kept in `.retrohub-config.json`. **Settings → Desktop shortcut**, `--create-shortcut` and `--setup` make one any time.
  - Windows: `RetroHub.lnk` on the real Desktop (also a OneDrive Desktop), opening `launch.bat`, with `retrohub.ico`.
  - Linux: `RetroHub.desktop` on the Desktop and in the app menu, with `retrohub.png`.
  - macOS: a small `RetroHub.app` on the Desktop, with `retrohub.icns`.
  - The path is shown afterwards, and the shortcut and its icon are checked on disk.
- **The Retro Hub icon**: the mascot, a red-and-white chibi duck in a purple bandana, in `assets/icon/` (SVG source, PNG sizes, `.ico`, `.icns`). It's on the shortcut, the Retro Hub window and the browser tab.

### Docs
- **README.md** is now a short start guide; the full guide (every setting, the scanner rules, the updater, security, internals) is **README-ADVANCED.md**.

### Updates
- **Update in place**: Retro Hub window > Server > **Check for updates** (also checked quietly when the window opens; `UPDATE_CHECK=off` turns that off). It installs the newest GitHub release into this folder and keeps everything that's yours: `.env`, library folders, hidden games, `emulators/` (your builds and `apps.json`), `roms/`, `cache/`. Every replaced file is copied to `backup/<date-time>/` first.
- Every update is safety-checked before anything changes: downloaded only from GitHub, SHA-256 against the checksum GitHub publishes, a Microsoft Defender scan, and a check of the zip itself. An older release isn't installed unless you say so.
- **What's new**: the first time a browser opens a new version, it shows what changed since the version it last saw.

### Library scanner: one entry per game
- **Disc games show one entry.** A `.cue`, `.ccd`, `.gdi` (Dreamcast) or `.m3u` (multi-disc) is the game; the tracks, subchannel and audio files it names (`.bin` `.img` `.sub` `.wav` `.raw` …) and the discs an `.m3u` lists are hidden. In the browser the hub sends such a game as one zip (built as it's sent), which EmulatorJS unpacks and boots. The size shown is the whole game's.
- **Wii U games extracted to a folder** show as one game named from `meta.xml` (or the folder), not every `.rpx` inside; their `[Update]` and `[DLC]` folders and archives aren't listed. `.wua` `.wux` `.wud` are listed as before.
- **Not listed any more**: BIOS and system files (`scph*.bin`, `gba_bios.bin`, `disksys.rom`, `syscard*.pce`, `neogeo.zip`, `pgm.zip` and other arcade BIOS sets), Switch updates and DLC (by title id), a 3DS `.cia` next to a `.3ds` / `.cci` of the same game, and `.zip` / `.7z` files in a console whose emulator can't open them (Cemu, PCSX2, Dolphin …).
- **Fixed: games missing from the library.** `.chd` games in the PS2, PSP and Saturn folders and `.rvz` games in the Wii folder were dropped (they were taken for PS1 / GameCube files). Each console now has its own list of game file types.
- **RetroAchievements**: library games in a `.zip` are matched by the ROM inside (header rules as before), and arcade sets by their name, as RetroAchievements does.

### Setup warnings
- The Server tab shows what would stop the hub finding games or emulators, with a button that fixes each: an emulators or ROM folder that's missing, empty or inside another Retro Hub folder; console folders that can't be reached (unplugged drive); consoles that share a folder.

### Library
- **Scan progress**: while the library is scanned for the first time, the Server library tab shows how many games it has found so far.
- **Favorites**: right-click a game (or press **F** on it) to star it. Favorites come first in every sort; they're kept in your browser.
- **Hide games** (owner): right-click > **Hide from the library** for BIOS files, duplicates and bad dumps. Nothing on disk changes; **Show hidden** brings them back. Hidden games aren't shown to anyone else. Saved in `library-hidden.json` (Docker: in the `/cache` volume).
- **Console is remembered**: pick melonDS for a DS game once and DS games default to it (with a note saying so). Picking the game's own console again goes back to the default.

### Playing together
- **↻ Play again** (host): back to the lobby with the same game and settings; everyone readies up again. Matches used to have no way back to the lobby. A game file picked on your own computer (the host's game, a Ghost / Race player's ROM) comes back too: it is kept in your browser during the reload, never sent anywhere.
- **Connection check**: joining a Co-op lobby with an estimated ping of 150 ms or more says so first, and suggests Ghost or Race mode when it's very high.
- **Rejoin after a reload**: reloading the page (or reopening a closed tab within 30 s) puts you back in your seat, and the host keeps their library game. Closing the tab no longer gives the seat up at once: it's held for 30 s like a dropped connection. **Leave** still frees it right away.

### Offsite links: speedrun.com and RetroAchievements
- **Leaderboards on speedrun.com** in the Race / Speedrun panel: opens the game's page on speedrun.com (world records, rules, run submission) in a new tab. The hub looks the game up through speedrun.com's public API only when you point at the link (or tab to it), sending just the game's name (region tags removed); if it can't find the game, the link opens speedrun.com's search.
- **RetroAchievements**: the 🏆 panel links to the game's page and your profile on retroachievements.org, and the 🏆 dialog has a sign-up link for players without an account.
- Links to other sites have their own look (an **Offsite · site name** tag, dashed border, ↗) so they can't be mistaken for part of the hub. They open in a new tab and don't pass on the hub's address.

## 1.21.1 - 2026-11-16

### Fixes
- **Native emulators weren't found after updating.** A `.env` copied from an older Retro Hub folder kept `EMULATORS_DIR` pointing at that folder's (now empty) `emulators/`. A configured emulators folder that is missing or empty now falls back to this install's `emulators/` (with a warning in the log).
- **Settings > Consoles… failed and emulator choices were ignored.** `apps.py` was missing the per-console emulator choice (`prefer` in `emulators/apps.json`) that the Consoles window reads and writes. It's back: the chosen emulator is used first when installed.
- **The hub froze while it scanned the library.** The scan read every folder synchronously, so a big library (or one on a network drive) stopped lobbies, chat and streams for as long as it took, every 30 s, and every native launch forced a full rescan. The scan now runs in the background (first one at startup), folders are read in parallel, and launches use the last scan (rescanning only for a game it doesn't know yet).
- **"Console" in Host a game now picks the emulator for library games.** Any console that takes the game's file type can be chosen: a GBA game in the browser or VBA-M, a DS game in the browser or melonDS. Consoles that can't run the picked game are greyed out. It used to work only for VBA-M link.

### Game Boy, Game Boy Color and GBA are separate consoles
- **Game Boy Color is its own console** with its own library folder (Settings > Consoles…, or Library folders in the hub). `.gb` / `.dmg` are Game Boy, `.gbc` / `.cgb` Game Boy Color, `.gba` GBA. A `.gbc` in the Game Boy folder is listed as Game Boy Color unless that console has a folder of its own.
- When two consoles share a folder (GBA and VBA-M link, DS and melonDS), each game is listed once, under the browser console; pick the native one under **Console** when hosting.
- Save states made for `.gbc` games before this update are under Game Boy; they don't show in Game Boy Color lobbies.

## 1.21.0 - 2026-11-16

### Setup: Retro Hub installs what it needs (Windows)
- **`launch.bat` checks for Python 3 and Node.js** before anything else. If one is missing it asks, then downloads it from python.org / nodejs.org, checks it and installs it, and carries on without a new window.
- **The Retro Hub window checks for Node.js and guest-controller support** (the ViGEmBus driver and the `vgamepad` Python package) when it opens, and offers to install what's missing. Saying No isn't asked again at startup; **Apps > Check requirements** runs the check any time.
- **Every download is safety-checked before it's used** (`setup/deps.ps1`): official host only, SHA-256 against the publisher's checksum (python.org, nodejs.org, PyPI; ViGEmBus publishes none), a valid publisher signature on installers (Python Software Foundation, OpenJS Foundation, Nefarius Software Solutions), and a Microsoft Defender scan. A failed check deletes the download and stops that item.

### Consoles window
- **Settings > Consoles…** (also in the Apps tab) opens one window with every console: pick the folder its games are in and, for native consoles, which emulator runs them, before starting the hub. Folders go to `library-folders.json` (the same file as the hub's **Library folders** menu), emulator choices to `emulators/apps.json` (`prefer`).
- The browser consoles' list moved from `server.mjs` to `core/browser-systems.json`, so the window and the server read the same list.

### Fixes
- **The window's Apps tab now uses the Emulators folder from Settings.** It always read `./emulators`, so emulators in a folder set in `.env` showed as not installed there (the hub itself found them).

## 1.20.0 - 2026-11-15

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
