// Runtime for the vendored Excalibur satin font (KOR lineage — classic machine
// embroidery lettering; see excalibur.ts / FONT-LICENSE-EXCALIBUR).
//
// The pairing walks the two rails SEGMENT BY SEGMENT between the digitizer's
// rungs — the synchronization crossbars that pin which part of rail A sews
// against which part of rail B. This is what keeps satin columns straight on
// diagonals and curves (ignoring rungs skews the column into stripes).
import type { GlyphText } from "./compose";
import { EXCALIBUR, BASELINE_U, CAP_U, ADV_SPACE_U } from "./excalibur";

const TRACKING = 1.1;
// extra clearance each side of '.'/':' — satin dots read tight against digits
const DOT_PAD_U = 5;
const isDot = (ch: string) => ch === "." || ch === ":";

type XY = { x: number; y: number };

export interface PlacedSatin {
  kind: "satin";
  a: XY[];
  b: XY[];
  rungs: [number, number][];
}
export interface PlacedRun {
  kind: "run";
  pts: XY[];
}
export type PlacedEl = PlacedSatin | PlacedRun;

export function excaliburCovers(text: string): boolean {
  for (const ch of text) {
    if (ch === " ") continue;
    if (!EXCALIBUR[ch]) return false;
  }
  return true;
}

export function layoutExcaliburText(t: GlyphText): PlacedEl[][] {
  const s = (0.7 * t.size) / CAP_U;
  const adv = (ch: string) =>
    ((ch === " " ? ADV_SPACE_U : (EXCALIBUR[ch]?.adv ?? ADV_SPACE_U)) * TRACKING +
      (isDot(ch) ? 2 * DOT_PAD_U : 0)) *
    s;
  const chars = [...t.text];
  const width = chars.reduce((w, ch) => w + adv(ch), 0);
  let x = t.anchor === "end" ? t.x - width : t.anchor === "middle" ? t.x - width / 2 : t.x;

  const out: PlacedEl[][] = [];
  const tx = (p: [number, number], ox: number): XY => ({
    x: ox + p[0] * s,
    y: t.y - (BASELINE_U - p[1]) * s,
  });
  for (const ch of chars) {
    if (ch === " ") {
      x += adv(ch);
      continue;
    }
    const glyph = EXCALIBUR[ch];
    if (!glyph) continue;
    let ox = x;
    if (isDot(ch)) {
      // center the dot's ink within its padded advance — equal air both sides
      let minX = Infinity;
      let maxX = -Infinity;
      for (const el of glyph.elements) {
        const rails = el.kind === "satin" ? [el.a, el.b] : [el.pts];
        for (const r of rails) {
          for (const [px] of r) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
          }
        }
      }
      ox = x + (adv(ch) - (maxX - minX) * s) / 2 - minX * s;
    }
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

interface Cum {
  cum: number[];
  total: number;
}

function cumlen(pts: XY[]): Cum {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { cum, total: cum[cum.length - 1] || 1 };
}

function pointAtT(pts: XY[], c: Cum, t: number): XY {
  const target = Math.max(0, Math.min(1, t)) * c.total;
  let lo = 0;
  let hi = c.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const seg = c.cum[i] - c.cum[i - 1] || 1;
  const f = (target - c.cum[i - 1]) / seg;
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
  };
}

// Rung-synchronized satin: needle alternates rails while both advance through
// each rung-bounded segment together. spacingMm = penetration spacing per
// rail. pullCompMm widens the column by pushing each penetration outward
// (away from the opposite rail) — compensates thread pulling the column
// narrower on fabric.
export function satinPairRungs(
  a: XY[],
  b: XY[],
  rungs: [number, number][],
  spacingMm: number,
  pullCompMm = 0
): XY[] {
  if (a.length < 2 || b.length < 2) return a;
  const ca = cumlen(a);
  const cb = cumlen(b);
  const inner = rungs.filter(([ta, tb]) => ta > 0.002 && ta < 0.998 && tb > 0.002 && tb < 0.998);
  const bounds: [number, number][] = [[0, 0], ...inner, [1, 1]];
  const out: XY[] = [];
  let phase = 0;
  for (let sIdx = 0; sIdx < bounds.length - 1; sIdx++) {
    const [a0, b0] = bounds[sIdx];
    const [a1, b1] = bounds[sIdx + 1];
    const lenA = Math.abs(a1 - a0) * ca.total;
    const lenB = Math.abs(b1 - b0) * cb.total;
    // two needle points per crossing pair -> steps doubled for per-rail spacing
    const steps = Math.max(2, Math.ceil(Math.max(lenA, lenB) / spacingMm) * 2);
    for (let i = sIdx === 0 ? 0 : 1; i <= steps; i++) {
      const f = i / steps;
      const tA = a0 + (a1 - a0) * f;
      const tB = b0 + (b1 - b0) * f;
      const pa = pointAtT(a, ca, tA);
      const pb = pointAtT(b, cb, tB);
      const onA = phase % 2 === 0;
      let p = onA ? pa : pb;
      if (pullCompMm > 0) {
        const q = onA ? pb : pa;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const l = Math.hypot(dx, dy);
        if (l > 1e-6) {
          p = { x: p.x + (dx / l) * pullCompMm, y: p.y + (dy / l) * pullCompMm };
        }
      }
      out.push(p);
      phase++;
    }
  }
  return out;
}

// Center-walk underlay: a light running line down the middle of the column
// and back (rung-synchronized midline). Sewn before the satin, it anchors the
// fabric and gives the column loft — the standard fix for mushy small satin.
export function satinUnderlay(
  a: XY[],
  b: XY[],
  rungs: [number, number][],
  stitchMm: number
): XY[] {
  if (a.length < 2 || b.length < 2) return a;
  const ca = cumlen(a);
  const cb = cumlen(b);
  const inner = rungs.filter(([ta, tb]) => ta > 0.002 && ta < 0.998 && tb > 0.002 && tb < 0.998);
  const bounds: [number, number][] = [[0, 0], ...inner, [1, 1]];
  const down: XY[] = [];
  for (let sIdx = 0; sIdx < bounds.length - 1; sIdx++) {
    const [a0, b0] = bounds[sIdx];
    const [a1, b1] = bounds[sIdx + 1];
    const lenA = Math.abs(a1 - a0) * ca.total;
    const lenB = Math.abs(b1 - b0) * cb.total;
    const steps = Math.max(1, Math.ceil(Math.max(lenA, lenB) / stitchMm));
    for (let i = sIdx === 0 ? 0 : 1; i <= steps; i++) {
      const f = i / steps;
      const pa = pointAtT(a, ca, a0 + (a1 - a0) * f);
      const pb = pointAtT(b, cb, b0 + (b1 - b0) * f);
      down.push({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    }
  }
  // down and back — ends where the satin begins
  return [...down, ...down.slice(0, -1).reverse()];
}
