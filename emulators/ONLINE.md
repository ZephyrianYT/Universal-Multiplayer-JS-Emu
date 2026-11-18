# Online services

Retro Hub's own lobbies work for **every console** with nothing to set up: the host runs the game, friends join with
a link and get a controller seat.

This page is about the services a game's **own** online mode talks to (Pretendo, RPCN, Insignia...). Until one is set
up, that console's online modes are limited, but Retro Hub co-op still works. In the hub, the owner sees the status
of each emulator under **🌐 Online** (from a browser on the hub's own computer).

Retro Hub never ships console keys, BIOS, or account files. You use your own.

| Console | Emulator | Service | Status in Retro Hub |
|---|---|---|---|
| Wii U | Cemu | Pretendo Network | Retro Hub checks it |
| PlayStation 3 | RPCS3 | RPCN | Retro Hub checks it |
| Xbox | xemu | Insignia | Retro Hub checks it |
| Xbox 360 | Xenia | Xenia Canary netplay (Xenia Web Services) | Retro Hub checks it |
| Wii, GameCube | Dolphin | Wiimmfi (Wii) | Set up in the emulator (Retro Hub can't check it) |
| Nintendo DS | melonDS | Wiimmfi / Kaeru WFC | Set up in the emulator (Retro Hub can't check it) |
| PSP | PPSSPP | PPSSPP ad hoc rooms + infrastructure | Retro Hub checks it |
| Dreamcast | Flycast | DCNet | Set up in the emulator (Retro Hub can't check it) |
| PlayStation 2 | PCSX2 | Community game servers | Set up in the emulator (Retro Hub can't check it) |
| Nintendo 3DS | Azahar | Azahar multiplayer rooms | Built in, nothing to set up |
| Nintendo Switch | Eden | Eden multiplayer rooms | Built in, nothing to set up |
| Nintendo Switch | Ryujinx | Ryujinx LDN multiplayer | Set up in the emulator (Retro Hub can't check it) |
| Game Boy / GBA link | VBA-M | Link cable | No online service |
| Nintendo 64 | Project64 | None | No online service |

## Wii U: Cemu (Pretendo Network)

The games' own online modes (Mario Kart 8, Splatoon, Super Mario Maker and more), friends list and Miiverse (Juxtaposition), on Pretendo's free replacement for Nintendo Network.

1. With a Wii U (recommended): install Aroma and run Dumpling on the console. Dump your online files (otp.bin, seeprom.bin and your account) plus the Friend List app.
2. Make a Pretendo account (PNID) at pretendo.network and link it on the Wii U with the Inkay plugin, so the dumped account is a Pretendo account.
3. In Retro Hub: 🌐 Online → Cemu → Import my files, and pick the folder Dumpling wrote (it has otp.bin and seeprom.bin). Retro Hub copies them into the folder Cemu reads and backs up anything it replaces.
4. Set the network service to Pretendo (button below, or in Cemu: Options → General settings → Account → Network service) and tick Online mode.
5. Without a Wii U: run your own server with pretendo-docker. Its create-cemu-online-files script makes files that only work on that server; then pick 'My own server' and enter its address.
6. Super Mario Maker only: SmmServer is a private course server. Its FakeOnlineFiles (account 'dummy') go in the folder Cemu reads, the service is Custom, and SmmServer must be running (press Start) while you play.

- [Pretendo Network (Docs: Cemu setup, account)](https://pretendo.network/)
- [Dumpling (dump your Wii U files)](https://github.com/emiyl/dumpling)
- [pretendo-docker (your own server)](https://matthewl246.github.io/pretendo-docker/setup/connecting/cemu/)
- [SmmServer (Super Mario Maker)](https://github.com/SmmServer/SmmServer)

## PlayStation 3: RPCS3 (RPCN)

PS3 online play, matchmaking and friends on RPCN (RPCS3's own free PSN replacement), plus community revival servers for games whose official servers closed.

1. Firmware (needed for any PS3 game to boot): download PS3UPDAT.PUP from PlayStation's official PS3 system software page, then in RPCS3 File → Install Firmware.
2. RPCN account: Configuration → RPCN → Create account (free). Enter the token RPCN emails you. The server is np.rpcs3.net unless you add another.
3. Turn it on for all games (Configuration → Network: Network status Connected, PSN status RPCN), or per game: right-click the game → Create Custom Configuration → Network, same two settings. Both start as Disconnected.
4. Community servers (games whose official servers closed): in that game's custom configuration set the DNS address the project gives, or its IP/Hosts switches. Only use addresses from the project's own site or Discord: a DNS server sees every address the game looks up.
5. Check RPCS3's compatibility list and the game's revival project for which modes work.

Community servers (DNS address for that game's custom configuration; a DNS server sees every address the game looks up, so only use ones you trust):

| Project | Games | DNS | Where it's from |
|---|---|---|---|
| [PS Rewired](https://psrewired.com/) | Killzone 2 & 3, MotorStorm series, Resistance 1 & 2, SOCOM Confrontation, PlayStation Home and more (see their list) | `67.222.156.250` | PPSSPP's built-in revival list names this as PS Rewired's DNS |
| [The Archstones (Demon's Souls)](https://www.demonssouls.com/Online_Play_in_2021) | Demon's Souls | `142.93.245.186` | Demon's Souls wiki private-server guide (2021): check it's still current |

Other revival projects (PS3 Reborn, Warhawk/Starhawk revival, Uncharted, ModNation Racers, wrestling and sports servers...) publish their own addresses: get them from each project's site or Discord. Retro Hub doesn't pre-fill addresses it can't confirm.

- [PS3 system software (firmware)](https://www.playstation.com/en-us/support/hardware/ps3/system-software/)
- [RPCS3 (Quickstart, RPCN help)](https://rpcs3.net/)
- [PS Rewired](https://psrewired.com/)
- [Demon's Souls online (wiki)](https://www.demonssouls.com/Online_Play_in_2021)

## Xbox: xemu (Insignia)

Original Xbox Live games online again on Insignia, a free replacement for Microsoft's servers.

1. In xemu: Machine → Settings → Network: enable networking.
2. Register at insignia.live and follow its connection guide (it updates the dashboard on your own Xbox hard drive image).
3. System link games can also use XLink Kai.

- [Insignia](https://insignia.live/)
- [Insignia connection guide](https://insignia.live/guide/connect)
- [xemu network docs](https://xemu.app/docs/networking/)

## Xbox 360: Xenia (Xenia Canary netplay (Xenia Web Services))

Xbox 360 online and system-link games through AdrianCassar's netplay fork of Xenia Canary: sessions are matched by Xenia Web Services (a public server, or one you host).

1. Use the netplay fork of Xenia Canary (AdrianCassar/xenia-canary releases); its settings file is named *-netplay.config.toml.
2. Set api_address to a Xenia Web Services server: the public one (xenia-netplay-2a0298c0e3f4.herokuapp.com, which also lists live sessions) or your own.
3. Your own server: Xenia Web Services is a self-hostable REST API; run it and point api_address at it for a private group.
4. Set network_mode to Xbox Live. Hosting needs UPnP on (it's off by default). Some games also need their DLC installed.
5. Strict or double NAT: players report that turning on Nexia360 / Nexiahub transport in the netplay settings helps hosting (community tip).
6. System-link games can instead use XLink Kai, or a virtual LAN (ZeroTier, Radmin VPN) between the players.

- [Xenia Canary netplay fork](https://github.com/AdrianCassar/xenia-canary)
- [Netplay fork releases](https://github.com/AdrianCassar/xenia-canary/releases)
- [Netplay config setup](https://github.com/AdrianCassar/xenia-canary/wiki/Config-Setup)
- [Xenia Web Services (host your own)](https://github.com/AdrianCassar/Xenia-WebServices)
- [Public netplay server and sessions](https://xenia-netplay-2a0298c0e3f4.herokuapp.com/)
- [XLink Kai: Xenia setup](https://www.teamxlink.co.uk/wiki/Xenia_XLink_Kai_Setup)
- [Xenia (official site)](https://xenia.jp/)

## Wii, GameCube: Dolphin (Wiimmfi (Wii))

Wii online games on Wiimmfi (Mario Kart Wii, Smash Bros Brawl and more), and GameCube GBA-link games such as Four Swords Adventures with every player on their own GBA screen. GameCube games also have Dolphin's own netplay.

1. Four Swords Adventures / GBA-link games, through Retro Hub: put your own GBA BIOS (gba_bios.bin, 16 KB, dumped from a GBA or DS) in Retro Hub's bios folder. In Host a game, pick the game and press 'GBA screens mode'. Only the host needs the game; after it starts, share the TV window and then each GBA window: every player gets only their own GBA. Guests need virtual gamepads (ViGEmBus + vgamepad on the host).
2. Four Swords Adventures with Dolphin netplay (everyone owns the game and a GBA BIOS, smoother for far-apart players): each player opens Dolphin from here with 'Open Dolphin for GBA netplay' (4 GBA ports, their BIOS, Hide Remote GBAs, traversal). The host: Tools → Start NetPlay → Host, pick the game, and send the host code in the lobby chat. Others paste the code here first, then Tools → Start NetPlay → Connect. Everyone needs the same Dolphin version and an identical game dump.
3. Wii online (Wiimmfi): make a NAND backup of your own Wii or Wii U with BootMii, then in Dolphin: Tools → Import BootMii NAND Backup (turn on Settings → General → Allow Mismatched Region Settings first, and keep it on). Patch each game with the Wiimmfi patcher and add the patched copy to your library.
4. WiiConnect24 channels (Forecast, News, Mii Contest...) come back with WiiLink.

- [Dolphin netplay guide](https://wiki.dolphin-emu.org/index.php?title=Netplay_Guide)
- [Dolphin wiki: Wiimmfi](https://wiki.dolphin-emu.org/index.php?title=Wiimmfi)
- [Wiimmfi](https://wiimmfi.de/)
- [WiiLink](https://www.wiilink.ca/)

## Nintendo DS: melonDS (Wiimmfi / Kaeru WFC)

DS Wi-Fi games (Pokémon trades and battles, Mario Kart DS) on community Nintendo Wi-Fi Connection replacements.

1. In the game's Nintendo WFC settings, delete any old connection, then make a new one through melonDS's access point.
2. Set the DNS by hand to the server's address (check the server's own site for the current one).
3. If the game freezes while connecting, try the other server or melonDS's Direct mode.

- [Wiimmfi](https://wiimmfi.de/)
- [Kaeru WFC](https://kaeru.world/projects/wfc)
- [melonDS](https://melonds.kuribo64.net/)

## PSP: PPSSPP (PPSSPP ad hoc rooms + infrastructure)

PSP local-wireless (ad hoc) games over the internet through community relay servers (Monster Hunter, Peace Walker, Naruto, Phantasy Star...), and infrastructure-mode games on revival servers in newer PPSSPP versions.

1. PPSSPP → Settings (gear) → Networking: turn on Enable networking/WLAN.
2. Ad hoc: set your Nickname, and pick a server under Ad hoc server address (socom.cc is the default; everyone playing together must use the same one).
3. Start the game and use its multiplayer / gathering-hall menu: rooms from other players show up, or host your own.
4. Infrastructure games (newer PPSSPP only): enter a Username under Infrastructure; PPSSPP sets up supported revival servers by itself.
5. If players can't see each other: everyone needs the exact same PPSSPP version and the same Port offset (default 10000), and the firewall must let PPSSPP accept connections.

- [PPSSPP (downloads, FAQ)](https://www.ppsspp.org/)
- [PPSSPP on GitHub](https://github.com/hrydgard/ppsspp)

## Dreamcast: Flycast (DCNet)

Dreamcast online games on DCNet, built into Flycast 2.5 and newer, with no port forwarding.

1. Use Flycast 2.5 or newer.
2. Settings → Network: enable DCNet, then use the game's online mode as normal.
3. Each game has its own server notes on the DCNet pages.

- [DCNet](https://dcnet.flyca.st/)
- [Flycast](https://github.com/flyinghead/flycast)

## PlayStation 2: PCSX2 (Community game servers)

Some PS2 online games (SOCOM, Twisted Metal, Need for Speed and others) on fan-run servers, through PCSX2's network adapter.

1. Settings → Network & HDD: enable the network adapter (DEV9) and pick your network card.
2. Follow the revival server's guide for that game (usually a DNS address and sometimes an HDD image).

- [PCSX2 docs](https://pcsx2.net/docs/)

## Nintendo 3DS: Azahar (Azahar multiplayer rooms)

Local-wireless 3DS games played over the internet in Azahar's rooms (Multiplayer → Browse Public Rooms, or host your own). Pretendo's 3DS support is for real consoles.

1. In Azahar: Multiplayer → Browse Public Rooms (Ctrl+B) or Host Room; everyone in the room plays as if on local wireless.

- [Azahar](https://azahar-emu.org/)

## Nintendo Switch: Eden (Eden multiplayer rooms)

Local-wireless Switch games played over the internet in Eden's rooms. Nintendo Switch Online itself has no replacement.

1. In Eden: Multiplayer → Browse Public Game Lobby, or Create Room; everyone in the room plays as if on local wireless.

## Nintendo Switch: Ryujinx (Ryujinx LDN multiplayer)

Local-wireless Switch games played over the internet with Ryujinx's LDN multiplayer. Nintendo Switch Online itself has no replacement.

1. Options → Settings → Network: set the multiplayer mode to LDN, then use the game's local wireless mode.

## Game Boy / GBA link: VBA-M (Link cable)

Link-cable trades and battles go through Retro Hub's GBA link console. There is no other online service.

## Nintendo 64: Project64 (None)

N64 games had no online. Retro Hub co-op (and the co-op ROM hacks) is how they play together.

## Cemu: which folder it reads

Cemu 2.x reads otp.bin, seeprom.bin, network_services.xml, settings.xml and its accounts from one folder: a
`portable` folder next to Cemu.exe if one exists; on Windows, Cemu.exe's own folder if a settings.xml is next to it
(the old portable layout); otherwise `%APPDATA%\Cemu` (Linux: `~/.local/share/Cemu`). Retro Hub follows the same
rule. If online files sit next to Cemu.exe while Cemu reads `%APPDATA%`, 🌐 Online → Cemu → **Copy them to where Cemu
reads** moves them (backups go to Retro Hub's `backup/` folder).

SmmServer's FakeOnlineFiles (account "dummy") only work with SmmServer: pick **Custom** and start SmmServer. They
don't work on Pretendo.

From a terminal: `python apps.py pretendo-status`, `python apps.py pretendo-enable --service pretendo|custom|offline [--proxy http://server:8080]`,
`python apps.py pretendo-import <folder>`.
