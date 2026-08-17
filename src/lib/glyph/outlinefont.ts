// Runtime for vendored Arimo Bold outlines (see arimo.ts / FONT-LICENSE-ARIMO):
// REAL typography — the font's true contours laid out with its true advance
// widths. Letters stitch as clean closed outline runs; the design view fills
// the same contours (even-odd for counters), so screen and fabric share exact
// letterforms and spacing.
import type { GlyphText } from "./compose";
import { GLYPHS, CAP_U, ADV_SPACE_U } from "./arimo";

// slight tracking so stitched outlines don't visually touch
const TRACKING = 1.06;

export function arimoCovers(text: string): boolean {
  for (const ch of text) {
    if (ch === " ") continue;
    if (!GLYPHS[ch]) return false;
  }
  return true;
}

export interface PlacedGlyph {
  // one entry per contour, in glyph-viewBox units (y-down), closed
  contours: { x: number; y: number }[][];
}

export function layoutArimoText(t: GlyphText): PlacedGlyph[] {
  const s = (0.7 * t.size) / CAP_U; // cap height -> 0.7em, our standard metric
  const adv = (ch: string) =>
    (ch === " " ? ADV_SPACE_U : (GLYPHS[ch]?.adv ?? ADV_SPACE_U)) * s * TRACKING;
  const chars = [...t.text];
  const width = chars.reduce((w, ch) => w + adv(ch), 0);
  let x = t.anchor === "end" ? t.x - width : t.anchor === "middle" ? t.x - width / 2 : t.x;

  const out: PlacedGlyph[] = [];
  for (const ch of chars) {
    if (ch === " ") {
      x += adv(ch);
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const ox = x;
    out.push({
      contours: glyph.contours.map((c) =>
        // font units are y-UP with baseline at 0; our space is y-down
        c.map(([gx, gy]) => ({ x: ox + gx * s, y: t.y - gy * s }))
      ),
    });
    x += adv(ch);
  }
  return out;
}
