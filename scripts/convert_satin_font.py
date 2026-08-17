#!/usr/bin/env python3
"""Convert an Ink/Stitch satin font (rails + RUNGS) into a vendored TS module.

Rungs are the digitizer's synchronization crossbars: they pin which point of
rail A pairs with which point of rail B. Ignoring them skews the satin on
diagonal/curved columns — so this converter extracts them as arc-length
fraction pairs [tA, tB] per rung.

Usage: python3 convert_satin_font.py <prefix> <NeedChars> <OutPath> <ExportName>
Files expected: <prefix>_font.json, <prefix>_ltr.svg
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

prefix, NEED, OUT, EXPORT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

SVG = "{http://www.w3.org/2000/svg}"
INK = "{http://www.inkscape.org/namespaces/inkscape}"

meta = json.load(open(f"{prefix}_font.json"))
ADV = meta.get("horiz_adv_x", {})
ADV_SPACE = meta.get("horiz_adv_x_space", 10)

TOKEN = re.compile(r"[MmLlCcHhVvZzQqSsTtAa]|-?\d*\.?\d+(?:e-?\d+)?")


def parse_path(d):
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

    def flat_c(x0, y0, x1, y1, x2, y2, x3, y3, n=14):
        pts = []
        for k in range(1, n + 1):
            t = k / n
            mt = 1 - t
            pts.append((
                mt**3 * x0 + 3 * mt**2 * t * x1 + 3 * mt * t**2 * x2 + t**3 * x3,
                mt**3 * y0 + 3 * mt**2 * t * y1 + 3 * mt * t**2 * y2 + t**3 * y3,
            ))
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
            x, y = (x + dx, y + dy) if cmd == "m" else (dx, dy)
            if cur:
                subpaths.append(cur)
            cur = [(x, y)]
            sx, sy = x, y
            cmd = "l" if cmd == "m" else "L"
        elif cmd in ("L", "l"):
            dx, dy = num(), num()
            x, y = (x + dx, y + dy) if cmd == "l" else (dx, dy)
            cur.append((x, y))
        elif cmd in ("H", "h"):
            v = num()
            x = x + v if cmd == "h" else v
            cur.append((x, y))
        elif cmd in ("V", "v"):
            v = num()
            y = y + v if cmd == "v" else v
            cur.append((x, y))
        elif cmd in ("C", "c"):
            x1, y1, x2, y2, x3, y3 = (num() for _ in range(6))
            if cmd == "c":
                x1, y1, x2, y2, x3, y3 = x + x1, y + y1, x + x2, y + y2, x + x3, y + y3
            cur.extend(flat_c(x, y, x1, y1, x2, y2, x3, y3))
            x, y = x3, y3
        else:
            raise ValueError(f"unsupported cmd {cmd}")
    if cur:
        subpaths.append(cur)
    return subpaths


def simplify(pts, tol=0.12):
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


def arc_params(rail):
    lens = [0.0]
    for i in range(1, len(rail)):
        lens.append(lens[-1] + dist2(rail[i - 1], rail[i]) ** 0.5)
    return lens


def seg_intersect(p, p2, q, q2):
    """Return u (param along p->p2) if segments intersect, else None."""
    rx, ry = p2[0] - p[0], p2[1] - p[1]
    sx, sy = q2[0] - q[0], q2[1] - q[1]
    denom = rx * sy - ry * sx
    if abs(denom) < 1e-12:
        return None
    qpx, qpy = q[0] - p[0], q[1] - p[1]
    u = (qpx * sy - qpy * sx) / denom
    v = (qpx * ry - qpy * rx) / denom
    if -0.001 <= u <= 1.001 and -0.35 <= v <= 1.35:  # rung extended for robustness
        return min(1.0, max(0.0, u))
    return None


def rung_param(rail, lens, rung):
    """Arc-length fraction where the rung crosses the rail."""
    total = lens[-1] or 1.0
    a, b = rung[0], rung[-1]
    # extend rung 35% both directions handled in seg_intersect's v range
    for i in range(1, len(rail)):
        u = seg_intersect(rail[i - 1], rail[i], a, b)
        if u is not None:
            return (lens[i - 1] + u * (lens[i] - lens[i - 1])) / total
    # fallback: nearest rail vertex to rung midpoint
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    best_i = min(range(len(rail)), key=lambda i: dist2(rail[i], mid))
    return lens[best_i] / total


tree = ET.parse(f"{prefix}_ltr.svg")
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
        subs = parse_path(d)
        if attrs.get("satin_column") == "True" and len(subs) >= 2:
            ra, rb = simplify(subs[0]), simplify(subs[1])
            if dist2(ra[0], rb[0]) + dist2(ra[-1], rb[-1]) > dist2(ra[0], rb[-1]) + dist2(ra[-1], rb[0]):
                rb = rb[::-1]
            la, lb = arc_params(ra), arc_params(rb)
            rungs = []
            for rung in subs[2:]:
                ta = rung_param(ra, la, rung)
                tb = rung_param(rb, lb, rung)
                rungs.append((ta, tb))
            rungs.sort()
            # drop non-monotone tB (bad intersections would fold the pairing)
            mono = []
            for ta, tb in rungs:
                if not mono or tb >= mono[-1][1] - 1e-6:
                    mono.append((ta, tb))
            elements.append({"kind": "satin", "a": ra, "b": rb, "rungs": mono})
        else:
            for sp in subs:
                elements.append({"kind": "run", "pts": simplify(sp)})
    if elements:
        glyphs[ch] = {"adv": ADV.get(ch), "elements": elements}


def bbox_w(gl):
    xs = [p[0] for e in gl["elements"] for r in (e.get("a"), e.get("b"), e.get("pts")) if r for p in r]
    return max(xs) - min(xs)


bearings = sorted(gl["adv"] - bbox_w(gl) for gl in glyphs.values() if gl["adv"] is not None and bbox_w(gl) > 2)
med = bearings[len(bearings) // 2] if bearings else 3
for ch, gl in glyphs.items():
    if gl["adv"] is None:
        gl["adv"] = round(bbox_w(gl) + med, 1)

missing = [c for c in NEED if c not in glyphs]
print("extracted:", sorted(glyphs.keys()), "missing:", missing)
rung_counts = [len(e["rungs"]) for gl in glyphs.values() for e in gl["elements"] if e["kind"] == "satin"]
print(f"satin elements: {len(rung_counts)}, rungs/element avg {sum(rung_counts)/max(1,len(rung_counts)):.1f}")

ref = glyphs["0"]
pts0 = [p for e in ref["elements"] for r in (e.get("a"), e.get("b"), e.get("pts")) if r for p in r]
base = max(p[1] for p in pts0)
top = min(p[1] for p in pts0)
print(f"baseline={base:.2f} capUnits={base - top:.2f}")


def fmt_pts(pts):
    return "[" + ",".join(f"[{p[0]:.2f},{p[1]:.2f}]" for p in pts) + "]"


lines = []
lines.append(f"// Vendored from Ink/Stitch's '{meta.get('name')}' embroidery font.")
lines.append(f"// {meta.get('font_license', 'see LICENSE in source repo')} — adaptation by the Ink/Stitch project.")
lines.append("// Satin rails + RUNGS (pairing synchronization) + running connectors.")
lines.append("// Generated by scripts/convert_satin_font.py — do not edit by hand.")
lines.append("export type Rail = [number, number][];")
lines.append("export type SatinEl = { kind: \"satin\"; a: Rail; b: Rail; rungs: [number, number][] };")
lines.append("export type RunEl = { kind: \"run\"; pts: Rail };")
lines.append("export interface FontGlyph { adv: number; elements: (SatinEl | RunEl)[]; }")
lines.append("")
lines.append(f"export const BASELINE_U = {base:.2f};")
lines.append(f"export const CAP_U = {base - top:.2f};")
lines.append(f"export const ADV_SPACE_U = {ADV_SPACE};")
lines.append("")
lines.append(f"export const {EXPORT}: Record<string, FontGlyph> = {{")
for ch, gl in sorted(glyphs.items()):
    els = []
    for e in gl["elements"]:
        if e["kind"] == "satin":
            rungs = "[" + ",".join(f"[{ta:.4f},{tb:.4f}]" for ta, tb in e["rungs"]) + "]"
            els.append(f'{{kind:"satin",a:{fmt_pts(e["a"])},b:{fmt_pts(e["b"])},rungs:{rungs}}}')
        else:
            els.append(f'{{kind:"run",pts:{fmt_pts(e["pts"])}}}')
    lines.append(f"  {json.dumps(ch)}: {{adv: {gl['adv']}, elements: [{','.join(els)}]}},")
lines.append("};")

open(OUT, "w").write("\n".join(lines) + "\n")
import os
print("wrote", OUT, os.path.getsize(OUT), "bytes")
