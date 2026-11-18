#!/usr/bin/env python3
"""Retro Hub input bridge: guest controllers -> local input for native emulators.

Started by the hub server (core/streaming/native.mjs) while a native game (PCSX2, Dolphin, RPCS3, Xenia, Cemu)
is hosted. It reads fixed-size binary frames from stdin and turns each online seat into local input:

  gamepad   one virtual Xbox 360 controller per seat (full analog).
            Windows: vgamepad + ViGEmBus driver (pip install vgamepad). Linux: python-evdev + /dev/uinput.
  keyboard  Windows only, no installs: each seat (P2, P3, P4) gets its own set of keys, pressed with the
            system's SendInput. Sticks become 8-way digital. Keys are sent ONLY while the focused window
            belongs to the app Retro Hub started (its container, see apps.py), or with no container to a
            program inside the emulators folder, so guests can never type into anything else.
            Layout: emulators/KEYBOARD.md (python input_bridge.py --keymap prints it).
  auto      gamepad when it works, else keyboard (default).

Frame: [u8 slot][u8 version=1][24 x u16 little-endian], values in the hub's RetroPad numbering:
  0 B, 1 Y, 2 Select, 3 Start, 4 Up, 5 Down, 6 Left, 7 Right, 8 A, 9 X, 10 L, 11 R, 12 L2, 13 R2, 14 L3, 15 R3,
  16-19 left stick right/left/down/up, 20-23 right stick right/left/down/up (0..32767). Buttons are 0/1.
RetroPad is the SNES layout (B bottom, A right, Y left, X top), which maps onto Xbox positions:
  B->A, A->B, Y->X, X->Y.

  python input_bridge.py --check [--mode M] [--emu-dir D]   print {"ok": ..., "mode": ...} and exit
  python input_bridge.py --slots 1,2,3 [--mode M] [--emu-dir D]
  python input_bridge.py --keymap                            print the keyboard layout (Markdown)
"""
import argparse
import json
import os
import struct
import sys
import threading
import time

FRAME = 2 + 24 * 2
UNPACK = struct.Struct("<BB24H").unpack
MAX = 32767
HALF = MAX // 2
ID_NAMES = ["B / Cross (bottom)", "Y / Square (left)", "Select / Back", "Start", "D-pad up", "D-pad down", "D-pad left",
            "D-pad right", "A / Circle (right)", "X / Triangle (top)", "L / L1 / LB", "R / R1 / RB", "L2 / ZL / LT",
            "R2 / ZR / RT", "L3 (left stick click)", "R3 (right stick click)", "Left stick right", "Left stick left",
            "Left stick down", "Left stick up", "Right stick right", "Right stick left", "Right stick down",
            "Right stick up"]


def axis(pos, neg):
    """Two half-axes (0..32767 each) -> one signed axis."""
    return max(-32768, min(32767, int(pos) - int(neg)))


# ------------------------------------------------------------------ gamepad: Windows (vgamepad / ViGEmBus)
class WindowsPads:
    name = "virtual Xbox 360 controllers (ViGEmBus)"
    mode = "gamepad"

    def __init__(self):
        import vgamepad as vg  # raises if the package or the ViGEmBus driver is missing
        self.vg = vg
        B = vg.XUSB_BUTTON
        self.buttons = {
            0: B.XUSB_GAMEPAD_A, 8: B.XUSB_GAMEPAD_B, 1: B.XUSB_GAMEPAD_X, 9: B.XUSB_GAMEPAD_Y,
            2: B.XUSB_GAMEPAD_BACK, 3: B.XUSB_GAMEPAD_START,
            4: B.XUSB_GAMEPAD_DPAD_UP, 5: B.XUSB_GAMEPAD_DPAD_DOWN, 6: B.XUSB_GAMEPAD_DPAD_LEFT, 7: B.XUSB_GAMEPAD_DPAD_RIGHT,
            10: B.XUSB_GAMEPAD_LEFT_SHOULDER, 11: B.XUSB_GAMEPAD_RIGHT_SHOULDER,
            14: B.XUSB_GAMEPAD_LEFT_THUMB, 15: B.XUSB_GAMEPAD_RIGHT_THUMB,
        }

    def create(self, slot):
        return self.vg.VX360Gamepad()

    def apply(self, pad, v):
        for i, btn in self.buttons.items():
            (pad.press_button if v[i] else pad.release_button)(button=btn)
        pad.left_trigger(value=255 if v[12] else 0)
        pad.right_trigger(value=255 if v[13] else 0)
        # XInput: +Y is up
        pad.left_joystick(x_value=axis(v[16], v[17]), y_value=axis(v[19], v[18]))
        pad.right_joystick(x_value=axis(v[20], v[21]), y_value=axis(v[23], v[22]))
        pad.update()

    def destroy(self, pad):
        try:
            pad.reset()
            pad.update()
        except Exception:
            pass
        del pad


