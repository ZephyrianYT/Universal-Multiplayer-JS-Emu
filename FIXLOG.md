# Fix log: 1.26.1 (Retro Hub 0.3.4)

Sections 1-9 are the fixes up to 1.19.0. Section 10 covers 1.25.0 (released as 0.3.1), section 11 covers 1.26.0 (released as 0.3.3), section 12 covers 1.26.1 (released as 0.3.4).

## 12. 1.26.1 (Retro Hub 0.3.4)

- **Launch opened "freej2me-web … Loading…" instead of the hub.**
  - *Symptom:* on Windows with Firefox (fresh profile, or after clearing site data), pressing Start opened `http://localhost:8080` showing a grey page titled *freej2me-web* with "Loading…" that never finished. With an existing account and cache it could go unnoticed, so 0.3.3 shipped with it.
  - *Cause:* `server.mjs` listened on `HOST=0.0.0.0` (IPv4 only), and `launch.py port_free()` / `RetroHub.pyw port_open()` only connected to `127.0.0.1`. Browsers resolve `localhost` to `::1` first (Firefox always; Chrome/Edge on Windows). A second web server holding `[::1]:8080` (by the page it showed, a freej2me-web server: freej2me-web's own index page is that exact page) got every `localhost` request while the hub sat unused on IPv4, and no check could see it. The page stays on "Loading…" because, served from that program, freej2me's launcher never gets past start-up. The hub's own `/j2me/` route was not involved: it is only served under `/j2me/`, and `/` always gives `public/index.html` (checked in a browser).
  - *Change:*
    - `server.mjs`: `HOST` defaults to `::` (dual-stack); without IPv6 (`EAFNOSUPPORT`/`EADDRNOTAVAIL`) it falls back to `0.0.0.0`. With a loopback `HOST` (launcher's localhost-only and tunnel modes) a second listener on the other loopback address shares the request and WebSocket handlers. New public `GET /api/instance` (`{app, version, instance}`; the instance id is random per run, not a secret). After listening, `verifyLocalhost()` asks `127.0.0.1` and `::1` for it: refused / no such address is fine (browsers skip it), anything else that isn't this run stops the server with a message naming the address, the other program's page title, and `netstat`/`lsof` to find it. `EADDRINUSE` on either address gives the same message. The run file is written only after this check and now holds `instance` and `launch`. IPv4-mapped peers (`::ffff:1.2.3.4`) are normalised (`peerAddr`) for rate limits, nearby hubs and the link cable.
    - `launch.py`: `port_user()` checks `127.0.0.1` and `::1`; `wait_for_ready()` waits until the run file carries this launch's token (`RH_LAUNCH_ID`; not the PID, since a Node shim like volta or nvm runs node as a child) instead of only waiting for the port to open.
    - `RetroHub.pyw`: `port_open()` checks both addresses; `hub_answers()` requires `/api/instance` from Retro Hub (and the run file's instance) before showing "already running" or keeping the Open hub button live.
  - *Tested (Linux container, no IPv6 there, so the `::` → `0.0.0.0` fallback ran):* normal `launch.py` start (run file has `instance` and `launch`, `/` → login → hub in Chromium); another server already on the port → `launch.py` and `server.mjs` both refuse with the message; hub on `127.0.0.2` with a freej2me-web server on `127.0.0.1` → stops with *"it answers with a page titled "freej2me-web""*; `hub_answers()` true for the real hub, false for the other server and for a stale run file. Not tested on Windows or with a real IPv6 listener; the IPv6 path is the same code with `::1`.

- **Git checkout / Download ZIP missing shipped files.** *Cause:* `.gitignore` patterns `*.zip`, `*.bin`, `bios/`, `offsite-games.json` and `roms/*` also matched `public/j2me/init.zip`, `public/v86/seabios.bin`, `public/v86/vgabios.bin`, `core/offsite-games.json`, `bios/README.txt` and `roms/{j2me,scummvm,swf,x86}/.gitkeep`, which the release zips had. *Change:* exceptions for those paths (`/offsite-games.json` now only means the owner's file in the main folder); files added from the 0.3.3 zip. *Tested:* tracked files equal the 0.3.3 zip's file list (plus `docs/`); `git check-ignore` still ignores `roms/snes/game.sfc`, `bios/gba_bios.bin` and `offsite-games.json`.
- **Release automation.** `scripts/make_release.py` (tracked files under `retro-hub-<release>/`, fixed timestamps, refuses on version mismatch, missing CHANGELOG section or an untracked must-ship file) and `.github/workflows/release.yml` (manual run: syntax checks, build, unzip + `npm ci` + start the hub + `/api/instance` and `/` → 302, then `gh release create RetroHub<release>` with the CHANGELOG section; stops if the release exists). *Tested:* the built zip passes `setup/update.py safe_members`, and unzipped it installs and serves the hub; the workflow file parses. The workflow itself first runs on GitHub.
- **Phone layout / first visit.** *Causes:* `aim.js` opened the Buddy List on load unless it had been closed before (`aimBlOpen !== false`), 250×470 px over a 390 px screen; the hub tab row (`.tabs` buttons, `white-space: nowrap`, 12 px padding) was 394 px wide. *Changes:* auto-open when `aimBlOpen === true`, or on a first visit with `innerWidth >= 1400`; `.hub-tabs` scrolls instead of widening the page and uses 9 px padding under 480 px. *Tested (Chromium, iPhone 13 and 1280/1500 px):* no element wider than the page on the hub, J2ME, Flash, ScummVM, PC and Shuffler pages; Buddy List closed on a phone's first visit, open after tapping it and after a reload, open on a 1500 px first visit.
- **403 on every hub load.** *Cause:* `online.js` asks `GET /api/online` to decide whether to show 🌐, and non-owners got 403. *Change:* 200 `{available:false, reason}`; `online.js` treats it as "no button". POST routes still 403. *Tested:* no console errors on any page for a player; the owner (unlocked, on localhost) still gets the data and the 🌐 button.
- **Sign-in Back button** hidden when the browser has no accounts.
- **Port taken: offer another one (window).** `RetroHub.pyw`: `TAKEN_RE`/`TITLE_RE` catch the launcher's and server's "Port N is already … by another program" lines; when the server then exits non-zero, `offer_other_port()` finds the next port free on both loopback addresses, asks, writes `PORT` to `.env` (other settings kept), updates the Settings field and starts. *Tested:* both messages parsed (port and title); with 8140 and 8141 taken it chose 8142, wrote only `PORT`, and started (dialogs stubbed: no display in the test container).

## 11. 1.26.0 (Retro Hub 0.3.3)

- **Cemu folder rule.** *Cause:* the Pretendo check counted `otp.bin`/`seeprom.bin` next to Cemu.exe, but Cemu 2.x reads them from its data folder only: `portable/`, else (Windows) the exe folder when a `settings.xml` is next to it (old portable layout), else `%APPDATA%\Cemu` (`src/gui/wxgui/CemuApp.cpp DeterminePaths`). *Change:* `apps.py cemu_paths` follows that rule; files next to Cemu.exe that Cemu doesn't read are reported with a Copy button. *Tested:* both layouts on scratch copies.
- **Online mode switch ignored.** *Change:* `<Account><OnlineEnabled>` is checked and set together with the per-account `SelectedService` and the old `ActiveService`. *Tested:* scratch copy.
- **New POST routes answered 405.** *Cause:* POST handlers placed after the GET-only gate in `server.mjs`. *Change:* moved before it. *Tested:* the Online panel's Cemu buttons.
- **Theme cards overflowed.** *Cause:* the global button `white-space: nowrap`. *Change:* `.theme-card` wraps.

## 10. 1.25.0 (Retro Hub 0.3.1)

- **ScummVM couldn't find its data.** *Cause:* the ScummVM web build asks for its virtual `/data` folder at the site root (`/data/index.json`), where EmulatorJS's files also live, and asks for engine plugins as `/scummvm//data/plugins/…`. *Change:* `/data/…` requests that come from the ScummVM page (Referer) go to ScummVM, everything else stays EmulatorJS's; leading slashes after `/scummvm/` are dropped. *Tested:* Flight of the Amazon Queen detected and its intro played; EmulatorJS's `loader.js` / `emulator.min.js` still load from hub pages.
- **J2ME pages stuck on "Loading…".** *Cause:* CheerpJ also loads a stylesheet and a frame from its host, which the CSP blocked, and its frame sends no COEP header, which `require-corp` blocks. *Change:* for `/j2me/*` only, the CSP allows CheerpJ's host for scripts, styles, workers, connections and frames, and COEP is `unsafe-none`. *Tested:* God of War Betrayal boots to its audio prompt.
- **Flash page: the Ruffle link showed as a big block mid-sentence.** *Change:* plain link. *Tested:* in the pane.
- **Messenger group headers were centered.** *Cause:* the hub's global button style. *Change:* `justify-content: flex-start` on `.aim-ghead`.

Fixes since 1.7.0 (1.8.0: sections 1-3; 1.19.0: sections 4-9), with the cause, the change and how each was tested. The user-facing summary is in CHANGELOG.md.

## 1. Quotes in emulator launch options broke the game path

- **Symptom:** an emulator added with `apps.py` (for example Xenia with launch options `--fullscreen "{game}"`) opened without a game, or showed a "file not found" error.
- **Cause:** `apps.py` split the typed options on spaces and kept the quote marks. The program is started with an argument list, and Windows quotes each argument itself, so the emulator received the quotes as part of the path (`"Z:\Games\Halo 3.iso"`, quotes included).
- **Fix (`apps.py`):** new `unquote()` and `split_args()`. Typed options are split with quoted parts kept together (backslashes untouched), and the outer quotes are removed. `build_command()` also cleans entries already saved in `emulators/apps.json`, so existing setups work without being re-added.
- **Tested:** a stand-in emulator registered with `--fullscreen "{game}"` and launched on `My Games/Halo 3 (USA).iso` received exactly `--fullscreen` plus the path as one clean argument. An `apps.json` entry with literal `"{game}"` and `'--fullscreen'` gave the same result.

## 2. The page didn't notice when the emulator closed

- **Symptom:** if the emulator crashed on start, was closed, or the game quit, the host's page kept saying "Share the window" with no error.
- **Cause:** the runner (`apps.py run`) reported `exited` with the exit code, but the server only logged it, and the page never asked again after the launch.
- **Fix:**
  - `core/streaming/native.mjs`: a program that closes by itself is recorded as `lastExit` (`name`, `emulator`, `code`, `at`, `quick`), and `running` is cleared at once. `quick` means it closed within 10 seconds of starting. `GET /api/native` returns it. A new launch clears it.
  - `public/app.js`: `watchExit()` asks `/api/native` every 3 seconds while the program runs. When it has closed, the loading board shows the error and exit code with **Retry**. A quick close says it probably can't open the file or needs setup (BIOS, keys, first-run settings). Leaving the lobby stops the check.
- **Tested:** the server module with the stand-in emulator exiting with code 3: `running` became `null` and `lastExit` was `{ code: 3, quick: true }`. The browser side was syntax-checked; the full lobby flow was not clicked through.

## 3. Xbox 360 `.zar` files weren't listed

- **Cause:** the Xbox 360 console only knew `.xex` (plus `.iso` and other shared extensions inside an `xbox360` folder).
- **Fix (`core/runner/catalog.json`):** `.zar` added. Xenia Canary opens it.

## 4. Xbox (xemu) wasn't found

- **Cause:** the catalog only looked in `emulators/xemu/`; the usual folder name is `emulators/xbox/`, so the console showed as not installed and "Check for Emus" listed `xbox` as an unknown folder.
- **Fix (`core/runner/catalog.json`):** xemu is looked for in `xemu/`, `xbox/` and `originalxbox/`. Xbox game folders also match `xboxog` and `xemu`.
- **Tested:** `python apps.py status` shows xemu installed from `emulators/xbox/xemu.exe`; `MicrosoftXbox/Xbox/Games/x.iso` is Xbox and `MicrosoftXbox/Xbox360/Games/x.iso` stays Xbox 360.

## 5. melonDS / Azahar (community report)

- **Cause:** melonDS wasn't in the catalog at all, and a melonDS build renamed to `Azahar.exe` counted as Azahar (it would then be launched with 3DS games).
- **Fix:**
  - `apps.py`: emulators can list `product` names. On Windows the exe's ProductName must match when it has one, and an exe with a matching ProductName is found in any `emulators/` subfolder whatever its file name.
  - `catalog.json`: new **melonDS** emulator and **Nintendo DS (melonDS)** console (`ndsnative`). `.nds` files still play in the browser by default; games in a `melonDS` / `ndsnative` folder (or that console's library folder) run in melonDS. `.dsi`/`.srl` go to melonDS. Azahar also checks `3ds/`, `n3ds/`; `.3dsx` added.
  - `server.mjs`: the first console to claim an extension keeps it, so a native alternative never takes over a browser console's files.
- **Tested:** status shows melonDS installed (found by ProductName in `emulators/Azahar/`), Azahar not installed.

## 6. Guest controllers plugged in after the emulator had started

- **Cause:** the virtual pads were created when the host pressed "Share the window", after the emulator booted. Emulators that don't hot-plug (xemu, melonDS, Dolphin bindings) never saw P2-P4.
- **Fix:** the host page opens the input bridge before launching; `input_bridge.py` prints `{"t":"pads"}` once the pads exist and `native.mjs` sends `ready` only then. The page waits for it (9 s max) before starting the emulator.
- **Tested:** bridge prints the pads line in keyboard mode. Gamepad mode not tested here (vgamepad/ViGEmBus not installed on this PC).

## 7. LAN lobby discovery and master lobby pool (new)

- `core/net/discovery.mjs`: while a hub has lobbies it multicasts a beacon to `239.255.43.21:37115` every 5 s (TTL 1). Hubs keep others' lobbies for 15 s; the join link is built from the packet's source IP, never from its contents. Shown under **Other hubs nearby**, only to browsers on a private network. `LAN_DISCOVERY=0` turns it off; loopback-only hubs (tunnel mode) listen but don't send.
- Master pool: `MASTER_SERVER_URL=<origin>` sends heartbeats (needs `PUBLIC_URL`) every 30 s and reads the pool's list while the lobby page is open. `MASTER_SERVER=1` makes a hub serve `POST /api/master/heartbeat` and `GET /api/master/lobbies` (in memory, 90 s expiry, 5 hubs per IP, 1000 max).
- **Tested:** two discovery instances on this PC saw each other's lobby over multicast, closing it cleared it at once; heartbeat + pool list through a running server with `MASTER_SERVER=1`. Two physical PCs not tested.

## 8. GBA link cable sessions (VBA-M, new)

- Each player runs their own Retro Hub and their own copy of the ROM in **VBA-M** on their own PC (same network). Only link-cable traffic crosses the network, directly between the VBA-M instances (TCP 5738, `LINK_PORT`).
- `core/runner/catalog.json`: **VBA-M** emulator (`emulators/vbam/`, also found by ProductName) and console **Game Boy Advance (VBA-M link)** (`gbalink`, folders `vbam`/`gbalink`). Its `link` block adds `GBA/LinkType=1 GBA/LinkProto=0 GBA/LinkHost=… GBA/LinkPort=… preferences/LinkNumPlayers=…` (VBA-M reads `NAME=VALUE` arguments as settings). VBA-M also saves them to its own `vbam.ini`.
- `apps.py run --link host=… port=… players=… role=…` (values checked); a path containing `=` is refused for VBA-M (it would be read as a setting).
- `core/net/link.mjs` + `server.mjs`: host (P1, server) picks a .gba game and 2-4 players; the session goes out in the LAN beacon with the ROM's SHA-1 and size. A joining hub finds the same ROM by SHA-1 in its own library, claims P2-P4 from the host's hub (`POST /api/link/claim`, direct LAN connections only, 30/min per address), and starts VBA-M as a client pointed at the host's IP. Closing VBA-M ends/leaves the session.
- Page: **GBA link cable** panel (owner on the hub PC) and **Join link** on link sessions under *Other hubs nearby*.
- **Limit:** VBA-M can't start a network link by itself (its "link at boot" option rejects network modes), so each player still opens Options > Link > Start Network Link and presses Start/Connect; everything is pre-filled. VBA-M numbers link players by connection order.
- **Tested:** seat logic (re-claim, wrong ROM, full, release), link data through LAN discovery, endpoint refusals on a running server, `apps.py` command line with a stand-in exe. Not tested: real VBA-M, two PCs, the browser panel.

## 9. Pretendo Network for Wii U (Cemu, new)

- Cemu 2.0+ has Pretendo built in (network service 2, stored as `<AccountService><SelectedService PersistentId=… Service="2"/>` in `settings.xml`; its account server is `account.pretendo.cc`). No hosts-file, DNS or proxy change is needed or made.
- `apps.py pretendo-status`: finds Cemu's data folder (`<exe>/portable/` or `%APPDATA%\Cemu`), checks `otp.bin`, `seeprom.bin`, the active account's `account.dat` (and its network ID / PNID), the selected service, and flags a Cemu 1.x install. Returns `ready` and a list of problems in plain words.
- `apps.py pretendo-enable`: sets the active account's service to Pretendo; keeps `settings.xml.bak-retrohub` first. Only on the owner's request (**Use Pretendo** on the warning), and refused while Cemu runs.
- `server.mjs`: `GET /api/pretendo`, `POST /api/pretendo/enable` (owner on the hub PC). Wii U lobbies whose host is Pretendo-ready carry `netplay_mode: "pretendo"` in LAN beacons and master-pool heartbeats, shown as a **Pretendo** badge.
- Page: hosting a Wii U game checks readiness first and says either "online through Pretendo as <PNID>" or what is missing; local co-op through the hub works either way.
- **Not done:** 3DS (Azahar 2126+ supports Pretendo's Nimbus URL rules inside the emulated system; nothing to set from outside). Pretendo friend codes / room tokens: matchmaking happens inside the game on Pretendo's servers and has no public room API, so the pool only shows the badge.
- **Tested:** status on this PC (reports Cemu 1.x, missing dumps, no settings.xml) and on a mock portable Cemu (Nintendo -> enable -> Pretendo, ready, backup written); endpoint refusals on a running server. Not tested: real Cemu 2.x online.

## Checked, no change needed

- **Paths with spaces:** already passed correctly (argument list, no shell).
- **Working folder:** emulators already run from their own `.exe` folder, so Xenia finds its config.
- **Process tracking:** the runner already holds the emulator and everything it starts in a Windows Job Object, and Stop closes the windows politely.

## Files changed

`apps.py`, `core/streaming/native.mjs`, `core/streaming/input_bridge.py`, `core/net/discovery.mjs` (new), `core/net/link.mjs` (new), `server.mjs`, `public/app.js`, `public/index.html`, `public/style.css`, `core/runner/catalog.json`. Version 1.8.0 in `package.json`, `package-lock.json`, `Dockerfile` and `docker-compose.yml`. `CHANGELOG.md`, and this file.
