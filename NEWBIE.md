# 🦆 RetroDuck for beginners: pick your setup

New to RetroDuck? This page tells you which setup fits what you want to do, and how to get it running, step by step.
The [README](README.md) is the quick overview; the [advanced guide](README-ADVANCED.md) has every detail.

RetroDuck contains **no games, BIOS files or keys**. Only play games you own.

---

## The words, in one minute

| Word | What it is | Think of it as |
| --- | --- | --- |
| 🦆 **RetroDuck** (a **duck**, or **hub**) | RetroDuck running on a computer: your library, your lobbies, the website your friends open. The one on your own PC is your **main hub**. | Your own game server for friends. |
| 🐣 **Duckling** | An extra RetroDuck started from the same folder on its own port. Same games, same accounts, more rooms at once. | More tables in the same arcade. |
| 🖥 **Station** | A duckling with its own full-screen window, its own monitor and its own controller. | An arcade cabinet. |
| 🦆👑 **MommaDock** | One RetroDuck (often on a NAS) that sees every duck on your network, adopts PCs and starts or stops their stations. | The main unit of a mesh Wi-Fi system. |
| 🐣🔗 **Duckling node** | A PC a MommaDock has adopted after both screens showed the same 6-digit code. | A mesh Wi-Fi satellite. |
| 🌊 **Pond** | The guest page (`/pond.html`): people scan a QR code and play on their own phone or laptop, or join a room on any duck on the network. | A venue's guest Wi-Fi page. |
| 🌊🦆 **SeaDuck** | RetroDuck's own project website (planned). Nothing to do with your network. | A project's home page. |

✅ = works · 🧪 = new and **off until you switch it on**, tested on one PC but not yet with real controllers, phones,
several PCs or a NAS · 🗺 = planned. Ducks and ducklings are ✅; stations, MommaDock, nodes and the Pond are 🧪.

---

## Which setup do I want?