# ------------------------------------------------------------------ gamepad: Linux (python-evdev / uinput)
class LinuxPads:
    name = "virtual gamepads (uinput)"
    mode = "gamepad"

    def __init__(self):
        from evdev import AbsInfo, UInput, ecodes as e  # raises if python-evdev is missing
        self.UInput, self.e = UInput, e
        self.buttons = {
            0: e.BTN_SOUTH, 8: e.BTN_EAST, 1: e.BTN_WEST, 9: e.BTN_NORTH, 2: e.BTN_SELECT, 3: e.BTN_START,
            10: e.BTN_TL, 11: e.BTN_TR, 14: e.BTN_THUMBL, 15: e.BTN_THUMBR,
        }
        stick = AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)
        trig = AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)
        hat = AbsInfo(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)
        self.caps = {
            e.EV_KEY: list(self.buttons.values()) + [e.BTN_MODE],
            e.EV_ABS: [(e.ABS_X, stick), (e.ABS_Y, stick), (e.ABS_RX, stick), (e.ABS_RY, stick),
                       (e.ABS_Z, trig), (e.ABS_RZ, trig), (e.ABS_HAT0X, hat), (e.ABS_HAT0Y, hat)],
        }
        # Fail now (not on the first guest) when /dev/uinput isn't writable.
        self.destroy(self.create(-1))

    def create(self, slot):
        # Xbox 360 ids so SDL-based emulators pick a sensible default mapping.
        return self.UInput(self.caps, name=f"Retro Hub Virtual Pad {slot + 1}", vendor=0x045E, product=0x028E, version=0x110)

    def apply(self, ui, v):
        e = self.e
        for i, code in self.buttons.items():
            ui.write(e.EV_KEY, code, 1 if v[i] else 0)
        ui.write(e.EV_ABS, e.ABS_Z, 255 if v[12] else 0)
        ui.write(e.EV_ABS, e.ABS_RZ, 255 if v[13] else 0)
        ui.write(e.EV_ABS, e.ABS_HAT0X, (1 if v[7] else 0) - (1 if v[6] else 0))
        ui.write(e.EV_ABS, e.ABS_HAT0Y, (1 if v[5] else 0) - (1 if v[4] else 0))
        # evdev: +Y is down
        ui.write(e.EV_ABS, e.ABS_X, axis(v[16], v[17]))
        ui.write(e.EV_ABS, e.ABS_Y, axis(v[18], v[19]))
        ui.write(e.EV_ABS, e.ABS_RX, axis(v[20], v[21]))
        ui.write(e.EV_ABS, e.ABS_RY, axis(v[22], v[23]))
        ui.syn()

    def destroy(self, ui):
        try:
            ui.close()
        except Exception:
            pass


