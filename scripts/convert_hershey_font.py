#!/usr/bin/env python3
"""Vendor Hershey Simplex (futural.jhf) single-stroke plotter lettering into a
TS module for the bean-stitch Log lettering. The 1967 NBS engineering
standard; polyline strokes, free-use data.

JHF format: one glyph per line. cols 0-4 id, 5-7 pair count, then char-encoded
coordinate pairs (value = ord(c) - ord('R')); first pair = left/right bearing;
" R" = pen up. Glyphs are ASCII-ordered from 32.

Usage: convert_hershey_font.py <futural.jhf> <out.ts>
Normalized: x from left bearing, baseline y=0, y-down (matches DIGIST/glacial
vendor conventions). Cap height measured from '0'.
"""
import json
import sys

NEED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.:-"

src, out = sys.argv[1], sys.argv[2]
lines = [l.rstrip("\n") for l in open(src) if l.strip()]

glyphs = {}
for i, line in enumerate(lines):
    ch = chr(32 + i)
    if ch not in NEED:
        continue
    npairs = int(line[5:8])
    coords = line[8:]
    # npairs INCLUDES the bearing pair — 2*npairs chars total
    pairs = [(ord(coords[k]) - ord("R"), ord(coords[k + 1]) - ord("R"))
             for k in range(0, 2 * npairs, 2)]
    (left, right), verts = pairs[0], pairs[1:]
    strokes, cur = [], []
    for p in verts:
        # pen-up marker: encoded (-50, 0) pair from " R"
        if p[0] == ord(" ") - ord("R"):
            if cur:
                strokes.append(cur)
                cur = []
        else:
            cur.append((p[0] - left, p[1]))
    if cur:
        strokes.append(cur)
    glyphs[ch] = {"adv": right - left, "strokes": strokes}

# baseline & cap from '0' (digits sit on the baseline)
z = [p for s in glyphs["0"]["strokes"] for p in s]
base = max(p[1] for p in z)
cap = base - min(p[1] for p in z)
# shift all glyphs so baseline y=0 (y-down: above-baseline is negative)
for gl in glyphs.values():
    gl["strokes"] = [[(x, y - base) for (x, y) in s] for s in gl["strokes"]]

body = []
body.append("// Vendored from Hershey Simplex (futural) — the 1967 NBS single-stroke")
body.append("// plotter lettering. Free-use data. Polyline strokes, x from left bearing,")
body.append("// baseline y=0, y-down. Regenerate: scripts/convert_hershey_font.py.")
body.append("export interface HersheyGlyph { adv: number; strokes: [number, number][][]; }")
body.append("")
body.append(f"export const HERSHEY_CAP_U = {cap};")
body.append("")
body.append("export const HERSHEY: Record<string, HersheyGlyph> = {")
for ch in sorted(glyphs):
    gl = glyphs[ch]
    ss = ",".join("[" + ",".join(f"[{x},{y}]" for x, y in s) + "]" for s in gl["strokes"])
    body.append(f"  {json.dumps(ch)}: {{adv: {gl['adv']}, strokes: [{ss}]}},")
body.append("};")

open(out, "w").write("\n".join(body) + "\n")
n = sum(len(s) for g in glyphs.values() for s in g["strokes"])
print(f"vendored {len(glyphs)} glyphs, {n} vertices, cap={cap} units -> {out}")
