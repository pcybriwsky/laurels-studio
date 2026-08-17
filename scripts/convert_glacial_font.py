#!/usr/bin/env python3
"""Convert Glacial Tiny (Ink/Stitch embroidery font, OFL) glyphs into a
vendored TypeScript module for the apparel-brand glyph pipeline.

Extracts satin rail pairs + running connectors for the chars the badge needs,
flattens beziers, normalizes rail direction, preserves stitch order.
"""
import json
import re
import xml.etree.ElementTree as ET

NEED = "0123456789.:MI"
SVG = "{http://www.w3.org/2000/svg}"
INK = "{http://www.inkscape.org/namespaces/inkscape}"
STITCH_NS = "{http://inkstitch.org/namespace}"

meta = json.load(open("glacial_font.json"))
ADV = meta.get("horiz_adv_x", {})
ADV_DEFAULT = meta.get("horiz_adv_x_default", 20)
ADV_SPACE = meta.get("horiz_adv_x_space", 10)

TOKEN = re.compile(r"[MmLlCcHhVvZzQqSsTtAa]|-?\d*\.?\d+(?:e-?\d+)?")


def parse_path(d):
    """Minimal SVG path parser -> list of subpaths (each a list of (x,y)).
    Supports M/m L/l C/c H/h V/v Z/z with implicit repeats."""
    tokens = TOKEN.findall(d)
    i = 0
    subpaths = []
    cur = []
    x = y = sx = sy = 0.0
    cmd = None

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    def flatten_cubic(x0, y0, x1, y1, x2, y2, x3, y3, n=14):
        pts = []
        for k in range(1, n + 1):
            t = k / n
            mt = 1 - t
            px = mt**3 * x0 + 3 * mt**2 * t * x1 + 3 * mt * t**2 * x2 + t**3 * x3
            py = mt**3 * y0 + 3 * mt**2 * t * y1 + 3 * mt * t**2 * y2 + t**3 * y3
            pts.append((px, py))
        return pts

    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                if cur:
                    cur.append((sx, sy))
                    subpaths.append(cur)
                    cur = []
                x, y = sx, sy
                continue
        if cmd in ("M", "m"):
            dx, dy = num(), num()
            if cmd == "m":
                x, y = x + dx, y + dy
            else:
                x, y = dx, dy
            if cur:
                subpaths.append(cur)
            cur = [(x, y)]
            sx, sy = x, y
            cmd = "l" if cmd == "m" else "L"  # implicit lineto after moveto
        elif cmd in ("L", "l"):
            dx, dy = num(), num()
            if cmd == "l":
                x, y = x + dx, y + dy
            else:
                x, y = dx, dy
            cur.append((x, y))
        elif cmd in ("H", "h"):
            dx = num()
            x = x + dx if cmd == "h" else dx
            cur.append((x, y))
        elif cmd in ("V", "v"):
            dy = num()
            y = y + dy if cmd == "v" else dy
            cur.append((x, y))
        elif cmd in ("C", "c"):
            x1, y1, x2, y2, x3, y3 = (num(), num(), num(), num(), num(), num())
            if cmd == "c":
                x1, y1, x2, y2, x3, y3 = x + x1, y + y1, x + x2, y + y2, x + x3, y + y3
            cur.extend(flatten_cubic(x, y, x1, y1, x2, y2, x3, y3))
            x, y = x3, y3
        else:
            raise ValueError(f"unsupported path command {cmd}")
    if cur:
        subpaths.append(cur)
    return subpaths


def simplify(pts, tol=0.12):
    """Light radial-distance simplification."""
    if len(pts) <= 2:
        return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        lx, ly = out[-1]
        if (p[0] - lx) ** 2 + (p[1] - ly) ** 2 >= tol * tol:
            out.append(p)
    out.append(pts[-1])
    return out


def dist2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


tree = ET.parse("glacial_ltr.svg")
root = tree.getroot()

glyphs = {}
for g in root.iter(SVG + "g"):
    label = g.get(INK + "label") or ""
    if not label.startswith("GlyphLayer-"):
        continue
    ch = label[len("GlyphLayer-"):]
    if ch not in NEED:
        continue
    elements = []
    for el in g.iter(SVG + "path"):
        d = el.get("d")
        if not d:
            continue
        attrs = {k.split("}")[-1]: v for k, v in el.attrib.items()}
        subs = [simplify(sp) for sp in parse_path(d)]
        if attrs.get("satin_column") == "True" and len(subs) >= 2:
            ra, rb = subs[0], subs[1]  # rails; remaining subpaths are rungs
            # normalize rail direction: both rails run the same way
            if dist2(ra[0], rb[0]) + dist2(ra[-1], rb[-1]) > dist2(ra[0], rb[-1]) + dist2(ra[-1], rb[0]):
                rb = rb[::-1]
            elements.append({"kind": "satin", "a": ra, "b": rb})
        else:
            # running-stitch connector / detail
            for sp in subs:
                elements.append({"kind": "run", "pts": sp})
    if elements:
        glyphs[ch] = {"adv": ADV.get(ch), "elements": elements}

