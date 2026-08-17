// Runtime for the vendored "Glacial Tiny 60 AGS" embroidery font (see
// glacial.ts / FONT-LICENSE): professionally digitized satin-column glyphs
// designed for 2.8–8.4mm lettering. Each glyph is satin rail pairs + running
// connectors in font units (y-down, baseline at BASELINE_U); this module lays
// text out in glyph-viewBox units for both the SVG design view and the stitch
// plan, so screen and fabric stay identical.
import type { GlyphText } from "./compose";
import { GLYPHS, BASELINE_U, CAP_U, ADV_SPACE_U, SatinElement, Rail } from "./glacial";

export type { SatinElement, Rail };

const ALIAS: Record<string, string> = { "·": "." };

export function glacialCovers(text: string): boolean {
  for (const raw of text) {
    const ch = ALIAS[raw] ?? raw;
    if (ch === " ") continue;
    if (!GLYPHS[ch]) return false;
  }
  return true;
}

// Transform all glyph elements of a laid-out text into glyph-viewBox units.
// Cap height maps to 0.7em (same visual metric as the stroke font).
// extra letter-spacing on top of the font's native advances — satin columns
// read heavier than ink, so tracked-out text stays legible
const TRACKING = 1.28;

// punctuation gets extra clearance on both sides — a satin/bold dot bulges
// wider than its typographic advance
const DOT_PAD_U = 2.5;
const isDot = (ch: string) => ch === "." || ch === ":";

export function layoutGlacialText(t: GlyphText): SatinElement[] {
  const capUnits = 0.7 * t.size; // cap height in viewBox units
  const s = capUnits / CAP_U;
  const adv = (ch: string) =>
    (ch === " " ? ADV_SPACE_U : (GLYPHS[ch]?.adv ?? ADV_SPACE_U)) * s * TRACKING +
    (isDot(ch) ? 2 * DOT_PAD_U * s : 0);
  const chars = [...t.text].map((raw) => ALIAS[raw] ?? raw);
  const width = chars.reduce((w, ch) => w + adv(ch), 0);
  let x = t.anchor === "end" ? t.x - width : t.anchor === "middle" ? t.x - width / 2 : t.x;

  const out: SatinElement[] = [];
  const tx = (p: [number, number], ox: number): [number, number] => [
    ox + p[0] * s,
    t.y - (BASELINE_U - p[1]) * s,
  ];
  for (const ch of chars) {
    if (ch === " ") {
      x += adv(ch);
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const ox = x + (isDot(ch) ? DOT_PAD_U * s : 0);
    for (const el of glyph.elements) {
      if (el.kind === "satin") {
        out.push({
          kind: "satin",
          a: el.a.map((p) => tx(p, ox)),
          b: el.b.map((p) => tx(p, ox)),
        });
      } else {
        out.push({ kind: "run", pts: el.pts.map((p) => tx(p, ox)) });
      }
    }
    x += adv(ch);
  }
  return out;
}

// The font's letterforms as thin CENTERLINE strokes (midline of each satin
// rail pair) — professionally drawn shapes sewn as crisp running/bold lines,
// the right treatment when satin columns would read too heavy at small sizes.
export function glacialTextCenterlines(t: GlyphText): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  for (const el of layoutGlacialText(t)) {
    if (el.kind === "satin") {
      const a = el.a.map(([x, y]) => ({ x, y }));
      const b = el.b.map(([x, y]) => ({ x, y }));
      const la = polyLen(a);
      const lb = polyLen(b);
      const n = Math.max(4, Math.round((Math.max(la, lb) / 0.6) * 2));
      let line: { x: number; y: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const pa = pointAt(a, la, i / n);
        const pb = pointAt(b, lb, i / n);
        line.push({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
      }
      // two corner-cutting passes iron out midline wobble from rail pairing
      line = chaikin(chaikin(line));
      out.push(line);
    } else {
      out.push(el.pts.map(([x, y]) => ({ x, y })));
    }
  }
  return out;
}

// Classic satin from a rail pair: needle penetrations alternate rails while
// advancing by arc-length fraction — `spacingMm` is the penetration spacing
// along a single rail (the font was digitized at 0.25mm for 60wt thread).
export function satinRails(
  a: { x: number; y: number }[],
  b: { x: number; y: number }[],
  spacingMm: number
): { x: number; y: number }[] {
  const la = polyLen(a);
  const lb = polyLen(b);
  const steps = Math.max(2, Math.ceil(Math.max(la, lb) / spacingMm) * 2);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push(i % 2 === 0 ? pointAt(a, la, t) : pointAt(b, lb, t));
  }
  return out;
}

function chaikin(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
    out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function polyLen(pts: { x: number; y: number }[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return l;
}

function pointAt(
  pts: { x: number; y: number }[],
  total: number,
  t: number
): { x: number; y: number } {
  if (pts.length === 1 || total === 0) return pts[0];
  let target = t * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (target <= seg || i === pts.length - 1) {
      const f = seg === 0 ? 0 : Math.max(0, Math.min(1, target / seg));
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      };
    }
    target -= seg;
  }
  return pts[pts.length - 1];
}
