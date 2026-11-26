> **RetroDuck 0.4.6 is out:** 🐣 **Ducklings**: run more RetroDuck servers from one folder, each on its own port, for more lobbies at once, sharing your library and sign-in. New for LAN parties and switched off unless you turn them on: 🖥 one play station per monitor with its own controller, and 🦆 **MommaDock**, a board of every duck on your network that can adopt PCs and start their stations. Use the updater or download `RetroDuck0.4.6.zip` from Releases.

# RetroDuck

**Play retro games with your friends from a link.** You run RetroDuck on your PC, friends open the link in their browser, and you play together: co-op, races, or side by side as ghosts. Nothing to install for your friends, and no games are ever uploaded anywhere.

- 🎮 **Browser consoles**: NES, SNES, N64, Game Boy, Game Boy Color, GBA, DS, PS1, PSP, Genesis, Saturn, arcade and more.
- 🖥️ **Big consoles** (PS2, GameCube, Wii, Wii U, Switch, 3DS, Xbox, Xbox 360, PS3, Dreamcast, arcade…) and **Android games** run in real emulators on your PC and stream to your friends.
- 🏁 **Race / speedrun mode**, 🏆 **RetroAchievements**, voice chat, save states, a 👥 buddy list, and a link cable for GBA.
- 📺 **Made for streaming**: an OBS overlay that shows the game, the players and your Twitch / YouTube chat, with viewer effects chat can trigger.
- 🔒 **Private by design**: your games stay on your PC, accounts live in each player's browser, and the hub's private tools only answer to your own computer.

---

## How it works

RetroDuck has two halves:

1. **The hub** runs on your PC (the one with the games). It's a small web server: it serves the website, keeps the list of lobbies and introduces players to each other. You start and stop it from the **RetroDuck window**.
2. **Everyone's browser** is the actual game machine and screen. There's nothing to install for players: a link and a browser are enough, on PC, Mac, tablet or phone.

When you play together, the hub only does the introductions. The game itself goes **straight between the players' browsers** (WebRTC, the same tech as video calls), so it's as fast as your connections allow and the hub never has to carry the video.

There are three ways to play a game together, and you pick one when you host:

| Mode | What happens | Pick it when |
| --- | --- | --- |
| **Co-op** | The host's browser runs the game and streams the picture and sound to everyone. Friends' controllers drive players 2-4. | You want to play *one* game together, like on a couch. Friends don't need the game. |
| **Ghost** | Everyone runs their own copy of the same game, side by side. Other players show as see-through ghosts over yours. | Single-player games, playing "together" with no lag at all. Everyone needs the game. |
| **Race / Speedrun** | Ghost mode plus one shared timer, splits and results. Alone, it's a speedrun timer with personal bests. | Racing friends, or practising runs. |

**Big consoles** (PS2 and newer) are too heavy for a browser, so they run in a real emulator on your PC. The hub starts it for you, your browser captures its window, and from then on it streams to friends exactly like a Co-op game.

## Why it works this way

- **Your games never leave your PC.** In Co-op, friends get a video stream, not the game file. In Ghost and Race, each player uses their own copy, and only a checksum is compared to make sure it's the same game.
- **No accounts on a server.** Your account is a key made and kept by your browser. Signing in proves you have the key; there is no password database to leak. Keep a backup with **Export account**.
- **Nothing for friends to install** means anyone with a link can join in a minute, and there's no software on their side to update or trust.
- **Your PC isn't opened up.** The owner's tools (emulators, library folders, the OBS overlay and its controls) only work from your own computer, and are checked several ways so other websites or the internet can't reach them.
- **The trade-off:** in Co-op, every button press travels to the host and the picture travels back, so far-away friends feel some delay. That's what Ghost and Race are for.

---

## The RetroDuck family

RetroDuck grew from one hub into a small family of parts that work together, from one PC on your desk up to a LAN party with a dozen screens. These are the words we use for them:

