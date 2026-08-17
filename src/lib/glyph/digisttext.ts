// Runtime for the purchased DIGIST Small Block PES letters (see digist.ts):
// FIXED-SIZE professionally digitized stitch sequences, placed — never scaled
// — at true millimeters. Stitches sew verbatim as the digitizer intended;
// layout just translates letters along the baseline.
import { DIGIST, DIGIST_CAP_MM } from "./digist";

export { DIGIST_CAP_MM };

const GAP_MM = 1.0; // air between letters
const SPACE_MM = 2.6; // advance of ' '
const DOT_PAD_MM = 0.8; // extra clearance each side of '.' and '-'

const isPad = (ch: string) => ch === "." || ch === "-";

export function digistCovers(text: string): boolean {
  for (const ch of text) {
    if (ch === " ") continue;
    if (!DIGIST[ch]) return false;
  }
  return true;
}

export interface PlacedDigist {
  blocks: { x: number; y: number }[][];
}

export function layoutDigistMm(
  text: string,
  centerXMm: number,
  baselineYMm: number
): PlacedDigist[] {
  const chars = [...text];
  const advOf = (ch: string) =>
    ch === " " ? SPACE_MM : (DIGIST[ch]?.w ?? SPACE_MM) + (isPad(ch) ? 2 * DOT_PAD_MM : 0);
  const total =
    chars.reduce((w, ch) => w + advOf(ch), 0) + GAP_MM * Math.max(0, chars.length - 1);
  let x = centerXMm - total / 2;

  const out: PlacedDigist[] = [];
  for (const ch of chars) {
    if (ch === " ") {
      x += SPACE_MM + GAP_MM;
      continue;
    }
    const glyph = DIGIST[ch];
    if (!glyph) continue;
    const ox = x + (isPad(ch) ? DOT_PAD_MM : 0);
    out.push({
      blocks: glyph.blocks.map((b) =>
        b.map(([gx, gy]) => ({ x: ox + gx, y: baselineYMm + gy }))
      ),
    });
    x += advOf(ch) + GAP_MM;
  }
  return out;
}
