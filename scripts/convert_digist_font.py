#!/usr/bin/env python3
"""Vendor DIGIST Small Block PES letters (professionally digitized, fixed-size
stitch files) into a TS module. Stitches are kept VERBATIM — underlay, density
and pull comp are the digitizer's. Coordinates normalized to mm, x from 0,
baseline (bottom of digits) at y=0, y-down.

Usage: convert_digist.py <size-folder> <out.ts>
"""
import json
import os
import sys

from pyembroidery import read, COMMAND_MASK, STITCH, JUMP, TRIM, COLOR_CHANGE, END

FOLDER = sys.argv[1]
OUT = sys.argv[2]
SIZE_TAG = os.path.basename(FOLDER).strip()

NAME_MAP = {}
for d in "0123456789":
    NAME_MAP[d] = f"DIGIST {d} _25 inch.pes"
for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    NAME_MAP[ch] = f"DIGIST CAP {ch} _25 inch.pes"
NAME_MAP["."] = "DIGIST _Period _25 inch.pes"
NAME_MAP["-"] = "DIGIST _Hyphen _25 inch.pes"

NEED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.-"

glyphs = {}
for ch in NEED:
    path = os.path.join(FOLDER, NAME_MAP[ch])
    p = read(path)
    blocks = []
    cur = []
    for s in p.stitches:
        cmd = s[2] & COMMAND_MASK
        if cmd == STITCH:
            cur.append((s[0] / 10.0, s[1] / 10.0))
        elif cmd in (JUMP, TRIM, COLOR_CHANGE):
            if cur:
                blocks.append(cur)
                cur = []
        elif cmd == END:
            break
    if cur:
        blocks.append(cur)
    allpts = [pt for b in blocks for pt in b]
    minx = min(pt[0] for pt in allpts)
    maxy = max(pt[1] for pt in allpts)  # baseline (y-down)
    miny = min(pt[1] for pt in allpts)
    blocks = [[(round(x - minx, 2), round(y - maxy, 2)) for (x, y) in b] for b in blocks]
    w = round(max(pt[0] for pt in allpts) - minx, 2)
    glyphs[ch] = {"w": w, "cap": round(maxy - miny, 2), "blocks": blocks,
                  "stitches": sum(len(b) for b in blocks)}
    print(f"{ch!r}: {glyphs[ch]['stitches']} stitches, w={w}mm cap={glyphs[ch]['cap']}mm, {len(blocks)} block(s)")

cap = glyphs["0"]["cap"]

lines = []
lines.append(f"// Vendored from the purchased 'DIGIST Small Block' embroidery font ({SIZE_TAG}).")
lines.append("// Professionally digitized FIXED-SIZE stitch files — sequences kept verbatim")
lines.append("// (underlay/density/pull-comp are the digitizer's). mm units, y-down,")
lines.append("// baseline at y=0, x from 0. Regenerate: scripts/convert_digist_font.py.")
lines.append("export interface DigistGlyph { w: number; blocks: [number, number][][]; }")
lines.append("")
lines.append(f"export const DIGIST_CAP_MM = {cap};")
lines.append("")
lines.append("export const DIGIST: Record<string, DigistGlyph> = {")
for ch, gl in sorted(glyphs.items()):
    bs = ",".join("[" + ",".join(f"[{x},{y}]" for x, y in b) + "]" for b in gl["blocks"])
    lines.append(f"  {json.dumps(ch)}: {{w: {gl['w']}, blocks: [{bs}]}},")
lines.append("};")

open(OUT, "w").write("\n".join(lines) + "\n")
print("wrote", OUT, os.path.getsize(OUT), "bytes")