| Word | What it is | Closest real-world example | |
| --- | --- | --- | --- |
| 🦆 **Duck** (a hub) | RetroDuck running on a PC: the website, your library, your lobbies. Your everyday one is the **main hub**. | Hosting your own game server for friends, like a Minecraft server, but for retro games. | ✅ |
| 🐣 **Duckling** | An extra RetroDuck server started from the same folder, on its own port: more lobbies at once, with the same library and the same sign-in. | Opening more tables in the same arcade: one building, separate games. | ✅ |
| 🖥 **Station** | A duckling with its own screen and its own controller: one full-screen window per monitor. | An arcade cabinet: one screen, one stick, one game. | 🧪 |
| 🎮 **Player mode** / **Seat mode** | How a station gets its player 1: you sign in and press A (player mode), or a fixed controller always plays there (seat mode). | Signing in to your profile on a console / walking up to an arcade machine. | 🧪 |
| 🔀 **Pad router** | The small helper that sends each controller to its own station, even when another window has focus. | A switchboard operator putting each call through to the right desk. | 🧪 |
| 📡 **Presence** | A duck saying "I'm here" on the network every few seconds, even when idle. Off for a normal hub. | The green "online" dot in a chat app. | 🧪 |
| 🦆👑 **MommaDock** | The boss duck, usually in Docker on a NAS: one board of every duck and duckling on the network, and the one that adopts PCs and starts their stations. | The main unit of a mesh Wi-Fi system, or an airport's control tower. | 🧪 |
| 🐣🔗 **Duckling node** / **adoption** | A PC a MommaDock has adopted, after both screens showed the same 6-digit code. The MommaDock can then start and stop its stations, nothing else. | Adding a satellite to a mesh Wi-Fi system, with a pairing code like Bluetooth. | 🧪 |
| 🌊 **Pond** | A public join site for an event: people scan a QR code and play on their own phone or laptop. | A venue's guest Wi-Fi page, or a party game you join by scanning a code. | 🗺 |
| 🪺 **Flock** | Your friends: mutual buddies from the Buddy List, with friends-only high score boards. | A friends-only leaderboard on a console. | 🗺 |
| 🎒 **LanParty** | The event kit: a checklist and scripts for several PCs × stations plus a MommaDock, fully offline. | A stage crew's road cases and run sheet. | 🗺 |
| 🌊🦆 **SeaDuck** | RetroDuck's own website. | A project's home page. | 💡 |

