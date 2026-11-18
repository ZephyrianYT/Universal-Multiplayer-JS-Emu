0.3.4 fix is merged. Until the release zip is up tonight, either:

1) Quick workaround on 0.3.3: open http://127.0.0.1:8080 instead of http://localhost:8080
   (or change Port in the Retro Hub window: Settings, e.g. 8081, then Start).

2) Get 0.3.4 now: on the GitHub repo page press Code > Download ZIP, unzip,
   copy your old .env, roms and emulators folders into it, then run launch.bat.

# Retro Hub

**Play retro games with your friends from a link.** You run Retro Hub on your PC, friends open the link in their browser, and you play together: co-op, races, or side by side as ghosts. Nothing to install for your friends, and no games are ever uploaded anywhere.

- 🎮 **Browser consoles**: NES, SNES, N64, Game Boy, Game Boy Color, GBA, DS, PS1, PSP, Genesis, Saturn, arcade and more.
- 🖥️ **Big consoles** (PS2, GameCube, Wii, Wii U, Switch, 3DS, Xbox, Dreamcast…) run in real emulators on your PC and stream to your friends.
- 🏁 **Race / speedrun mode**, 🏆 **RetroAchievements**, voice chat, save states, and a link cable for GBA.
- 🔒 **Private by design**: your games stay on your PC, and accounts live in each player's browser.

---

## Get started (Windows)

1. **Unzip** `RetroHub0.3.4.zip` anywhere (for example `C:\Games\retro-hub`).
2. **Double-click `launch.bat`.**
   - Missing Python or Node.js? It offers to download and install them for you, and checks every download first.
   - It asks whether you want a **desktop shortcut** with the Retro Hub duck. Say yes, and next time just click the duck.
3. In the Retro Hub window, press **▶ Start**. Your browser opens the hub.
4. Type a name to **make your account** (one click, no password).

**macOS / Linux:** install Python 3 and Node.js 18+, then run `python3 RetroHub.pyw` (or `./launch.sh`) in the folder.

## Add your games

- Put games in the **`roms`** folder, one folder per console: `roms/snes`, `roms/gba`, `roms/psx`…
- Or point each console at the folder your games are already in: **Settings → Consoles…** in the Retro Hub window.
- In the hub, press **Unlock library** and enter the owner password (in the window: **Settings → Owner password → Show**).

Disc games show up once (the `.cue` or `.m3u`, not every track), and BIOS files are left out on their own.

## Play with friends

1. **Host a game**: pick a mode (**Co-op**, **Ghost**, or **Race / Speedrun**), pick a game, press **Open lobby**.
2. **Copy invite link** and send it to your friends. Set a lobby password if you like (send it separately).
3. When everyone is ready, press **Start match**. After the game, **↻ Play again** brings everyone back to the lobby.

**Friends on the same Wi-Fi** can use the *Copy Wi-Fi link* button. **Friends anywhere** need the Internet mode: in the window, pick **Internet (Cloudflare Tunnel)** before pressing Start. It's free, no account needed. The hub still opens on localhost for you; invite links use the public address.

**Streaming?** Turn on **Streamer Mode** in a Co-op lobby: viewers wait in line and take turns in the seats (↻ Rotate, 👑 winner stays, optional turn timer), 🎲 **viewer effects** let viewers spend points on things like inverted controls, double speed or an upside-down screen, and `http://localhost:8080/overlay/queue` is an OBS overlay with who's playing and who's next ([OBS guide](docs/OBS-STREAMING.md)).

**🔀 Shuffler** (link under *Host a game*): load 2-8 games and it jumps between them at random, right where you left each one. Mark games beaten (F8) until you've beaten them all. With friends: pick the **🔀 Shuffle** mode in *Host a game*.

**🎸 Guitar Hero / Rock Band**: these run in the native emulators on the host's PC. Friends set up their guitar or drum kit once in **🎸 Instruments** (☰ menu) and play along; the host maps them in the emulator (`emulators/INSTRUMENTS.md`).

**Lobby Browser** (tab next to *Play*): every lobby on this hub and nearby hubs, with search and filters. Full? **⏳ Wait for a seat** joins you when one opens. **🔔 Alert me** tells you when a lobby you'd like opens.

**👥 Buddy List**: a classic-style messenger. Add buddies by the ID next to their name (or **＋ Buddy** in a lobby, or **Find a Buddy**). Once you've both added each other you see when they're on, send instant messages, set an away message and profile, join their lobby, or invite them to yours.

**Off Site Games** (the tab next to *Play*) links to games that run on other websites, in a new tab. It also has the hub's own extra players: **🎞️ Flash** (.swf), **📱 Phone games** (J2ME .jar), **🗝️ ScummVM** adventures and **🖥️ PC** (DOS / Windows 9x disk images). Load your own files, or the owner puts games in `roms/swf`, `roms/j2me`, `roms/scummvm` and `roms/x86` (one folder per game).

## Big consoles (PS2, GameCube, Switch…)

Drop a portable build of the emulator into its folder in `emulators/` (for example `emulators/pcsx2/`). **Check for Emus** in the hub shows which ones it found. Details: [emulators/README.md](emulators/README.md).

## Staying up to date

The Retro Hub window checks for new versions when it opens. Press **Update…** (or **Check for updates**): your settings, games and emulators are kept, and replaced files are backed up first.

## Make it yours

**🎨 Theme** in the top bar (☰ on phones) switches the colors: Coal, Midnight, Synthwave, Forest, Crimson, Pocket or Paper (light). Click **Retro Hub** at the top left any time to get back to the home screen.

## Need help?

| Problem | Try this |
| --- | --- |
| The library tab is missing | Press **Unlock library** and enter the owner password. |
| A friend can't connect | Use the Internet (Cloudflare Tunnel) mode, or see *TURN* in the advanced guide. |
| The hub link opens some other page (for example "freej2me-web … Loading…") | Another program uses the same port. Retro Hub 0.3.4+ refuses to start and names it; close it or change **Port** in **Settings**. |
| An emulator shows ✖ | The window shows a **Setup needs a look** box with a fix button. |
| A game is missing from the library | Check its folder in **Settings → Consoles…**, and **Show hidden** in the library. |

**Everything else** (all settings, the security model, Docker, how it works inside): see the **[advanced guide](README-ADVANCED.md)**. What changed: [CHANGELOG.md](CHANGELOG.md).

---

Retro Hub contains no games, BIOS files or keys. Only play games you own. GPL-3.0, see [LICENSE](LICENSE).
