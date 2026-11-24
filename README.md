> **RetroDuck 0.4.4.4 is out:** 🌍 one-switch **Internet link** for friends anywhere (no router setup), Check for Emus finds emulators you installed with their installers, a backup-file step for new accounts, drag-and-drop games, plus 0.4.4.3's new 🦆 RetroDuck look. Use the updater or download `RetroDuck0.4.4.4.zip` from Releases.

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

## Get started (Windows)

1. **Unzip** `RetroHub0.4.4.2.zip` anywhere (for example `C:\Games\retro-hub`).
2. **Double-click `launch.bat`.**
   - Missing Python or Node.js? It offers to download and install them for you, and checks every download first.
   - It asks whether you want a **desktop shortcut** with the RetroDuck duck. Say yes, and next time just click the duck.
3. In the RetroDuck window, press **▶ Start**. Your browser opens the hub.
4. Type a name to **make your account** (one click, no password). Then **Export account** from the top bar and keep the file somewhere safe: it's the only way to move or restore your account.

**macOS / Linux:** install Python 3 and Node.js 18+, then run `python3 RetroHub.pyw` (or `./launch.sh`) in the folder. **Docker / NAS:** see the [advanced guide](docs/README-ADVANCED.md#10-docker-and-nas).

## Add your games

- Put games in the **`roms`** folder, one folder per console: `roms/snes`, `roms/gba`, `roms/psx`…
- Or point each console at the folder your games are already in: **Settings → Consoles…** in the RetroDuck window.
- In the hub, press **Unlock library** and enter the owner password (in the window: **Settings → Owner password → Show**).

Disc games show up once (the `.cue` or `.m3u`, not every track), and BIOS files are left out on their own. Friends can also play a game file from their own computer; it stays on their computer. How the library decides what's a game: [The ROM library](docs/README-ADVANCED.md#7-the-rom-library).

## Play with friends

1. **Host a game**: pick a mode (**Co-op**, **Ghost**, **Race / Speedrun** or **🔀 Shuffle**), pick a game, press **Open lobby**.
2. **Copy invite link** and send it to your friends. Set a lobby password if you like (send it separately).
3. When everyone is ready, press **Start match**. After the game, **↻ Play again** brings everyone back to the lobby.

**Friends on the same Wi-Fi** can use the *Copy Wi-Fi link* button. **Friends anywhere** need the Internet mode: in the window, pick **Internet (Cloudflare Tunnel)** before pressing Start. It's free, no account needed. The hub still opens on localhost for you; invite links use the public address. More: [Playing over the internet](docs/README-ADVANCED.md#9-playing-over-the-internet).

In a match: **/** to chat, the 🎙 button for voice, **F2** / **F4** to save and load (co-op host), **📶 Stream** to change the quality. Every shortcut: the **⌨** button.

## Big consoles (PS2, GameCube, Switch…)

1. Drop a portable build of the emulator into its folder in `emulators/` (for example `emulators/pcsx2/`). You supply BIOS, firmware and keys yourself.
2. Press **Check for Emus** in the hub: it shows which ones it found.
3. Host the game from the hub on your own PC. The first time, a short **setup check** says if anything is missing and sets up controllers for your friends (without touching your own settings).
4. When the match starts, press **Share the window** once.

Every emulator, its folder and its quirks: [emulators/README.md](emulators/README.md). How it works: [Native emulators](docs/README-ADVANCED.md#8-native-emulators-and-pc-games). Online play in the emulators themselves (Pretendo, RPCN, Insignia…): the **🌐 Online** button and [Online services](docs/README-ADVANCED.md#online-services).

## Streaming

Turn on **Streamer Mode** in a Co-op lobby: viewers wait in line and take turns in the seats (↻ Rotate, 👑 winner stays, optional turn timer), and 🎲 **viewer effects** let them spend points on things like inverted controls or an upside-down screen.

For OBS: **☰ → 📺 OBS overlay** gives you one Browser Source URL with **the game itself**, the players, a clock, pop-ups and your **Twitch or YouTube chat** (read-only, no login), where chat can fire effects with `!flip`, `!mirror`… There's also a control dock for OBS and a 🪟 **pop-out window** for apps that capture a window instead. Full guide: [docs/OBS-STREAMING.md](docs/OBS-STREAMING.md).

## More to try

| Feature | Where | Read more |
| --- | --- | --- |
| 🔀 **Shuffler**: 2-8 games, it jumps between them at random right where you left each one | link under *Host a game*, or the 🔀 Shuffle mode | [Shuffler](docs/README-ADVANCED.md#shuffler) |
| 🏆 **RetroAchievements**: progress and unlocks in the match | 🏆 in the top bar | [RetroAchievements](docs/README-ADVANCED.md#retroachievements), [docs/ACHIEVEMENTS.md](docs/ACHIEVEMENTS.md) |
| 👥 **Buddy List**: a classic messenger: see who's on, IM, join their lobby | 👥 in the top bar | [Buddy List](docs/README-ADVANCED.md#buddy-list-messenger) |
| 🔎 **Lobby Browser**: every lobby here and on nearby hubs, ⏳ wait for a seat, 🔔 alerts | tab next to *Play* | [Lobby Browser](docs/README-ADVANCED.md#lobby-browser) |
| 🩹 **Patcher**: translations, hacks, randomizers, co-op patches (makes a copy, never changes the original) | *Patches & variants* when you pick a library game | [Patches and the Patcher](docs/README-ADVANCED.md#patches-variants-and-the-patcher) |
| 🤝 **Co-op ROM hacks**: 2-4 player N64 hacks, set up in one click | *Host a game* with a known N64 ROM | [Co-op ROM hacks](docs/README-ADVANCED.md#co-op-rom-hacks) |
| 🎸💃 **Guitars, drum kits, dance mats** for friends over the stream | 🎸 Instruments (☰) | [Guitars, drums, dance mats](docs/README-ADVANCED.md#guitars-drum-kits-and-dance-mats) |
| 🎞️📱🗝️🖥️ **Flash, phone games, ScummVM, DOS / Windows 9x** | Off Site Games tab | [Hub players](docs/README-ADVANCED.md#hub-players-flash-phone-games-scummvm-and-pc) |
| 🔗 **Link play**: GBA link cable, Four Swords GBA screens, Xbox 360 System Link | *Play* tab panels | [GBA link](docs/README-ADVANCED.md#gba-and-game-boy-link-cable-vba-m), [GBA screens](docs/README-ADVANCED.md#four-swords-adventures-gba-screens), [System Link](docs/README-ADVANCED.md#xbox-360-system-link-rooms) |
| 🎨 **Themes**: 14 looks, launcher styles, or make and share your own | 🎨 Theme in the top bar | [Themes and emotes](docs/README-ADVANCED.md#themes-and-emotes) |

## Staying up to date

The RetroDuck window checks for new versions when it opens. Press **Update…** (or **Check for updates**): your settings, games and emulators are kept, replaced files are backed up first, and the download is checked before it's installed. What changed: [CHANGELOG.md](docs/CHANGELOG.md).

## Support RetroDuck

RetroDuck is free and made by **Zephyrian**. If it brings you and your friends some fun:

- ☕ [Support it on Ko-fi](https://ko-fi.com/zephyrian)
- ▶ [Zephyrian on YouTube](https://www.youtube.com/@Zephyrian1st)

## Need help?

| Problem | Try this |
| --- | --- |
| The library tab is missing | Press **Unlock library** and enter the owner password. |
| A friend can't connect | Use the Internet (Cloudflare Tunnel) mode, or see *TURN* in the [advanced guide](docs/README-ADVANCED.md#9-playing-over-the-internet). |
| The game lags for a friend far away | Try **Ghost** or **Race** mode (no lag), or lower **📶 Stream** quality. |
| The hub link opens some other page (for example "freej2me-web … Loading…") | Another program uses the same port. RetroDuck refuses to start and names it; close it or change **Port** in **Settings**. |
| An emulator shows ✖ | The window shows a **Setup needs a look** box with a fix button. |
| A game is missing from the library | Check its folder in **Settings → Consoles…**, and **Show hidden** in the library. |
| Lost your account | Import the file from **Export account** on the sign-in page. Without one, make a new account. |

**Where to find everything else**

| You want… | Go to |
| --- | --- |
| Every setting, the window's tabs, the command-line launcher | [Advanced guide §4-5, §11](docs/README-ADVANCED.md#4-the-retro-hub-window-launcher-and-admin-panel) |
| How lobbies, streaming, input and accounts work inside | [Architecture](docs/README-ADVANCED.md#1-architecture-at-a-glance), [Internals](docs/README-ADVANCED.md#13-internals-api-websocket-protocol-webrtc) |
| What's protected and how | [Security model](docs/README-ADVANCED.md#12-security-model), [docs/SECURITY-LOCAL.md](docs/SECURITY-LOCAL.md) |
| Docker / NAS | [Docker and NAS](docs/README-ADVANCED.md#10-docker-and-nas) |
| Where files live, what to back up | [Files and folders](docs/README-ADVANCED.md#14-files-and-folders) |
| More fixes | [Troubleshooting](docs/README-ADVANCED.md#15-troubleshooting), [FIXLOG.md](docs/FIXLOG.md) |

---

RetroDuck contains no games, BIOS files or keys. Only play games you own. GPL-3.0, see [LICENSE](LICENSE).