✅ works · 🧪 in 0.4.6, **off until you switch it on**, tested on one PC with test servers but not yet with real controllers, several PCs or a NAS · 🗺 planned · 💡 idea. The details for each: [The RetroDuck family](README-ADVANCED.md#the-retroduck-family-words-used-in-this-guide) in the advanced guide.

---

## Get started (Windows)

1. **Unzip** `RetroDuck0.4.6.zip` anywhere (for example `C:\Games\RetroDuck`).
2. **Double-click `launch.bat`.**
   - Missing Python or Node.js? It offers to download and install them for you, and checks every download first.
   - It asks whether you want a **desktop shortcut** with the RetroDuck duck. Say yes, and next time just click the duck.
3. In the RetroDuck window, press **▶ Start**. Your browser opens the hub.
4. Type a name to **make your account** (one click, no password). Then **Export account** from the top bar and keep the file somewhere safe: it's the only way to move or restore your account.

**macOS / Linux:** install Python 3 and Node.js 18+, then run `python3 RetroHub.pyw` (or `./launch.sh`) in the folder. **Docker / NAS:** see the [advanced guide](README-ADVANCED.md#10-docker-and-nas).

## Add your games

- Put games in the **`roms`** folder, one folder per console: `roms/snes`, `roms/gba`, `roms/psx`…
- Or point each console at the folder your games are already in: **Settings → Consoles…** in the RetroDuck window.
- In the hub, press **Unlock library** and enter the owner password (in the window: **Settings → Owner password → Show**).

Disc games show up once (the `.cue` or `.m3u`, not every track), and BIOS files are left out on their own. Friends can also play a game file from their own computer; it stays on their computer. How the library decides what's a game: [The ROM library](README-ADVANCED.md#7-the-rom-library).

## Play with friends

1. **Host a game**: pick a mode (**Co-op**, **Ghost**, **Race / Speedrun** or **🔀 Shuffle**), pick a game, press **Open lobby**.
2. **Copy invite link** and send it to your friends. Set a lobby password if you like (send it separately).
3. When everyone is ready, press **Start match**. After the game, **↻ Play again** brings everyone back to the lobby.

**Friends on the same Wi-Fi** can use the *Copy Wi-Fi link* button. **Friends anywhere** need the Internet mode: in the window, pick **Internet (Cloudflare Tunnel)** before pressing Start. It's free, no account needed. The hub still opens on localhost for you; invite links use the public address. More: [Playing over the internet](README-ADVANCED.md#9-playing-over-the-internet).

In a match: **/** to chat, the 🎙 button for voice, **F2** / **F4** to save and load (co-op host), **📶 Stream** to change the quality. Every shortcut: the **⌨** button.

## Big consoles (PS2, GameCube, Switch…)

1. Drop a portable build of the emulator into its folder in `emulators/` (for example `emulators/pcsx2/`). You supply BIOS, firmware and keys yourself.
2. Press **Check for Emus** in the hub: it shows which ones it found.
3. Host the game from the hub on your own PC. The first time, a short **setup check** says if anything is missing and sets up controllers for your friends (without touching your own settings).
4. When the match starts, press **Share the window** once.

Every emulator, its folder and its quirks: [emulators/README.md](emulators/README.md). How it works: [Native emulators](README-ADVANCED.md#8-native-emulators-and-pc-games). Online play in the emulators themselves (Pretendo, RPCN, Insignia…): the **🌐 Online** button and [Online services](README-ADVANCED.md#online-services).

## Streaming

Turn on **Streamer Mode** in a Co-op lobby: viewers wait in line and take turns in the seats (↻ Rotate, 👑 winner stays, optional turn timer), and 🎲 **viewer effects** let them spend points on things like inverted controls or an upside-down screen.

For OBS: **☰ → 📺 OBS overlay** gives you one Browser Source URL with **the game itself**, the players, a clock, pop-ups and your **Twitch or YouTube chat** (read-only, no login), where chat can fire effects with `!flip`, `!mirror`… There's also a control dock for OBS and a 🪟 **pop-out window** for apps that capture a window instead. Full guide: [docs/OBS-STREAMING.md](docs/OBS-STREAMING.md).

## More screens and LAN parties (new)

Everything here is **off until you switch it on**; a normal hub works exactly as before. It is new, so tell us how it goes.

1. **Ducklings**: more lobbies from one PC. `python launch.py --instance duck1 --port 8081` starts one; `python stop.py --list` shows what is running, `python stop.py --instance duck1` stops it.
2. **Stations**: one play station per monitor. `python stations.py init --count 2` writes `stations.json`, `python stations.py start --windowed` opens them in normal windows the first time (sign in once on each), then `python stations.py start` runs them full screen. Each station's controller is its player 1, even while another window has focus (Xbox-style controllers; others through Steam Input).
3. **MommaDock**: on your NAS (Unraid: Docker on `br0`) or any PC, set `MOMMADOCK=1`. The owner gets ☰ Menu > 🦆 **MommaDock**: every duck on the network, up / down / stopped, who is playing.
4. **Duckling nodes**: on each event PC set `RH_NODE=1`. It shows up on the MommaDock with a 6-digit code: **Approve** there, then **Accept** on the PC (☰ > 🐣 Duckling node) if it shows the same code. From then on the MommaDock can start and stop that PC's stations.

The full how-to, and how each part is kept safe: [Ducklings](README-ADVANCED.md#-ducklings-more-servers-from-one-folder), [Stations](README-ADVANCED.md#-stations-several-screens-on-one-pc), [MommaDock](README-ADVANCED.md#-mommadock-the-nas-as-the-boss-of-your-retroducks), [Duckling nodes](README-ADVANCED.md#-duckling-nodes-adopt-a-pc-then-run-its-stations-from-the-mommadock).

## More to try

| Feature | Where | Read more |
| --- | --- | --- |
| 🔀 **Shuffler**: 2-8 games, it jumps between them at random right where you left each one | link under *Host a game*, or the 🔀 Shuffle mode | [Shuffler](README-ADVANCED.md#shuffler) |
| 🏆 **RetroAchievements**: progress and unlocks in the match | 🏆 in the top bar | [RetroAchievements](README-ADVANCED.md#retroachievements), [docs/ACHIEVEMENTS.md](docs/ACHIEVEMENTS.md) |
| 👥 **Buddy List**: a classic messenger: see who's on, IM, join their lobby | 👥 in the top bar | [Buddy List](README-ADVANCED.md#buddy-list-messenger) |
| 🔎 **Lobby Browser**: every lobby here and on nearby hubs, ⏳ wait for a seat, 🔔 alerts | tab next to *Play* | [Lobby Browser](README-ADVANCED.md#lobby-browser) |
| 🩹 **Patcher**: translations, hacks, randomizers, co-op patches (makes a copy, never changes the original) | *Patches & variants* when you pick a library game | [Patches and the Patcher](README-ADVANCED.md#patches-variants-and-the-patcher) |
| 🤝 **Co-op ROM hacks**: 2-4 player N64 hacks, set up in one click | *Host a game* with a known N64 ROM | [Co-op ROM hacks](README-ADVANCED.md#co-op-rom-hacks) |
| 🎸💃 **Guitars, drum kits, dance mats** for friends over the stream | 🎸 Instruments (☰) | [Guitars, drums, dance mats](README-ADVANCED.md#guitars-drum-kits-and-dance-mats) |
| 🎞️📱🗝️🖥️ **Flash, phone games, ScummVM, DOS / Windows 9x** | Off Site Games tab | [Hub players](README-ADVANCED.md#hub-players-flash-phone-games-java-applets-scummvm-and-pc) |
| 🔗 **Link play**: GBA link cable, Four Swords GBA screens, Xbox 360 System Link | *Play* tab panels | [GBA link](README-ADVANCED.md#gba-and-game-boy-link-cable-vba-m), [GBA screens](README-ADVANCED.md#four-swords-adventures-gba-screens), [System Link](README-ADVANCED.md#xbox-360-system-link-rooms) |
| 🎨 **Themes**: 14 looks, launcher styles, or make and share your own | 🎨 Theme in the top bar | [Themes and emotes](README-ADVANCED.md#themes-and-emotes) |

## Staying up to date

The RetroDuck window checks for new versions when it opens. Press **Update…** (or **Check for updates**): your settings, games and emulators are kept, replaced files are backed up first, and the download is checked before it's installed. What changed: [CHANGELOG.md](CHANGELOG.md).

## Support RetroDuck

RetroDuck is free and made by **Zephyrian**. If it brings you and your friends some fun:

- ☕ [Support it on Ko-fi](https://ko-fi.com/zephyrian)
- ▶ [Zephyrian on YouTube](https://www.youtube.com/@Zephyrian1st)

## Need help?

| Problem | Try this |
| --- | --- |
| The library tab is missing | Press **Unlock library** and enter the owner password. |
| A friend can't connect | Use the Internet (Cloudflare Tunnel) mode, or see *TURN* in the [advanced guide](README-ADVANCED.md#9-playing-over-the-internet). |
| The game lags for a friend far away | Try **Ghost** or **Race** mode (no lag), or lower **📶 Stream** quality. |
| The hub link opens some other page (for example "freej2me-web … Loading…") | Another program uses the same port. RetroDuck refuses to start and names it; close it or change **Port** in **Settings**. |
| An emulator shows ✖ | The window shows a **Setup needs a look** box with a fix button. |
| A game is missing from the library | Check its folder in **Settings → Consoles…**, and **Show hidden** in the library. |
| Lost your account | Import the file from **Export account** on the sign-in page. Without one, make a new account. |
| A duckling says it can't change library folders | That's on purpose: change them on the main hub; ducklings follow within a few seconds. |
| A station ignores my controller | The pad router reads Xbox-style controllers; use Steam Input (or DS4Windows) for others. In player mode, sign in first, then press A. |
| A PC never shows up on the MommaDock | Both must be on the same network, the PC needs `RH_NODE=1`, and on Unraid the MommaDock container must be on `br0` (Docker's default network can't hear the other ducks). |

**Where to find everything else**

| You want… | Go to |
| --- | --- |
| Every setting, the window's tabs, the command-line launcher | [Advanced guide §4-5, §11](README-ADVANCED.md#4-the-retroduck-window-launcher-and-admin-panel) |
| How lobbies, streaming, input and accounts work inside | [Architecture](README-ADVANCED.md#1-architecture-at-a-glance), [Internals](README-ADVANCED.md#13-internals-api-websocket-protocol-webrtc) |
| What's protected and how | [Security model](README-ADVANCED.md#12-security-model), [docs/SECURITY-LOCAL.md](docs/SECURITY-LOCAL.md) |
| Docker / NAS | [Docker and NAS](README-ADVANCED.md#10-docker-and-nas) |
| Ducklings, stations, MommaDock, nodes | [The RetroDuck family](README-ADVANCED.md#the-retroduck-family-words-used-in-this-guide) |
| Where files live, what to back up | [Files and folders](README-ADVANCED.md#14-files-and-folders) |
| More fixes | [Troubleshooting](README-ADVANCED.md#15-troubleshooting), [FIXLOG.md](FIXLOG.md) |

---

RetroDuck contains no games, BIOS files or keys. Only play games you own. GPL-3.0, see [LICENSE](LICENSE).