# ------------------------------------------------------------------ keyboard: Windows SendInput (no installs)
# Keys are sent as hardware scan codes (set 1), which DirectInput, Raw Input, SDL and Qt all read, independent
# of the keyboard language. F-keys, Esc, Tab, Space, Enter, Backspace and modifiers are never used: emulators
# keep their hotkeys there. Order of each list = hub ids 0..23 (see ID_NAMES).
def _k(name, scan, ext=False):
    return (name, scan, ext)


KEYMAP = {
    1: [  # P2: letters
        _k("K", 0x25), _k("J", 0x24), _k("V", 0x2F), _k("B", 0x30), _k("T", 0x14), _k("G", 0x22), _k("F", 0x21),
        _k("H", 0x23), _k("L", 0x26), _k("I", 0x17), _k("Q", 0x10), _k("E", 0x12), _k("Z", 0x2C), _k("C", 0x2E),
        _k("X", 0x2D), _k("M", 0x32), _k("D", 0x20), _k("A", 0x1E), _k("S", 0x1F), _k("W", 0x11), _k("O", 0x18),
        _k("Y", 0x15), _k("N", 0x31), _k("U", 0x16)],
    2: [  # P3: number row and punctuation
        _k("'", 0x28), _k(";", 0x27), _k("P", 0x19), _k("R", 0x13), _k("5", 0x06), _k("6", 0x07), _k("4", 0x05),
        _k("7", 0x08), _k("\\", 0x2B), _k("]", 0x1B), _k("1", 0x02), _k("0", 0x0B), _k("2", 0x03), _k("9", 0x0A),
        _k("`", 0x29), _k("Numpad *", 0x37), _k("/", 0x35), _k(",", 0x33), _k(".", 0x34), _k("[", 0x1A), _k("=", 0x0D),
        _k("3", 0x04), _k("8", 0x09), _k("-", 0x0C)],
    3: [  # P4: numpad, arrows and the navigation block (keep Num Lock ON)
        _k("Numpad 2", 0x50), _k("Numpad 4", 0x4B), _k("Numpad -", 0x4A), _k("Numpad +", 0x4E), _k("Up", 0x48, True),
        _k("Down", 0x50, True), _k("Left", 0x4B, True), _k("Right", 0x4D, True), _k("Numpad 6", 0x4D),
        _k("Numpad 8", 0x48), _k("Numpad 7", 0x47), _k("Numpad 9", 0x49), _k("Numpad 1", 0x4F), _k("Numpad 3", 0x51),
        _k("Numpad 0", 0x52), _k("Numpad .", 0x53), _k("Page Down", 0x51, True), _k("Delete", 0x53, True),
        _k("End", 0x4F, True), _k("Home", 0x47, True), _k("Numpad Enter", 0x1C, True), _k("Numpad /", 0x35, True),
        _k("Numpad 5", 0x4C), _k("Insert", 0x52, True)],
}


def keymap_markdown():
    code = lambda s: f"`` {s} ``" if "`" in s else f"`{s}`"  # noqa: E731
    rows = ["| Button | P2 | P3 | P4 |", "| --- | --- | --- | --- |"]
    for i, n in enumerate(ID_NAMES):
        rows.append(f"| {n} | {code(KEYMAP[1][i][0])} | {code(KEYMAP[2][i][0])} | {code(KEYMAP[3][i][0])} |")
    return "\n".join(rows)


