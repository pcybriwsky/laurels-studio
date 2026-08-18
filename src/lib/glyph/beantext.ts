// Bean-stitched single-stroke lettering from Hershey Simplex — the
// engineering-drawing numerals for Log mode. Attempt #1 from the lettering
// brief revisited: real plotter-font geometry, weight via passes.
//
// Rules (per the lettering brief):
//  - every glyph VERTEX gets a needle penetration exactly on it — segments
//    resample between vertices, never across them; corners are the look
//  - segments at sharp corners resample denser (1.2mm) than straights
//  - each segment sews forward-back-forward (passes 1/3/5), net forward
//  - strokes connect with running travel when the gap < 2mm, else the run
//    breaks (separate block → existing trim-stop behavior)
import { XY } from "./flatten";
import { beanify } from "./stitchplan";
import { HERSHEY, HERSHEY_CAP_U } from "./hershey";

const TRACKING = 1.05;
const TRAVEL_MAX_MM = 2;
const CURVE_ANGLE_DEG = 30;
const CURVE_STITCH_MM = 1.2;

export function hersheyCovers(text: string): boolean {
  for (const ch of text) {
    if (ch === " ") continue;
    if (!HERSHEY[ch]) return false;
  }
  return true;
}

export interface HersheyLayout {
  strokes: XY[][]; // mm, in draw order
  width: number; // mm
}

// Layout text in mm: baseline y, cap height capMm, anchor like SVG text.
export function layoutHersheyMm(
  text: string,
  capMm: number,
  x: number,
  y: number,
  anchor: "start" | "middle" | "end" = "start"
): HersheyLayout {
  const s = capMm / HERSHEY_CAP_U;
  const adv = (ch: string) =>
    (ch === " " ? 16 : (HERSHEY[ch]?.adv ?? 16)) * s * TRACKING;
  const chars = [...text];
  const width = chars.reduce((w, ch) => w + adv(ch), 0);
  let cx = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;

  const strokes: XY[][] = [];
  for (const ch of chars) {
    const glyph = HERSHEY[ch];
    if (glyph) {
      for (const stroke of glyph.strokes) {
        strokes.push(stroke.map(([px, py]) => ({ x: cx + px * s, y: y + py * s })));
      }
    }
    cx += adv(ch);
  }
  return { strokes, width };
}

// Vertex-preserving resample: interpolate WITHIN each segment only. Segments
// touching a sharp corner densify to CURVE_STITCH_MM.
function resampleStroke(stroke: XY[], stitchMm: number): XY[] {
  if (stroke.length < 2) return stroke;
  // corner sharpness per vertex (angle between adjacent segments)
  const sharp = stroke.map((p, i) => {
    if (i === 0 || i === stroke.length - 1) return false;
    const a = stroke[i - 1];
    const b = stroke[i + 1];
    const v1 = Math.atan2(p.y - a.y, p.x - a.x);
    const v2 = Math.atan2(b.y - p.y, b.x - p.x);
    let d = Math.abs(v2 - v1) * (180 / Math.PI);
    if (d > 180) d = 360 - d;
    return d > CURVE_ANGLE_DEG;
  });
  const out: XY[] = [stroke[0]];
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const step = sharp[i - 1] || sharp[i] ? CURVE_STITCH_MM : stitchMm;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return out;
}

// Bean-stitch a laid-out text: returns continuous needle runs. Strokes whose
// gap ≤ 2mm join with running travel; larger gaps start a new run (the plan
// builder makes each run its own block, so trim stops apply as usual).
export function beanTextRuns(
  layout: HersheyLayout,
  stitchMm: number,
  passes: number
): XY[][] {
  const runs: XY[][] = [];
  let cur: XY[] = [];
  for (const stroke of layout.strokes) {
    if (stroke.length < 2) continue;
    const beaned = beanify(resampleStroke(stroke, stitchMm), passes);
    if (cur.length === 0) {
      cur = [...beaned];
      continue;
    }
    const last = cur[cur.length - 1];
    const gap = Math.hypot(stroke[0].x - last.x, stroke[0].y - last.y);
    if (gap <= TRAVEL_MAX_MM) {
      // running travel into the next stroke (single pass)
      const n = Math.max(1, Math.round(gap / stitchMm));
      for (let k = 1; k <= n; k++) {
        cur.push({
          x: last.x + ((stroke[0].x - last.x) * k) / n,
          y: last.y + ((stroke[0].y - last.y) * k) / n,
        });
      }
      cur.push(...beaned.slice(1));
    } else {
      runs.push(cur);
      cur = [...beaned];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
