# 🦆 RetroDuck: the beginner's guide

**RetroDuck lets you play old console games with your friends through a web link.** You run it on your computer,
your friends open the link in their web browser, and you play together. Your friends don't install anything.

This guide assumes you've never done anything like this before. Go in order:

1. **[Part 1](#part-1-your-first-game-everyone-starts-here)**: get one game running on your own computer (about 15 minutes). Everyone starts here.
2. **[Part 2](#part-2-play-with-friends)**: play it with friends, in the same house or far away.
3. **Stop there if that's all you want.** Parts 3 to 8 are extras for later: a TV, guests on their phones, an arcade
   cabinet, a LAN party, a NAS.

Something not working? Jump to [When something goes wrong](#when-something-goes-wrong).

---

## What you need before you start

- **A Windows PC** (10 or 11) with internet. macOS and Linux work too, but this guide is written for Windows; see
  [Get started](README.md#get-started-windows) in the README for those.
- **Your own games, as files.** RetroDuck comes with **no games**. A game file (often called a **ROM**) is a copy of a
  cartridge or disc. Only use copies of games you own.
- **Start with an older console** such as NES, Super Nintendo, Genesis, Game Boy or PlayStation. They run right inside
  the browser and need nothing else. Newer consoles (PS2, GameCube and up) need a separate emulator program; leave those
  for later.

---

## Part 1: Your first game (everyone starts here)

### Step 1. Unzip RetroDuck into a folder you'll keep

1. Download `RetroDuck0.4.8.zip`.
2. Right-click it > **Extract All…** and pick a folder you'll keep, for example `C:\Games\RetroDuck`.
   Don't run it from inside the zip, and don't leave it somewhere you clean out, like Downloads.

✔ You should now have a folder with files like `launch.bat`, `README.md` and a `roms` folder.

### Step 2. Start it for the first time

1. In that folder, **double-click `launch.bat`**.
2. If it says **Python** or **Node.js** is missing, let it install them (it checks every download before it uses it).
   These are two free programs RetroDuck runs on. You only do this once.
3. It asks whether you want a **desktop shortcut** with the duck icon. Say yes: next time, just double-click the duck.

✔ A small **RetroDuck window** opens. This is the control panel for your hub; keep it open while you play.

### Step 3. Start the hub

1. In the RetroDuck window, press **▶ Start**.
2. Your web browser opens the hub at `http://localhost:8080`. (`localhost` means "this computer". That address only
   works on your own PC; Part 2 shows how friends get in.)

✔ You see the RetroDuck page asking for a name.

### Step 4. Make your account, then save it

1. Type a name and continue. That's your account: there's no password and no email.
2. **Now press Export account** in the top bar and save the file somewhere safe (a USB stick, your documents).

Why this matters: your account lives in your browser. If you clear your browser data or change computers, that file
is the **only** way to get your account back.

### Step 5. Add a game

1. Open the `roms` folder inside your RetroDuck folder.
2. Make a folder named after the console, exactly as below, and put the game file in it:

| Console | Folder name | Game files usually end in |
| --- | --- | --- |
| NES | `roms/nes` | `.nes` |
| Super Nintendo | `roms/snes` | `.sfc`, `.smc` |
| Genesis / Mega Drive | `roms/genesis` | `.md`, `.gen`, `.smd` |
| Game Boy | `roms/gb` | `.gb` |
| Game Boy Color | `roms/gbc` | `.gbc` |
| Game Boy Advance | `roms/gba` | `.gba` |
| Nintendo 64 | `roms/n64` | `.z64`, `.n64`, `.v64` |
| PlayStation | `roms/psx` | `.chd`, `.cue` (with its `.bin`), `.pbp` |

`.zip` and `.7z` files work too, as long as they're in the right console folder. Already have your games somewhere
else? In the RetroDuck window use **Settings → Consoles…** to point each console at that folder instead.

### Step 6. Unlock your library

Your games are private: only you (the **owner**) can see the whole library.

1. In the RetroDuck window, open the **Settings** tab and press **Show** next to the owner password. Copy it.
2. In the hub, press **Unlock library** and paste the password.

✔ Your game appears in the library. Not there? See [When something goes wrong](#when-something-goes-wrong).

### Step 7. Play it

1. Click your game and open a lobby (a **lobby** is a room for one game; friends join it later).
2. Start the game.
3. Plug in a controller, or use the keyboard.

The **first time** you play each console, RetroDuck downloads that console's emulator piece (a "core") from the
internet. After that it's saved on your PC.

✔ **You did it.** That's the whole basic setup. Next time: double-click the duck, press ▶ Start, play.

---

## Part 2: Play with friends

### First, pick how you want to play

When you open a lobby you choose a mode:

| Mode | What happens | Do friends need the game file? | Lag |
| --- | --- | --- | --- |
| **Co-op** | One game runs on your PC; friends see it and press buttons, like sitting on your couch. | **No** | A little, more for friends far away |
| **Ghost** | Everyone plays their own copy side by side and sees the others as ghosts. | Yes, their own copy | None |
| **Race** | Everyone plays their own copy; first to the finish wins. | Yes, their own copy | None |

Not sure? Use **Co-op**.

### Friends in your home (same Wi-Fi)

1. In your lobby press **Copy invite link** and send it to them (a message, a chat app…).
2. They open it in their browser, type a name, and they're in.

Tip: ☰ Menu > **🏠 Wi-Fi name** gives your hub an easy address like `http://yourname.local`, so people at home can just
type it. Both only work on your own network.

### Friends anywhere

1. In the hub, open ☰ Menu > **🌍 Internet link** and switch it on. It's free and needs no router setup.
2. Then **Copy invite link** in your lobby and send it.

### What your friends need

- A web browser. **Chrome or Edge** work best. Firefox only gets controllers over the 🌍 Internet link (secure
  `https://` pages), not over a plain home address.
- A controller is optional; a keyboard works, and phones get touch controls.

---

## Part 3: Nicer at home (optional)

- **📺 Big screen**: ☰ Menu > 📺 Big screen turns the hub into a launcher made for a TV and a controller.
- **Let family play on their own phones**: use the [Pond](#part-5-the-pond-guests-play-on-their-own-phones). They see
  only the games you pick, never your whole library.
- **Updates**: in the RetroDuck window, **Server → Check for updates**. Your games, accounts and settings are kept,
  and every replaced file is backed up first.

---

## Part 4: Getting ready for the extras (commands and settings files)

Parts 6 to 8 need a couple of typed commands and a settings file. Here's how, once.

### Open a command window in your RetroDuck folder

1. Open your RetroDuck folder in File Explorer.
2. Click the address bar at the top (where the folder path is), type `cmd` and press Enter.
3. A black window opens, already "in" your RetroDuck folder. Type commands exactly as shown and press Enter.

If it says `'python' is not recognized`, type `py` instead of `python` (for example `py stations.py monitors`).

### Change a setting in `.env`

`.env` is RetroDuck's settings file. It's made automatically the first time you start, in your RetroDuck folder.

1. Right-click `.env` > **Open with** > **Notepad**.
2. Each line is `NAME=value`. To switch something on, add a new line at the bottom, for example `MOMMADOCK=1`.
   (`.env.example` lists every setting; a `#` at the start of a line means "ignored".)
3. Save, then press **↻ Restart** in the RetroDuck window. Settings only take effect after a restart.

### Edit `stations.json`

Open it with Notepad the same way. It uses quotes and commas: change only the value between the quotes or after the
colon, and leave every `"`, `,`, `{` and `}` where it is. If you break it, `stations.py` says
"stations.json could not be read" with the reason; undo your change and try again.

---

## Part 5: The Pond: guests play on their own phones

**🧪 New**: it works on a test setup but hasn't been tried with real phones at a real party yet.

The Pond is a simple page for guests: they scan a QR code with their phone and play games **you** picked, on their
own phone or laptop. They never see the rest of your library or any owner buttons.

1. In the hub: ☰ Menu > **🌊 Pond**.
2. Search your library and press **+ Add** on up to 60 games. Only consoles that run in the browser can be added (no
   PS2, GameCube, PC games, or games you've hidden), because each guest's own device runs the game.
3. Type an event name and switch **Pond is open** on.
4. Show the QR code: on your screen, or press **📺 Show on a TV** for a big version.

✔ A guest scans the code, taps a name to make an account, and picks **Start a game** or **Join a game**.

- If the page warns **"This link only works on this computer"**, turn on ☰ Menu > 🏠 **Wi-Fi name**, or open the Pond
  page from another device, so phones get an address they can reach.
- Switch **Pond is open** off and guests lose access at once.
- If you have other RetroDucks on the same network (Part 7), the Pond also lists their open rooms under **On this
  network**: **Join** when there's a free seat, **In use** when it's full, **🔒 Locked** when locked, and **Play here** for
  an idle machine.
- Each game has **🏆 Scores**: players type in their own score, so scores show as **Unverified**.

---

## Part 6: An arcade cabinet, or several screens on one PC

**🧪 New**, Windows only. You'll use a few commands ([Part 4](#part-4-getting-ready-for-the-extras-commands-and-settings-files)
shows how).

A **station** is one screen + one controller + its own game window, like one arcade cabinet. One PC can run up to 4
(Windows has 4 slots for Xbox-style controllers).

**Controllers:** Xbox-style controllers work directly. PlayStation, Switch or arcade sticks need a free helper program
such as Steam Input or DS4Windows to look like an Xbox controller.

### One arcade cabinet

1. Start the hub as usual (▶ Start in the RetroDuck window).
2. In the command window: `python stations.py init --count 1`. This creates `stations.json` with one station on
   your main monitor.
3. Open `stations.json` in Notepad. Change `"mode": "player"` to `"mode": "seat"` and make sure it says `"pad": 1`.
   **Seat mode** means "controller 1 always plays here": walk up and play, no sign-in for the controller.
4. `python stations.py plan` shows what will happen, without changing anything.
5. `python stations.py start --windowed` the first time: a normal window opens; sign in there once. It remembers you.
6. From now on: `python stations.py start` opens it full screen, and `python stations.py stop` closes it.

### Several screens on one PC

1. `python stations.py monitors` lists your screens (1 is the main one).
2. `python stations.py init --count 2` (or 3, or 4): one station per screen.
3. For each station in `stations.json`, pick a mode:
   - **Player mode** (the default): sign in on that screen, then press A to take the controller. With several screens
     waiting, each asks for its own direction + A, so one press only takes one screen. It's yours until you sign out.
   - **Seat mode**: give each screen its own controller with `"pad": 1`, `2`, `3` or `4`.
4. `python stations.py start --windowed` once to sign in on each, then `python stations.py start`.
5. `python stations.py status` shows what's running; `python stations.py stop` closes them all.

Good to know: all sound comes out of the PC's normal speakers (a speaker per station isn't built yet), and RetroDuck
doesn't start by itself when Windows starts.

---

## Part 7: A LAN party with several PCs (advanced)

**🧪 New and advanced.** Do Parts 1 and 6 on every PC first and make sure each works on its own.

At a LAN party with several PCs, one RetroDuck becomes the **MommaDock**: the boss that sees every machine on the
network, starts and stops their stations, and runs the Pond so guests' phones can find every open game.

```
   MommaDock (a NAS, or one PC)  ── sees everything, starts stations, Pond for phones
        │   all on the same network
   ┌────┴────────────┬─────────────────┐
   PC 1              PC 2               laptop / cabinet
   stations 1-4      stations 1-4       one station
```

**Why bother, instead of a separate RetroDuck on each PC?** You'd still have one RetroDuck per PC; the MommaDock adds
one screen that shows all of them, starts and stops every PC's stations from one place, and gives guests one Pond for
the whole party.

### A week before (with internet)

1. Set up every PC with its stations (Part 6).
2. **On every PC, play each console you'll use once.** The emulator pieces download the first time and are then saved,
   so the party itself can run without internet.
3. Put the same RetroDuck version on every machine.

### Set up the MommaDock

Pick one:
- **A normal Windows PC**: add `MOMMADOCK=1` to its `.env` ([Part 4](#change-a-setting-in-env)), then ↻ Restart.
- **A NAS** (Part 8): add `MOMMADOCK=1`. On Unraid the container must be on the **`br0`** network with its own address
  (or "host" networking on other NAS systems); Docker's normal network can't see the other PCs. Docker Desktop on a
  Windows or Mac PC can't either: use the Windows option there.

### Connect each PC (once)

1. On the PC, add two lines to `.env`: `RH_NODE=1` and a name like `RH_NAME=PC 1`. ↻ Restart.
2. On the MommaDock, open ☰ Menu > **🦆 MommaDock**. The PC appears under **Duckling nodes** with a **6-digit code**.
3. Press **Approve** there.
4. On the PC, open ☰ Menu > **🐣 Duckling node**. If it shows **the same code**, press **Accept**.
   A different code means something on the network is pretending: don't accept.

✔ The board now has **Start stations**, **Stop stations** and **Status** for that PC.

The MommaDock can only start, stop and check stations on a PC you connected. It can't run programs, read files or
change settings there. To disconnect: **Forget** on the MommaDock or **Leave** on the PC; reconnecting needs the code
check and Accept again.

### On the day

1. Start the MommaDock, then every PC.
2. **Status**, then **Start stations** from the board.
3. Open the Pond on the MommaDock and put **📺 Show on a TV** on a screen near the door. Guests' phones show every
   open game in the room.

---

## Part 8: Running it on a NAS (advanced)

A **NAS** is a small always-on storage box at home. RetroDuck can run on one in Docker. It plays the **browser
consoles** (NES, SNES, Genesis, Game Boy, PlayStation and more), but not the newer consoles that need emulator programs.
The games run on each player's own device, so even a small NAS is fine.

1. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` to a long password of your own.
2. In `docker-compose.yml`, point the `roms` volume at your games folder.
3. Run `docker compose up -d --build`.
4. Open `http://<your NAS's address>:8080` and make your account.
5. Turn on the Pond (Part 5): every phone and laptop at home becomes a player.

Later you can add `MOMMADOCK=1` to make the NAS the MommaDock for a LAN party (Part 7). Details: [Docker and
NAS](README-ADVANCED.md#10-docker-and-nas).

---

## When something goes wrong

| What you see | What to do |
| --- | --- |
| `launch.bat` says Python wasn't found | Install Python from python.org with **Add python.exe to PATH** ticked, then double-click `launch.bat` again. |
| The browser didn't open | Open `http://localhost:8080` yourself while the hub is started. |
| There's no library / my games aren't shown | Press **Unlock library** (Part 1, Step 6). Still missing? Check the folder name and file type (Step 5), and **Show hidden** in the library. |
| Stuck on "Download Game Core" | The first game on each console needs internet once. |
| A friend far away can't connect | Use ☰ Menu > 🌍 Internet link and send the new invite link. |
| A Firefox friend's controller does nothing | Firefox needs the 🌍 Internet link (https) for controllers; or use Chrome or Edge. |
| I lost my account | Use your **Export account** file on the sign-in page. Without it, make a new account. |
| Phones can't open the Pond | Turn on ☰ Menu > 🏠 Wi-Fi name, or use the 🌍 Internet link. |
| A station ignores my controller | Xbox-style controllers only (others through Steam Input or DS4Windows). In player mode, sign in first, then press A. |
| A PC doesn't show up on the MommaDock | Same network? `RH_NODE=1` in that PC's `.env` and ↻ Restart? On Unraid, is the MommaDock on `br0`? |

More: [Need help?](README.md#need-help) in the README, [Troubleshooting](README-ADVANCED.md#15-troubleshooting) and
[Known limits](README-ADVANCED.md#known-limits) in the advanced guide.

---

## Words you'll see

| Word | Meaning |
| --- | --- |
| **ROM** | A game file: a copy of a cartridge or disc you own. |
| **BIOS** | A system file some consoles need. The consoles in Part 1 don't. |
| **Hub** / **duck** | RetroDuck running on a computer. The one on your own PC is your **main hub**. |
| **Owner** | You: the person running the hub. Only the owner sees the whole library. |
| **Lobby** | A room for one game that friends join. |
| **Core** | The piece that emulates a console in the browser; downloaded once per console. |
| **Duckling** | An extra RetroDuck started from the same folder, for more rooms at once. Stations use them. |
| **Station** | One screen + one controller + one game window, like an arcade cabinet (Part 6). |
| **Player mode / Seat mode** | How a station picks its player 1: sign in and press A, or a fixed controller (Part 6). |
| **Pond** | The guest page: scan a code, play on your own phone (Part 5). |
| **MommaDock** | The boss RetroDuck at a LAN party: sees every machine and starts their stations (Part 7). |
| **Duckling node** | A PC connected to a MommaDock with the 6-digit code (Part 7). |
| **NAS** | A small always-on storage box at home (Part 8). |
| **SeaDuck** | RetroDuck's project website (planned). Nothing to do with your own network. |

**🧪** in this guide means "new": it works on a test setup, but hasn't been tested with real controllers, phones,
several PCs or a NAS yet. Tell us how it goes.