| You want to… | Setup | What you need |
| --- | --- | --- |
| Play with friends who live elsewhere | [1. Just RetroDuck](#1-just-retroduck-standalone) | One PC |
| Play on the couch, or let family join from their phones at home | [2. At home on your Wi-Fi](#2-at-home-on-your-wi-fi) | One PC (+ a TV) |
| Build an arcade cabinet that's always ready | [3. Arcade cabinet](#3-an-arcade-cabinet) | One PC, one screen, one controller |
| Several screens on one PC, a game on each | [4. Several screens on one PC](#4-several-screens-on-one-pc) | One PC with 2-4 monitors and controllers |
| A LAN party with several PCs | [5. LAN party with a MommaDock](#5-a-lan-party-with-a-mommadock) | Several PCs + a NAS or one extra PC |
| Run it on a NAS only, no gaming PC | [6. Just a NAS](#6-just-a-nas) | A NAS with Docker |

### Why ducklings and a MommaDock, and not just more RetroDucks?

You can run a separate RetroDuck on every PC, and for two friends at home that's all you need. As soon as there are
several screens or PCs, the family parts save work:

| | Separate RetroDucks | Ducklings and stations | + MommaDock |
| --- | --- | --- | --- |
| Library, emulators, covers | set up on every PC | set up **once** per PC, every duckling shares them | the same |
| Accounts | one per hub | **one** account works on every duckling of that PC | the same |
| Rooms at once | one hub's worth | one per duckling or station | the same, across every PC |
| Controllers | the window in front gets them | each station gets **its own** controller as player 1 | the same |
| Seeing what's going on | open each hub | `python stations.py status` per PC | **one board** for every duck on the network |
| Starting and stopping | at each PC | at each PC | **from the board**, after a one-time pairing |
| Guests with phones | each hub's own link | each hub's own link | **one Pond** lists every open room on the network |

---

## Before any setup: install RetroDuck (Windows)

1. **Unzip** `RetroDuck0.4.8.zip` anywhere, for example `C:\Games\RetroDuck`.
2. **Double-click `launch.bat`.** Missing Python or Node.js? It offers to install them and checks every download first.
3. In the RetroDuck window press **▶ Start**. Your browser opens the hub.
4. Type a name to **make your account** (no password). Then **Export account** from the top bar and keep the file: it's
   the only way to restore your account.
5. Put your games in the **`roms`** folder, one folder per console (`roms/snes`, `roms/gba`…), or point each console at
   your own folders under **Settings → Consoles…** in the RetroDuck window.
6. In the hub, press **Unlock library** and enter the owner password (in the window: **Settings → Owner password →
   Show**).

macOS and Linux: see [Get started](README.md#get-started-windows) in the README. Stations need Windows (they read
Xbox-style controllers through XInput).

---

## 1. Just RetroDuck (standalone)

The everyday setup: you host, friends anywhere open a link in their browser. Nothing to install for them.

1. Pick a game and open a lobby: **Co-op** (everyone plays the same game together), **Ghost** or **Race** (everyone runs
   their own copy of the game side by side, no lag).
2. Friends far away: ☰ Menu > **🌍 Internet link** switches on a free internet link for your hub (no router setup).
   Then **Copy invite link** in your lobby and send it to them.

That's it. Heavier consoles (PS2, GameCube and up) run in a real emulator on your PC and are streamed to your
friends: see [section 8](README-ADVANCED.md#8-native-emulators-and-pc-games) of the advanced guide.

## 2. At home on your Wi-Fi

1. ☰ Menu > **🏠 Wi-Fi name**: family at home open `http://yourname.local` on their phone or laptop, no port to remember.
   It only works on your own network.
2. ☰ Menu > **📺 Big screen** turns the hub into a controller-first launcher for the TV.
3. Want guests to play on their own phones without seeing your whole library? Use the [Pond](#the-pond-guests-on-their-phones).

## 3. An arcade cabinet

One PC, one screen, one controller, always on the same game launcher: that's one **station** in **seat mode**.

1. Plug in the controller (Xbox-style; PlayStation, Switch and arcade sticks that aren't XInput need Steam Input or
   DS4Windows).
2. In the RetroDuck folder, open a terminal and run:
   ```
   python stations.py init --count 1
   ```
   This writes `stations.json` with `station1` on monitor 1, port 8081.
3. Open `stations.json` and change `"mode": "player"` to `"mode": "seat"`, with `"pad": 1`. Seat mode means controller
   1 is always player 1 here: walk up and play, no claiming.
4. `python stations.py plan` shows what will happen without changing anything.
5. `python stations.py start --windowed` the first time: sign in once in the station's window (it keeps its own
   browser profile, so it stays signed in).
6. From then on: `python stations.py start` opens it full screen with no browser bars, on the Big screen launcher.
   `python stations.py stop` closes it. Alt+F4 also closes the window.

Good to know: sound plays on the PC's default speakers (a speaker per station isn't built yet). RetroDuck doesn't start
itself when Windows starts; start the main hub and then `python stations.py start`.

## 4. Several screens on one PC

The same as the cabinet, with up to 4 stations (Windows has 4 Xbox controller slots).

1. `python stations.py monitors` lists your monitors (1 is the primary).
2. `python stations.py init --count 2` (or 3, or 4): one station per monitor, ports 8081, 8082…
3. Pick a mode per station in `stations.json`:
   - **Player mode** (the default): sign in on the station, then press A on your controller to become player 1. With
     several stations waiting, each asks for its own direction + A, so one press claims one station. The controller is
     yours until you sign out.
   - **Seat mode**: `"pad": N` is always player 1 there. Give each seat-mode station its own pad.
4. `python stations.py start --windowed` once to sign in on each, then `python stations.py start`.
5. `python stations.py status` shows what's running; `python stations.py stop` closes them all.

Each station's controller goes only to that station, even while another window has focus. Friends on your network can
join the stations' lobbies too.

## 5. A LAN party with a MommaDock

Several PCs, each with stations, plus one MommaDock that sees everything and starts the stations for you. Phones join
through the Pond.

```
   NAS or spare PC: MommaDock (MOMMADOCK=1)  ── board, adopts PCs, Pond for phones
        │  same network (own switch is best)
   ┌────┴───────────┬────────────────┐
   PC 1 (RH_NODE=1)  PC 2 (RH_NODE=1)  laptop / cabinet
   stations 1-4      stations 1-4      a duckling or station
```

**Before the party (with internet):** set up each PC as in [setup 4](#4-several-screens-on-one-pc), and play every
console you'll use once on **every** machine. Browser cores download the first time a console is played and are then
cached, so the party itself can run without internet.

**The MommaDock**, either:
- **on a NAS** (Docker): `MOMMADOCK=1`, and the container on Unraid's **`br0`** network with its own LAN address (or
  `network_mode: host` on another Linux NAS). Docker's default network can't hear the other ducks. See
  [section 10](README-ADVANCED.md#10-docker-and-nas). Docker Desktop on Windows or macOS can't hear them either;
- **or on a normal Windows PC**: `MOMMADOCK=1` in that PC's `.env`, then restart RetroDuck.

**Each PC:**
1. In its `.env`: `RH_NODE=1`, and a name such as `RH_NAME=PC 1`. Restart RetroDuck.
2. On the MommaDock, open ☰ Menu > **🦆 MommaDock**. The PC shows up under **Duckling nodes** with a 6-digit code.
3. Press **Approve** on the MommaDock. On the PC, open ☰ Menu > **🐣 Duckling node**: if it shows the **same code**, press
   **Accept**. A different code means something on the network is in the middle: don't accept.
4. Now **Start stations**, **Stop stations** and **Status** work from the board.

**Phones:** open the Pond on the MommaDock (see below). Its **On this network** list shows open rooms on every PC and
cabinet, and idle ducks you can play on.

**Forget** (on the MommaDock) or **Leave** (on the PC) ends a pairing; pairing again needs both confirmations again.
Keep the MommaDock and its PCs on the same RetroDuck version.

The MommaDock can only start, stop and ask the status of stations on an adopted PC. It can't run programs, read files
or change settings there.

## 6. Just a NAS

RetroDuck runs in Docker on a NAS (Unraid, Synology, any Linux box with Docker). The image has the server and the
website only, no native emulators, so it plays **browser consoles** (NES, SNES, Genesis, GBA, PlayStation and more),
and they run on each player's own device, so a small NAS is plenty.

1. Copy `.env.example` to `.env`, set `ADMIN_PASSWORD`, point the `roms` volume in `docker-compose.yml` at your games.
2. `docker compose up -d --build`.
3. Open `http://<your NAS>:8080` and make your account.
4. Turn on the [Pond](#the-pond-guests-on-their-phones): every phone and laptop at home becomes a player.

Add `MOMMADOCK=1` (and the `br0` network on Unraid) to make the same NAS the boss of your other RetroDucks later.

---

## The Pond: guests on their phones

The Pond is the page your guests use. It's a 🧪 feature: it works on a test setup but hasn't been tried with real
phones on a party's Wi-Fi yet.

1. On the hub (or the MommaDock), ☰ Menu > **🌊 Pond**.
2. Search your library and **+ Add** up to 60 **browser** games (native consoles, PC games and hidden games can't be
   added: Pond games run on each player's own device).
3. Switch **Pond is open** on, and give the event a name.
4. **📺 Show on a TV** puts a big QR code and the live games on a screen. If the page warns that the link only works on
   this computer, turn on ☰ Menu > 🏠 **Wi-Fi name** or open the Pond from another device.

Guests scan the code, make an account with one tap, and then:
- **Start a game** from your list on their own phone or laptop (touch controls on a phone), or **Join a game** that's
  already open;
- on the LAN, **On this network** also shows rooms on your other ducks (**Join**, **In use** when full, **🔒 Locked**) and
  idle ducks with **Play here**.

While the Pond is open, players who can't use your library see **only** those games: no other ROMs, covers or owner
tools. Closing the Pond takes that away at once. Players type in their own high scores for now (shown as Unverified).

---

## Something isn't working?

- What doesn't work yet, in one list: [Known limits](README-ADVANCED.md#known-limits).
- Common problems and fixes: [Need help?](README.md#need-help) in the README, and
  [Troubleshooting](README-ADVANCED.md#15-troubleshooting) in the advanced guide.
- A PC never shows up on the MommaDock: same network, `RH_NODE=1` on the PC, and on Unraid the MommaDock on `br0`.
- A station ignores the controller: Xbox-style controllers only (others through Steam Input or DS4Windows); in player
  mode, sign in first, then press A.
