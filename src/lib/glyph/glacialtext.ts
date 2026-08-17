// Runtime for the vendored Glacial Tiny 60 satin font (see glacialsatin.ts) —
// the small-lettering experiment from the lettering brief, now rendered with
// everything the first attempt lacked: rung-synchronized rail pairing,
// center-walk underlay, and pull compensation (shared satintext.ts machinery).
// Digitized for 2.8–8.4mm caps; 60wt thread + 65/9 needle are the font's own
// spec at these sizes.
import type { GlyphText } from "./compose";
import type { PlacedEl } from "./satintext";
import { GLACIAL, BASELINE_U, CAP_U, ADV_SPACE_U } from "./glacialsatin";

const TRACKING = 1.08;
// extra clearance each side of '.'/':' — satin dots read tight against glyphs
const DOT_PAD_U = 2.5;
const isDot = (ch: string) => ch === "." || ch === ":";

export function glacialCovers(text: string): boolean {
  for (const ch of text) {
    if (ch === " ") continue;
    if (!GLACIAL[ch]) return false;
  }
  return true;
}

// Same contract as layoutExcaliburText: glyph-units in, placed elements out.
// Cap height = 0.7 * t.size, matching every other font path in the pipeline.
export function layoutGlacialText(t: GlyphText): PlacedEl[][] {
  const s = (0.7 * t.size) / CAP_U;
  const adv = (ch: string) =>
    ((ch === " " ? ADV_SPACE_U : (GLACIAL[ch]?.adv ?? ADV_SPACE_U)) * TRACKING +
      (isDot(ch) ? 2 * DOT_PAD_U : 0)) *
    s;
  const chars = [...t.text];
  const width = chars.reduce((w, ch) => w + adv(ch), 0);
  let x = t.anchor === "end" ? t.x - width : t.anchor === "middle" ? t.x - width / 2 : t.x;

  const out: PlacedEl[][] = [];
  const tx = (p: [number, number], ox: number) => ({
    x: ox + p[0] * s,
    y: t.y - (BASELINE_U - p[1]) * s,
  });
  for (const ch of chars) {
    if (ch === " ") {
      x += adv(ch);
      continue;
    }
    const glyph = GLACIAL[ch];
    if (!glyph) continue;
    const ox = x;
    out.push(
      glyph.elements.map((el): PlacedEl => {
        if (el.kind === "satin") {
          return {
            kind: "satin",
            a: el.a.map((p) => tx(p, ox)),
            b: el.b.map((p) => tx(p, ox)),
            rungs: el.rungs, // arc-length fractions — invariant under transform
          };
        }
        return { kind: "run", pts: el.pts.map((p) => tx(p, ox)) };
      })
    );
    x += adv(ch);
  }
  return out;
}
