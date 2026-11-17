# Native emulators

`python apps.py` (in the hub folder) lists what is found here and adds anything else: emulators installed
elsewhere, emulators not in this list (e.g. a Ryujinx fork), and PC games. It never modifies an emulator.

Drop a **portable build** of each emulator you want into its folder. The hub finds the executable in the
folder itself or one subfolder down, so an unzipped release works as-is. On Windows it also recognises an
emulator by the program's own name (ProductName), so a renamed exe in any folder here is still found.

| Folder     | Emulator | Consoles          | Executable it looks for                       | Library folder names                 |
| ---------- | -------- | ----------------- | --------------------------------------------- | ------------------------------------ |
| `pcsx2/`   | PCSX2    | PlayStation 2     | `pcsx2-qt.exe` / `pcsx2-qt` / `*pcsx2*.AppImage` | `roms/ps2/`                          |
| `dolphin/` | Dolphin  | GameCube, Wii     | `Dolphin.exe` / `dolphin-emu`                 | `roms/gamecube/`, `roms/wii/`        |
| `rpcs3/`   | RPCS3    | PlayStation 3     | `rpcs3.exe` / `rpcs3` / `*rpcs3*.AppImage`    | `roms/ps3/<Game>/PS3_GAME/USRDIR/EBOOT.BIN` |
| `xenia/`   | Xenia    | Xbox 360          | `xenia_canary.exe` / `xenia.exe`              | `roms/xbox360/`                      |
| `cemu/`    | Cemu     | Wii U             | `Cemu.exe` / `cemu` / `*cemu*.AppImage`       | `roms/wiiu/`                         |
| `ryujinx/` | Ryujinx  | Switch            | `Ryujinx.exe` / `ryujinx`                     | `roms/switch/`                       |
| `eden/` (or `citron/`, `sudachi/`) | Eden / Citron / Sudachi | Switch | `eden.exe` / `citron.exe` / `sudachi.exe` | `roms/switch/` |
| `xbox/` (or `xemu/`) | xemu | Xbox            | `xemu.exe`                                    | `roms/xbox/`                         |
| `azahar/` (or `lime3ds/`, `citra/`, `3ds/`) | Azahar | 3DS | `azahar.exe` / `lime3ds.exe` / `citra-qt.exe` | `roms/3ds/`               |
| `melonds/` | melonDS  | Nintendo DS (melonDS) | `melonDS.exe`                             | `roms/melonds/` (`roms/nds/` stays in the browser) |
| `vbam/`    | VBA-M    | GBA link cable    | `visualboyadvance-m.exe`                      | any `.gba` in the library (hub: **GBA link cable**) |
| `flycast/` | Flycast  | Dreamcast         | `flycast.exe`                                 | `roms/dreamcast/`                    |
| `project64/` (or `pj64/`) | Project64 | Nintendo 64 (Project64) | `Project64.exe` (Windows) | `roms/project64/`, or pick *Nintendo 64 (Project64)* under **Console** for any N64 game (`roms/n64/` stays in the browser) |

Set it up once on the host computer, in the emulator itself: BIOS / firmware / keys, graphics settings,
**windowed mode** (a fullscreen window can't be captured reliably), and controller ports:

Guests' virtual controllers are plugged in before the emulator starts, so emulators that don't hot-plug see them.

- **Port 1** = your own controller (remove any keyboard bindings from it).
- **Ports 2–4**, one of:
  - **Keyboard mode** (default on Windows, nothing to install): bind each port to that seat's keys from
    [`KEYBOARD.md`](KEYBOARD.md). Keys only reach the emulator while its window is focused.
  - **Gamepad mode** (after `pip install -r requirements-native.txt`): "Xbox 360 Controller" devices 2–4.
    Retro Hub creates one virtual pad per online seat, in seat order, while a game is hosted.

Only download emulators from their official sites (pcsx2.net, dolphin-emu.org, rpcs3.net, xenia.jp,
cemu.info, xemu.app, melonds.kuribo64.net, visualboyadvance-m.org, azahar-emu.org, pj64-emu.com).

**N64 ROM hacks bigger than 64 MB** (for example OoT Multiplayer built on the OoT Debug ROM) crash the browser's N64 core:
host them with *Nintendo 64 (Project64)*. Hacks that need a Project64 cheat list (OoT Multiplayer: "4 Swords Codes" or
"OoT 2 Player Codes") need those cheats switched on in Project64's own **Cheats** menu; for browser N64 games, use 🧩 Cheats in the lobby.

**Pretendo Network (Wii U online):** Cemu 2.0+, your Wii U's own `otp.bin` and `seeprom.bin` in Cemu's data folder, and an
`account.dat` for your Pretendo Network ID. Hosting a Wii U game tells you what's missing; **Use Pretendo** selects the
Pretendo network service for Cemu's active account (keeps `settings.xml.bak-retrohub`). Use a different location with `EMULATORS_DIR` in `.env`.
