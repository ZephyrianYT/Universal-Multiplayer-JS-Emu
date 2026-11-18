# Retro Hub 🦆

**Play retro games with your friends from a link.** Run Retro Hub on your PC, send a link, and your friends play right in their browser. They don't install anything, and your games never leave your PC.

![Retro Hub](docs/screenshot.png)

**[⬇ Download the latest release](https://github.com/ZephyrianYT/Universal-Multiplayer-JS-Emu/releases/latest)** · Windows, macOS, Linux · Free (GPL-3.0)

---

## What you get

- **Play together:** Co-op, Ghost (side by side), and Race / Speedrun, plus voice chat.
- **In the browser:** NES, SNES, N64, Game Boy, GBC, GBA, DS, PS1, PSP, Genesis, Saturn, arcade and more.
- **Big consoles:** PS2, GameCube, Wii, Wii U, Switch, 3DS, Xbox, Dreamcast and more run in real emulators on your PC and stream to your friends.
- **Extras:** RetroAchievements 🏆, save states, GBA link cable, Streamer Mode, and a game Shuffler.
- **Private by design:** 🔒 your games stay on your PC, and each player's account lives in their own browser.

## Quick start (Windows)

1. **Download** the latest zip from [Releases](https://github.com/ZephyrianYT/Universal-Multiplayer-JS-Emu/releases/latest) and unzip it anywhere (for example `C:\Games\retro-hub`).
2. **Double-click `launch.bat`.**
   - Missing Python or Node.js? It offers to install them and checks every download first.
   - Say yes to the **desktop shortcut**, and next time just click the duck.
3. Press **▶ Start** in the Retro Hub window. Your browser opens the hub.
4. **Type a name** to make your account. One click, no password.

**macOS / Linux:** install Python 3 and Node.js 18+, then run `./launch.sh` (or `python3 RetroHub.pyw`) in the folder.

## Add your games

- Put games in the `roms` folder, one folder per console: `roms/snes`, `roms/gba`, `roms/psx`…
- **Or** point a console at the folder your games are already in: **Settings → Consoles…**
- In the hub, press **Unlock library** and enter the owner password (in the window: **Settings → Owner password → Show**).

Each disc game shows up once (its `.cue` or `.m3u`), and BIOS files are left out automatically.

## Play with friends

1. **Host a game:** pick a mode, pick a game, and press **Open lobby**.
2. **Copy invite link** and send it. Set a lobby password if you like, and send it separately.
3. When everyone's ready, press **Start match**. **↻ Play again** brings everyone back to the lobby.

| Your friends are… | Do this |
| --- | --- |
| On your Wi-Fi | Use **Copy Wi-Fi link**. |
| Anywhere else | Before pressing ▶ Start, pick **Internet (Cloudflare Tunnel)** in the window. It's free and needs no account. Your invite links then use the public address. |

## More to try

- **🎥 Streamer Mode:** viewers wait in line and take turns in the seats. They can spend points on 🎲 effects (inverted controls, double speed, upside-down screen). The OBS overlay is at `http://localhost:8080/overlay/queue`.
- **🔀 Shuffler:** load 2-8 games and it jumps between them at random, right where you left each one. Press F8 to mark a game beaten. To play it with friends, pick **🔀 Shuffle** in *Host a game*.
- **🔎 Lobby Browser:** search every lobby on this hub and nearby hubs. **⏳ Wait for a seat** or **🔔 Alert me** when a lobby you want opens.
- **👥 Buddy List:** a classic-style messenger with instant messages, away messages, and joining or inviting buddies to a lobby.
- **🎸 Guitar Hero / Rock Band:** friends set up their instrument once in **🎸 Instruments** (☰ menu). See `emulators/INSTRUMENTS.md`.
- **🕹️ Off Site Games:** Flash (.swf), phone games (J2ME .jar), ScummVM, and DOS / Windows 9x, plus links to games on other sites.
- **🎨 Themes:** Coal, Midnight, Synthwave, Forest, Crimson, Pocket or Paper (light).

## Big consoles

Drop a portable build of the emulator into its folder in `emulators/` (for example `emulators/pcsx2/`). Then press **Check for Emus** in the hub to see which ones it found. Details: [emulators/README.md](emulators/README.md).

## Updating

The window checks for new versions when it opens. Press **Update…** to install one. Your settings, games and emulators are kept, and any file it replaces is backed up first.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The library tab is missing | Press **Unlock library** and enter the owner password. |
| A friend can't connect | Use **Internet (Cloudflare Tunnel)** mode, or see *TURN* in the [advanced guide](README-ADVANCED.md). |
| An emulator shows ✖ | Use the fix button in the **Setup needs a look** box in the window. |
| A game is missing | Check its folder in **Settings → Consoles…** and turn on **Show hidden** in the library. |

Everything else (all settings, security, Docker, how it works) is in the **[advanced guide](README-ADVANCED.md)**. You can see what changed in the [CHANGELOG](CHANGELOG.md).

---

Retro Hub contains no games, BIOS files or keys. Only play games you own. Licensed under [GPL-3.0](LICENSE).
