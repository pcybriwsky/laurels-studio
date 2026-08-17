#!/usr/bin/env python3
"""Convert a Glyph Lab stitch-plan JSON into a Brother .pes embroidery file.

Usage:
    pip install pyembroidery
    python3 scripts/stitchplan_to_pes.py glyph-858-0620.stitch.json [out.pes] [--flip-y]

The plan's coordinates are millimeters, y-down (screen orientation), already
resampled to final stitch lengths by the app (route/rule as bean stitch, text
as fine running stitch). This script only places stitches and block breaks:
each block is one continuous needle path, with a TRIM + JUMP between blocks
(route, rule, distance, time, date -> 4 trims to cut after stitching).

If your machine previews the design vertically mirrored, re-run with --flip-y.
"""
import json
import sys

from pyembroidery import EmbPattern, EmbThread, write_pes, STITCH, JUMP, COLOR_CHANGE

SCALE = 10.0  # mm -> PES units (0.1mm)
THREAD_HEX = "#e8d4a0"  # cream — matched to nearest Brother PEC palette entry


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flip = "--flip-y" in sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    src = args[0]
    out = args[1] if len(args) > 1 else src.replace(".stitch.json", "") + ".pes"

    with open(src) as f:
        plan = json.load(f)

    sign = -1.0 if flip else 1.0
    pattern = EmbPattern()
    thread = EmbThread()
    thread.set_hex_color(THREAD_HEX)
    pattern.add_thread(thread)
    pattern.extras["name"] = plan.get("name", "glyph")
    total = 0
    prev_end = None
    for i, block in enumerate(plan["blocks"]):
        stitches = block["stitches"]
        if not stitches:
            continue
        if i > 0 and block.get("stop") and prev_end is not None:
            # same-color color change: machine pauses + auto-trims the jump,
            # resumes on Start (SE700 trims at color changes, not jumps)
            extra = EmbThread()
            extra.set_hex_color(THREAD_HEX)
            pattern.add_thread(extra)
            pattern.add_stitch_absolute(
                COLOR_CHANGE, prev_end[0] * SCALE, sign * prev_end[1] * SCALE
            )
        x0, y0 = stitches[0]
        pattern.add_stitch_absolute(JUMP, x0 * SCALE, sign * y0 * SCALE)
        for x, y in stitches:
            pattern.add_stitch_absolute(STITCH, x * SCALE, sign * y * SCALE)
        total += len(stitches)
        prev_end = stitches[-1]
        stop_note = " [trim stop]" if block.get("stop") else ""
        print(f"  block '{block['label']}': {len(stitches)} stitches{stop_note}")

    pattern.end()
    write_pes(pattern, out)
    print(f"wrote {out}: {len(plan['blocks'])} blocks, {total} stitches, patch {plan['patchMm']}mm")


if __name__ == "__main__":
    main()