class KeyboardPads:
    name = "keyboard keys (no driver needed)"
    mode = "keyboard"

    def __init__(self, emu_dir, job=""):
        if sys.platform != "win32":
            raise RuntimeError("Keyboard mode is Windows-only.")
        if not job and (not emu_dir or not os.path.isdir(emu_dir)):
            raise RuntimeError("No app container or emulators folder was given, so there's no window keys may be sent to.")
        self.job = job
        import ctypes
        from ctypes import wintypes
        self.ct, self.wt = ctypes, wintypes
        self.emu_dir = os.path.normcase(os.path.abspath(emu_dir)).rstrip("\\/") + os.sep if emu_dir else None
        u32, k32 = ctypes.WinDLL("user32", use_last_error=True), ctypes.WinDLL("kernel32", use_last_error=True)

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                        ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class MOUSEINPUT(ctypes.Structure):  # only here so the union (and INPUT) has the size Windows expects
            _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                        ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class _U(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("u", _U)]

        self.KEYBDINPUT, self.INPUT = KEYBDINPUT, INPUT
        u32.SendInput.argtypes = [wintypes.UINT, ctypes.c_void_p, ctypes.c_int]
        u32.SendInput.restype = wintypes.UINT
        u32.GetForegroundWindow.restype = wintypes.HWND
        u32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        k32.OpenJobObjectW.restype = wintypes.HANDLE
        k32.OpenJobObjectW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
        k32.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
        self.u32, self.k32 = u32, k32
        self.want = {}            # slot -> values
        self.held = set()         # (scan, ext) currently pressed by us
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.stop = False
        self.thread = None
        self.focus_pid = None     # cache: pid -> is it the hosted app?
        self.focus_ok = False
        self.focus_at = 0.0

    # Foreground window belongs to the hosted app: a process inside Retro Hub's app container (apps.py run),
    # or, when no container name was given, an executable under the emulators folder.
    def emulator_focused(self):
        hwnd = self.u32.GetForegroundWindow()
        if not hwnd:
            return False
        pid = self.wt.DWORD()
        self.u32.GetWindowThreadProcessId(hwnd, self.ct.byref(pid))
        now = time.monotonic()
        if pid.value == self.focus_pid and now - self.focus_at < 2:
            return self.focus_ok
        ok = False
        h = self.k32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
        if h:
            try:
                if self.job:
                    job = self.k32.OpenJobObjectW(0x0004, False, self.job)  # JOB_OBJECT_QUERY; none = no app running
                    if job:
                        try:
                            inside = self.wt.BOOL()
                            ok = bool(self.k32.IsProcessInJob(h, job, self.ct.byref(inside)) and inside.value)
                        finally:
                            self.k32.CloseHandle(job)
                else:
                    buf = self.ct.create_unicode_buffer(1024)
                    size = self.wt.DWORD(len(buf))
                    if self.k32.QueryFullProcessImageNameW(h, 0, buf, self.ct.byref(size)):
                        ok = os.path.normcase(buf.value).startswith(self.emu_dir)
            finally:
                self.k32.CloseHandle(h)
        self.focus_pid, self.focus_ok, self.focus_at = pid.value, ok, now
        return ok

    def send(self, keys, up):
        if not keys:
            return
        arr = (self.INPUT * len(keys))()
        for n, (scan, ext) in enumerate(keys):
            arr[n].type = 1  # INPUT_KEYBOARD
            arr[n].u.ki = self.KEYBDINPUT(0, scan, 0x8 | (0x1 if ext else 0) | (0x2 if up else 0), 0, 0)
        self.u32.SendInput(len(keys), arr, self.ct.sizeof(self.INPUT))

    def wanted_keys(self):
        keys = set()
        with self.lock:
            items = list(self.want.items())
        for slot, v in items:
            km = KEYMAP.get(slot)
            if not km:
                continue
            for i in range(24):
                on = v[i] > HALF if 16 <= i <= 23 else v[i] > 0
                if on:
                    keys.add(km[i][1:])
        return keys

    def loop(self):
        while not self.stop:
            self.wake.wait(0.05)  # new input wakes it at once; otherwise re-check focus 20x a second
            self.wake.clear()
            want = self.wanted_keys() if self.emulator_focused() else set()
            self.send(sorted(self.held - want), up=True)
            self.send(sorted(want - self.held), up=False)
            self.held = want
        self.send(sorted(self.held), up=True)
        self.held = set()

    def start(self):
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def create(self, slot):
        if slot not in KEYMAP:
            raise RuntimeError(f"keyboard mode has keys for P2-P4 only (got P{slot + 1})")
        return slot

    def apply(self, slot, v):
        with self.lock:
            self.want[slot] = v
        self.wake.set()

    def destroy(self, slot):
        with self.lock:
            self.want.pop(slot, None)
        self.wake.set()

    def close(self):
        self.stop = True
        self.wake.set()
        if self.thread:
            self.thread.join(1)


