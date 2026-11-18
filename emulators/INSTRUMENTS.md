# Guitars and drum kits (Guitar Hero, Rock Band)

These games run in the native emulators on the host's PC (PS2: PCSX2, Wii: Dolphin, PS3: RPCS3). EmulatorJS in the
browser can't run them.

## Instruments plugged into the host's PC

Set them up in the emulator itself, as you would without Retro Hub. Retro Hub doesn't get in the way.

## Friends playing over the stream

1. Each friend opens **🎸 Instruments** in the hub (☰ menu, or *Sound, controls & stream* in a lobby).
   - **Xbox 360 instruments**: usually nothing to do (*Automatic*). Check them in **Test**.
   - **PS3, Wii and Rock Band / Guitar Hero USB dongles**: press **🎸 Guitar** or **🥁 Drums** and press each part once.
2. On the host's PC each friend's seat is a **virtual Xbox 360 controller** (needs ViGEmBus + `vgamepad`, see
   `requirements-native.txt`; keyboard mode can't carry instruments). The parts always land on the same buttons:

| Guitar | Virtual Xbox button |   | Drums | Virtual Xbox button |
| --- | --- | --- | --- | --- |
| Green fret | A | | Green pad | A |
| Red fret | B | | Red pad | B |
| Yellow fret | Y | | Yellow pad | Y |
| Blue fret | X | | Blue pad | X |
| Orange fret | LB | | Bass (kick) pedal | LB |
| Strum up / down | D-pad up / down | | Orange cymbal (GH kits) | RB |
| Start | Start | | Start | Start |
| Star Power (button or tilt) | Back | | Select | Back |
| Whammy | Right stick, right | | | |

3. In the emulator, give that virtual controller to the player's port and map it to the emulator's guitar / drums,
   using the table. Menu names change between versions; look for these:
   - **RPCS3 (PS3)**: *Pads* → the player's tab → handler *XInput*, the virtual controller → device class **Guitar**
     (or **Drums**) → map the buttons. Several instruments at once have had issues in some RPCS3 versions; give each
     player their own port and check each one.
   - **PCSX2 (PS2)**: *Settings → Controllers* → the player's port → controller type **Guitar** → map the buttons
     (a per-game input profile keeps your normal pad setup untouched). Drum kits are USB devices: *Settings → USB*.
   - **Dolphin (Wii)**: *Controllers* → *Wii Remote* → *Emulated* → *Configure* → *Extension*: **Guitar** or
     **Drum Kit** → map the buttons.
   - **Xenia (Xbox 360)**: 360 music games expect a real guitar or drum kit, and a virtual controller is a normal
     gamepad, so friends' instruments may not be accepted there.
4. **Lag**: friends see and hear the stream a little late. Have each player run the game's own **audio / video
   calibration** once (it's in every Guitar Hero and Rock Band). The host's own instruments don't need it.
