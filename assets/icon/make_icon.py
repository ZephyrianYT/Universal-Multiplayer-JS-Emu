#!/usr/bin/env python3
"""Builds the Retro Hub icon (the mascot: a red-and-white chibi duck in a purple bandana) in every format.

  python assets/icon/make_icon.py

Writes, next to this file:
  retrohub.svg        vector source (also the browser tab icon: public/icon.svg)
  retrohub.png        512 x 512 (Linux desktop entries, the Retro Hub window)
  retrohub-<n>.png    16 ... 1024
  retrohub.ico        Windows (16, 24, 32, 48, 64, 128, 256)
  retrohub.icns       macOS

The shapes are defined once below and drawn both as SVG and (4x supersampled) with Pillow, so the formats match.
Only needed to change the icon: the generated files are part of Retro Hub, players never run this (needs Pillow).
"""
from __future__ import annotations

import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

INK = "#2a1633"            # outline
RED, RED_D = "#e8301f", "#c41f14"
WHITE, WHITE_D = "#fff6f0", "#e9d6d2"
PURPLE, PURPLE_D = "#8b3bf0", "#6420c9"
BEAK, BEAK_D = "#ffc21a", "#e08a00"
MOUTH, TONGUE, BLUSH = "#a3183a", "#ff7096", "#ff8aa0"

# Each shape: (kind, data, fill, stroke, stroke width). kind "path": [start, (c1, c2, end), ...] cubic Béziers,
# closed. kind "ellipse": (cx, cy, rx, ry). Coordinates on a 256 x 256 canvas.
SHAPES = [
    # bandana tails (behind the head)
    ("path", [(218, 112), ((240, 118), (252, 140), (246, 160)), ((236, 158), (226, 146), (214, 132))], PURPLE_D, INK, 5),
    # body / head
    ("path", [(40, 150), ((30, 72), (88, 40), (128, 40)), ((168, 40), (226, 72), (216, 150)),
              ((224, 210), (190, 242), (128, 242)), ((66, 242), (32, 210), (40, 150))], RED, INK, 6),
    # white fluffy bib under the beak (red shows on both sides, like the mascot art)
    ("path", [(70, 186), ((84, 200), (106, 206), (128, 206)), ((150, 206), (172, 200), (186, 186)),
              ((196, 224), (168, 241), (128, 241)), ((88, 241), (60, 224), (70, 186))], WHITE, None, 0),
    ("path", [(84, 222), ((96, 216), (104, 226), (112, 220)), ((120, 228), (136, 228), (144, 220)),
              ((152, 226), (160, 216), (172, 222)), ((160, 230), (96, 230), (84, 222))], WHITE_D, None, 0),
    # bandana
    ("path", [(34, 130), ((28, 60), (84, 28), (128, 28)), ((176, 28), (230, 60), (224, 124)),
              ((190, 104), (160, 98), (128, 98)), ((96, 98), (64, 108), (34, 130))], PURPLE, INK, 6),
    ("path", [(40, 112), ((70, 94), (100, 88), (128, 88)), ((160, 88), (196, 94), (220, 108)),
              ((196, 100), (160, 96), (128, 96)), ((98, 96), (68, 102), (40, 112))], PURPLE_D, None, 0),
    ("ellipse", (98, 54, 22, 9), "#c79bff", None, 0),
    ("ellipse", (226, 116, 15, 13), PURPLE, INK, 5),                      # knot
    # eyes
    ("ellipse", (90, 134, 13, 16), INK, None, 0),
    ("ellipse", (166, 134, 13, 16), INK, None, 0),
    ("ellipse", (85, 127, 5, 5), "#ffffff", None, 0),
    ("ellipse", (161, 127, 5, 5), "#ffffff", None, 0),
    # blush
    ("ellipse", (66, 158, 13, 7), BLUSH, None, 0),
    ("ellipse", (190, 158, 13, 7), BLUSH, None, 0),
    # open beak: lower beak, mouth, tongue, then the upper beak over them
    ("path", [(88, 156), ((86, 214), (170, 214), (168, 156))], BEAK, INK, 5),
    ("path", [(100, 160), ((100, 200), (156, 200), (156, 160))], MOUTH, None, 0),
    ("ellipse", (128, 188, 18, 9), TONGUE, None, 0),
    ("path", [(80, 152), ((80, 136), (176, 136), (176, 152)), ((176, 164), (152, 170), (128, 170)),
              ((104, 170), (80, 164), (80, 152))], BEAK, INK, 5),
    ("path", [(96, 158), ((110, 164), (146, 164), (160, 158)), ((150, 166), (106, 166), (96, 158))], BEAK_D, None, 0),
    ("ellipse", (116, 146, 3, 2), BEAK_D, None, 0),
    ("ellipse", (140, 146, 3, 2), BEAK_D, None, 0),
]


def bez(p0, p1, p2, p3, n=40):
    return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0],
             (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1])
            for t in (i / n for i in range(1, n + 1))]


def points(data):
    pts, cur = [data[0]], data[0]
    for c1, c2, end in data[1:]:
        pts += bez(cur, c1, c2, end)
        cur = end
    return pts


def svg() -> str:
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">',
           "<title>Retro Hub</title>"]
    for kind, data, fill, stroke, sw in SHAPES:
        st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ""
        if kind == "ellipse":
            cx, cy, rx, ry = data
            out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}"{st}/>')
        else:
            d = f"M{data[0][0]} {data[0][1]}" + "".join(f" C{a[0]} {a[1]} {b[0]} {b[1]} {c[0]} {c[1]}" for a, b, c in data[1:]) + " Z"
            out.append(f'<path d="{d}" fill="{fill}"{st}/>')
    return "\n".join(out + ["</svg>"]) + "\n"


def raster(size: int = 1024):
    from PIL import Image, ImageDraw
    ss = 4
    big = size * ss
    k = big / 256
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for kind, data, fill, stroke, sw in SHAPES:
        w = round(sw * k) if stroke else 0
        if kind == "ellipse":
            cx, cy, rx, ry = data
            box = [(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k]
            d.ellipse(box, fill=fill, outline=stroke, width=w)
        else:
            pts = [(x * k, y * k) for x, y in points(data)]
            d.polygon(pts, fill=fill)
            if stroke:   # round-jointed outline: a line through every point plus dots at the joints
                d.line(pts + [pts[0]], fill=stroke, width=w, joint="curve")
                r = w / 2
                for x, y in pts[:: max(1, len(pts) // 60)]:
                    d.ellipse([x - r, y - r, x + r, y + r], fill=stroke)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    from PIL import Image
    (HERE / "retrohub.svg").write_text(svg(), encoding="utf-8")
    master = raster(1024)
    for n in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        master.resize((n, n), Image.LANCZOS).save(HERE / f"retrohub-{n}.png", optimize=True)
    shutil.copyfile(HERE / "retrohub-512.png", HERE / "retrohub.png")
    master.save(HERE / "retrohub.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
    master.save(HERE / "retrohub.icns")
    shutil.copyfile(HERE / "retrohub.svg", ROOT / "public" / "icon.svg")
    print("Wrote", ", ".join(sorted(p.name for p in HERE.iterdir() if p.name.startswith("retrohub"))), "and public/icon.svg")


if __name__ == "__main__":
    main()
