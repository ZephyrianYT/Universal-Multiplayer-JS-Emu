<p align="center"><img src="assets/icon/retrohub-256.png" width="128" alt="Retro Hub duck mascot"></p>

# Retro Hub

**Play retro games with your friends from a link.** You run Retro Hub on your PC, friends open the link in their browser, and you play together: co-op, races, or side by side as ghosts. Nothing to install for your friends, and no games are ever uploaded anywhere.

- 🎮 **Browser consoles**: NES, SNES, N64, Game Boy, Game Boy Color, GBA, DS, PS1, PSP, Genesis, Saturn, arcade and more.
- 🖥️ **Big consoles** (PS2, GameCube, Wii, Wii U, Switch, 3DS, Xbox, Dreamcast…) run in real emulators on your PC and stream to your friends.
- 🏁 **Race / speedrun mode**, 🏆 **RetroAchievements**, voice chat, save states, and a link cable for GBA.
- 🔒 **Private by design**: your games stay on your PC, and accounts live in each player's browser.

---

## Get started (Windows)

1. **Unzip** `retro-hub-0.2.3-fresh-install.zip` anywhere (for example `C:\Games\retro-hub`).
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

**Friends on the same Wi-Fi** can use the *Copy Wi-Fi link* button. **Friends anywhere** need the Internet mode: in the window, pick **Internet (Cloudflare Tunnel)** before pressing Start. It's free, no account needed.

## Big consoles (PS2, GameCube, Switch…)

Drop a portable build of the emulator into its folder in `emulators/` (for example `emulators/pcsx2/`). **Check for Emus** in the hub shows which ones it found. Details: [emulators/README.md](emulators/README.md).

## Staying up to date

The Retro Hub window checks for new versions when it opens. Press **Update…** (or **Check for updates**): your settings, games and emulators are kept, and replaced files are backed up first.

## Need help?

| Problem | Try this |
| --- | --- |
| The library tab is missing | Press **Unlock library** and enter the owner password. |
| A friend can't connect | Use the Internet (Cloudflare Tunnel) mode, or see *TURN* in the advanced guide. |
| An emulator shows ✖ | The window shows a **Setup needs a look** box with a fix button. |
| A game is missing from the library | Check its folder in **Settings → Consoles…**, and **Show hidden** in the library. |

**Everything else** (all settings, the security model, Docker, how it works inside): see the **[advanced guide](README-ADVANCED.md)**. What changed: [CHANGELOG.md](CHANGELOG.md).

---

Retro Hub contains no games, BIOS files or keys. Only play games you own. GPL-3.0, see [LICENSE](LICENSE).