# derive missing advances: glyph bbox width + median side bearing of known glyphs
def bbox_w(gl):
    xs = [p[0] for e in gl["elements"] for r in (e.get("a"), e.get("b"), e.get("pts")) if r for p in r]
    return max(xs) - min(xs)

bearings = [gl["adv"] - bbox_w(gl) for gl in glyphs.values() if gl["adv"] is not None and bbox_w(gl) > 2]
bearings.sort()
med_bearing = bearings[len(bearings) // 2] if bearings else 3
for ch, gl in glyphs.items():
    if gl["adv"] is None:
        gl["adv"] = round(bbox_w(gl) + med_bearing, 1)
        print(f"derived adv for {ch!r}: {gl['adv']} (bbox {bbox_w(gl):.1f} + bearing {med_bearing:.1f})")

missing = [c for c in NEED if c not in glyphs]
print("extracted:", sorted(glyphs.keys()), "missing:", missing)

# metrics: baseline & cap height measured from digit '0'
all0 = [p for e in glyphs["0"]["elements"] for r in (e.get("a"), e.get("b"), e.get("pts")) if r for p in r]
top0 = min(p[1] for p in all0)
# baseline: bottom of '0' (digits sit on the baseline)
base = max(p[1] for p in all0)
print(f"baseline(y)={base:.2f} capTop(y)={top0:.2f} capUnits={base - top0:.2f}")

def fmt_pts(pts):
    return "[" + ",".join(f"[{p[0]:.2f},{p[1]:.2f}]" for p in pts) + "]"

lines = []
lines.append("// Vendored from Ink/Stitch's 'Glacial Tiny 60 AGS' embroidery font")
lines.append("// (c) adaptation by Françoise Lapierre Baillet for Ink/Stitch; derivative of")
lines.append("// 'Glacial Indifference'. SIL Open Font License 1.1 — see FONT-LICENSE.")
lines.append("// Generated by scratchpad/convert_font.py — do not edit by hand.")
lines.append("export type Rail = [number, number][];")
lines.append("export type SatinElement =")
lines.append('  | { kind: "satin"; a: Rail; b: Rail }')
lines.append('  | { kind: "run"; pts: Rail };')
lines.append("export interface SatinGlyph { adv: number; elements: SatinElement[]; }")
lines.append("")
lines.append(f"export const BASELINE_U = {base:.2f};")
lines.append(f"export const CAP_U = {base - top0:.2f};")
lines.append(f"export const ADV_SPACE_U = {ADV_SPACE};")
lines.append(f"export const SIZE_MM_AT_1X = {meta['size']};")
lines.append(f"export const MIN_MM = {meta['size'] * meta['min_scale']};")
lines.append(f"export const MAX_MM = {meta['size'] * meta['max_scale']};")
lines.append("")
lines.append("export const GLYPHS: Record<string, SatinGlyph> = {")
for ch, gl in sorted(glyphs.items()):
    els = []
    for e in gl["elements"]:
        if e["kind"] == "satin":
            els.append(f'{{kind:"satin",a:{fmt_pts(e["a"])},b:{fmt_pts(e["b"])}}}')
        else:
            els.append(f'{{kind:"run",pts:{fmt_pts(e["pts"])}}}')
    key = json.dumps(ch)
    lines.append(f"  {key}: {{adv: {gl['adv']}, elements: [{','.join(els)}]}},")
lines.append("};")

out = "/Users/pete/Documents/GitHub/apparel-brand/src/lib/glyph/glacial.ts"
open(out, "w").write("\n".join(lines) + "\n")
import os
print("wrote", out, os.path.getsize(out), "bytes")
PYEOF_MARKER = None

# Usage (run from a working dir containing the downloaded font files):
#   curl -sLO https://raw.githubusercontent.com/inkstitch/embroidery-fonts/main/src/glacial_tiny/font.json   (save as glacial_font.json)
#   curl -sLO .../glacial_tiny/ltr.svg   (save as glacial_ltr.svg)
#   /usr/bin/python3 scripts/convert_glacial_font.py
# Add chars to NEED and rerun to extend the vendored glyph set.