# ------------------------------------------------------------------ backend choice
def backend(mode, emu_dir, job=""):
    errors = []
    if mode in ("auto", "gamepad"):
        try:
            if sys.platform == "win32":
                return WindowsPads(), errors
            if sys.platform.startswith("linux"):
                return LinuxPads(), errors
            raise RuntimeError("virtual gamepads are supported on Windows and Linux only")
        except Exception as err:  # noqa: BLE001
            errors.append(gamepad_hint(err))
            if mode == "gamepad":
                raise RuntimeError(errors[0]) from err
    try:
        return KeyboardPads(emu_dir, job), errors
    except Exception as err:  # noqa: BLE001
        raise RuntimeError("; ".join(errors + [f"keyboard mode unavailable: {err}"])) from err


def gamepad_hint(err):
    if sys.platform == "win32":
        return f"virtual gamepads need vgamepad + the ViGEmBus driver (pip install vgamepad): {err}"
    return f"virtual gamepads need python-evdev and write access to /dev/uinput (pip install evdev): {err}"


def check(mode, emu_dir, job=""):
    try:
        b, errors = backend(mode, emu_dir, job)
        print(json.dumps({"ok": True, "backend": b.name, "mode": b.mode, "note": "; ".join(errors)}))
    except Exception as err:  # noqa: BLE001 - reported to the hub as text
        print(json.dumps({"ok": False, "error": str(err)}))


def run(slots, mode, emu_dir, stdin=None, job=""):
    b, _ = backend(mode, emu_dir, job)
    pads = {s: b.create(s) for s in slots}  # created in seat order so the emulator's controller order matches
    last = {s: None for s in slots}
    stdin = stdin or sys.stdin.buffer
    if hasattr(b, "start"):
        b.start()
    # Tell the hub the pads exist, so it can boot the emulator only after they are plugged in: emulators that
    # don't hot-plug (xemu, melonDS, Dolphin's bindings) only see controllers that were there when they started.
    if b.mode == "gamepad":
        time.sleep(0.4)  # let the OS finish enumerating the new devices
    print(json.dumps({"t": "pads", "slots": slots, "mode": b.mode}), flush=True)
    try:
        while True:
            frame = stdin.read(FRAME)
            if not frame or len(frame) < FRAME:
                break  # the hub closed the pipe
            slot, ver, *values = UNPACK(frame)
            if ver != 1 or slot not in pads:
                continue
            values = [min(MAX, x) for x in values]
            if values == last[slot]:
                continue
            last[slot] = values
            b.apply(pads[slot], values)
    finally:
        for p in pads.values():
            b.destroy(p)
        if hasattr(b, "close"):
            b.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--keymap", action="store_true")
    ap.add_argument("--slots", default="1,2,3")
    ap.add_argument("--mode", choices=["auto", "gamepad", "keyboard"], default="auto")
    ap.add_argument("--emu-dir", default="")
    ap.add_argument("--job", default="", help="name of the app container (apps.py run --job); keys only go there")
    a = ap.parse_args()
    if a.keymap:
        return print(keymap_markdown())
    if a.check:
        return check(a.mode, a.emu_dir, a.job)
    slots = []
    for s in a.slots.split(","):
        if s.strip().isdigit() and 0 <= int(s) < 4 and int(s) not in slots:
            slots.append(int(s))
    if not slots:
        sys.exit("no seats given")
    try:
        run(slots, a.mode, a.emu_dir, job=a.job)
    except Exception as err:  # noqa: BLE001
        sys.exit(str(err))


if __name__ == "__main__":
    main()
