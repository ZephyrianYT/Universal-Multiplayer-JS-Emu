# Retro Hub + OBS

This is a guide to streaming Retro Hub with OBS Studio: capturing the game, adding the *Now playing / Up next* overlay, styling it, and fixing it when it breaks.

For Streamer Mode itself (waiting room, seat rotation, viewer effects), see [README-ADVANCED.md → Streamer Mode](../README-ADVANCED.md#streamer-mode).

---

## Contents

1. [Quick setup](#quick-setup)
2. [Capturing the game](#capturing-the-game)
3. [The queue overlay](#the-queue-overlay)
4. [URL options](#url-options)
5. [Styling the overlay with custom CSS](#styling-the-overlay-with-custom-css)
6. [Building your own overlay (JSON API)](#building-your-own-overlay-json-api)
7. [Privacy on stream](#privacy-on-stream)
8. [Hotkeys](#hotkeys)
9. [Troubleshooting](#troubleshooting)

---

## Quick setup

1. In the Retro Hub window, press **▶ Start**. Use **Internet (Cloudflare Tunnel)** mode if viewers outside your Wi-Fi will play.
2. Host a **Co-op** game and turn on **Streamer Mode** in the lobby's **Match** card.
3. In the Match card, press **Copy** next to the OBS address. It looks like `http://localhost:8080/overlay/queue`.
4. In OBS: **Sources → + → Browser**, paste the address into **URL**, and set the size to about **460 × 400**.
5. Add a capture source for the game itself (see the next section).
6. Post your lobby's invite link in chat so viewers can join the line.

---

## Capturing the game

How you capture depends on where the game runs.

| Game runs in… | Capture with | Viewer picture effects visible? |
| --- | --- | --- |
| The browser (NES, SNES, N64, GBA, PS1…) | **Window Capture** of the browser window (or a dedicated browser window for the hub) | ✅ Yes |
| A native emulator (PS2, GameCube, Switch…) | **Window Capture** / **Game Capture** of the emulator window | ❌ No, they only show on the hub page |
| A native emulator, effects wanted | Capture the **hub's browser tab**, which shows the stream of the native game | ✅ Yes |

**Why picture effects disappear:** effects like Upside down, Mirror, Tiny screen, Invert colors and Black & white are applied to the hub page's view of the game. A capture taken straight from the emulator's own window never goes through that view. Control effects (invert, swap A/B, freeze) work either way, because they change inputs, not the picture.

**Tips**

- Give the hub its own browser window (not a tab among others) so Window Capture doesn't jump when you switch tabs.
- For game audio only, use OBS's **Application Audio Capture** on the browser or emulator instead of capturing all desktop audio. That keeps Retro Hub's voice chat out of the stream, or in it if you want it there.
- Turn on the hub's **Hide the code, invite link and passwords on my screen** before you go live (see [Privacy on stream](#privacy-on-stream)).

---

## The queue overlay

**Address:** `http://localhost:<port>/overlay/queue`. The default port is **8080**. If you changed it, the **Copy** button in the Match card always gives the right address.

**What it shows**

- **Now playing:** the game and console, then seats **P1–P4** with each player's name. Guest seats show **turn time left** (`m:ss`) when the turn timer is on. Seats played on the host's PC show as *"<host>'s PC"*.
- **Up next:** the first **5** people in the waiting line, plus *"+N more"* if the line is longer. If nobody is waiting, it says *"Nobody waiting. Join the stream's lobby!"* This part only appears in Streamer Mode lobbies.

**How it behaves**

- The background is transparent, and the overlay refreshes every **2 seconds**.
- With no lobby to show, it hides itself completely, so you can leave the source in your scene all the time.
- It shows names only: no IDs, codes or passwords.
- Without `?room=`, it picks the Streamer Mode lobby hosted **from this PC**. If there are several, it picks the most recently started one.

**Security:** the overlay answers **only to the hub's own computer**. Any request that comes in through the Cloudflare Tunnel or a proxy is refused (`403`), even if it arrives on localhost. That's why it needs no account or password. It isn't reachable online.

---

## URL options

Add these to the address. Separate the first with `?` and any more with `&`.

| Option | Example | What it does |
| --- | --- | --- |
| `room` | `?room=ABCD` | Show one specific lobby by its code instead of auto-picking. Works for any lobby on this hub, including ones that aren't in Streamer Mode (then only *Now playing* shows). |
| `side` | `?side=right` | Right-align the box, for the right edge of your scene. |
| `scale` | `?scale=1.5` | Zoom the overlay. Allowed range is about 0.3–4. Values outside it are ignored. |

Combined: `http://localhost:8080/overlay/queue?room=ABCD&side=right&scale=1.25`

> Using `scale` gives sharper text than stretching the source in OBS. If you scale up, make the Browser Source bigger to match.

---

## Styling the overlay with custom CSS

OBS Browser Sources have a **Custom CSS** box. These are the overlay's parts:

| Selector | What it is |
| --- | --- |
| `.box` | The whole panel (dark background, yellow left border) |
| `h1` | The *Now playing* / *Up next* headings |
| `.game` | The game · console line |
| `.slot` | `P1`…`P4` and `1.`…`5.` labels |
| `.name` | Player names |
| `.t` | Turn time left |
| `.next` | The *Up next* section |
| `body.right` | Present when `?side=right` is used |

**Examples**

```css
/* Purple accent instead of yellow */
.box { border-left-color: #a855f7; }
h1, .slot { color: #a855f7; }

/* Fully transparent panel, text with a shadow */
.box { background: none; box-shadow: none; }
body { text-shadow: 0 2px 4px #000; }

/* Different font (must be installed on this PC) */
body { font-family: "Press Start 2P", monospace; font-size: 14px; }

/* Hide Up next, show only who's playing */
.next { display: none; }

/* Hide the turn timer */
.t { display: none; }
```

Keep OBS's default `body { background-color: rgba(0,0,0,0); ... }` line in the Custom CSS box, or the background stops being transparent.

---

## Building your own overlay (JSON API)

The overlay reads `http://localhost:<port>/api/overlay` (with an optional `?room=CODE`). You can read the same data from your own Browser Source page, a StreamerBot / Touch Portal action, or a script. The same rule applies: **this PC only, not through a tunnel or proxy.**

**With a lobby:**

```json
{
  "on": true,
  "streamer": true,
  "game": "Super Mario Kart",
  "system": "SNES",
  "phase": "playing",
  "seats": [
    { "slot": 0, "name": "HostName's PC", "host": true,  "left": null },
    { "slot": 1, "name": "Viewer1",       "host": false, "left": 184000 }
  ],
  "next": ["Viewer2", "Viewer3"],
  "waiting": 2
}
```

**With no lobby:** `{ "on": false }`

| Field | Meaning |
| --- | --- |
| `on` | `false` means nothing to show (hide your overlay) |
| `streamer` | Whether Streamer Mode is on for this lobby |
| `game`, `system` | Game title and console name |
| `phase` | `lobby`, `loading`, `countdown` or `playing` |
| `seats[].slot` | Seat number, starting at 0 (P1 = 0) |
| `seats[].left` | Turn time left in **milliseconds**, or `null` with no timer (or the host's seats) |
| `next` | Up to 5 names next in line |
| `waiting` | Total people in line (can be more than `next`) |

Poll it every 1–2 seconds. It's cheap, but there's no reason to go faster than the overlay does.

---

## Privacy on stream

- **Hide the code, invite link and passwords on my screen** (in the lobby) blurs the lobby code, passwords, the overlay address and your account ID on *your* screen. The **Copy** buttons still work, so you can paste the invite into chat without showing it.
- It's saved per browser. Every player can turn it on for themselves.
- The owner password lives in the Retro Hub window under **Settings → Owner password**. Don't open that while the window is being captured.
- If you use **Display Capture** (the whole screen), anything you open is on stream. Window Capture of only the hub and emulator is safer.

---

## Hotkeys

| Key | Where | Does |
| --- | --- | --- |
| **Ctrl+Shift+R** | The hub's browser tab has focus | ↻ Rotate seats (host, Streamer Mode) |
| **↻** button | Match top bar / Match card | Same as above |

There is **no** global hotkey that works while a native emulator's window has focus. That would need a system-wide keyboard hook, which is how keyloggers work and what antivirus flags, so it's left out on purpose. Use the ↻ button, or bind an OBS hotkey or Stream Deck button to switch focus to the hub tab first.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Overlay is blank | Normal when there's no lobby to show. Open a Co-op lobby with Streamer Mode on, or add `?room=CODE`. Right-click the source → **Refresh** if you changed lobbies. |
| `Only on the hub's own computer.` / 403 | OBS has to run on the **same PC** as the hub and use `localhost`, not your Wi-Fi IP or the tunnel address. |
| Overlay doesn't load in Docker | Requests to a container usually arrive from Docker's network, not from `127.0.0.1`, so the hub refuses them. Run the hub natively on your streaming PC to use the overlay. |
| Wrong lobby shown | Add `?room=CODE` to pin it to one lobby. |
| Wrong port / "can't connect" | Copy the address from the Match card again. It always uses the hub's real port. Make sure the hub is started. |
| Black background instead of transparent | Keep OBS's default transparent `body` line in Custom CSS. |
| Text blurry | Use `?scale=` instead of stretching the source, and make the source bigger. |
| Picture effects not on stream | You're capturing the native emulator's window. Capture the hub's browser tab instead (see [Capturing the game](#capturing-the-game)). |
| Timer doesn't show | The turn timer is off (Match card), or that seat belongs to the host. |
