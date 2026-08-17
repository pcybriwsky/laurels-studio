// Turns a glyph's geometry into machine-ready stitch coordinates (millimeters,
// y-down). scripts/stitchplan_to_pes.py converts the downloaded JSON into a
// Brother .pes via pyembroidery.
//
// Blocks are continuous needle paths; the converter adds a trim + jump between
// them. Five blocks total: route, rule, distance, time, date.
import { GlyphGeometry } from "./compose";
import { resample, XY } from "./flatten";
import { textStrokes } from "./strokefont";
import { satinRails } from "./satinfont";
import { arimoCovers, layoutArimoText } from "./outlinefont";
import { excaliburCovers, layoutExcaliburText, satinPairRungs, satinUnderlay } from "./satintext";
import { glacialCovers, layoutGlacialText } from "./glacialtext";
import { digistCovers, layoutDigistMm } from "./digisttext";

// satin lettering floor: Excalibur small is digitized for ~4.5mm+ caps
const SATIN_TEXT_MIN_CAP_MM = 4.4;
// digitizer recipe for 40wt on knit (text columns only — route is untouched):
const SATIN_TEXT_SPACING_MM = 0.42; // per-rail penetration spacing
const SATIN_TEXT_PULL_COMP_MM = 0.18; // widen each column per side
const SATIN_TEXT_UNDERLAY_STITCH_MM = 1.5; // center-walk underlay run length
// Glacial Tiny small-location recipe — the font is digitized at 0.25mm density
// for 60wt thread + 65/9 needle (its own spec); denser than the 40wt recipe:
const GLACIAL_SPACING_MM = 0.3;
const GLACIAL_PULL_COMP_MM = 0.12;

export interface StitchPlan {
  version: 1;
  name: string;
  units: "mm";
  patchMm: number;
  // stop: insert a same-color color-change before this block — the machine
  // pauses and auto-trims the preceding jump (the SE700 cuts at color changes
  // but NOT at within-color jumps), then resumes on Start
  blocks: { label: string; stitches: [number, number][]; stop?: boolean }[];
}

// jumps at least this long get a trim stop (when trimStops is on)
const STOP_JUMP_MM = 5;

export interface StitchPlanOpts {
  patchMm?: number; // finished patch size (glyph 100 units -> this many mm)
  routeStitchMm?: number; // stitch length for route + rule
  textStitchMm?: number; // stitch length for lettering (finer)
  bean?: number; // odd repeat count for route/rule boldness (1 = plain running)
  trimStops?: boolean; // color-stop trick: machine pauses + trims at long jumps
  // satin-style zigzag width for route/brackets/letters — the way to get
  // genuinely THICK lines (bean passes only stack a single thread line).
  // 0 = off (bean/running behavior). Text zigzags at half this, capped 1.1mm.
  lineWidthMm?: number;
}

export function buildStitchPlan(
  geometry: GlyphGeometry,
  name: string,
  opts: StitchPlanOpts = {}
): StitchPlan {
  const patchMm = opts.patchMm ?? 90;
  const routeStitchMm = opts.routeStitchMm ?? 2.5;
  const textStitchMm = opts.textStitchMm ?? 1.3;
  const bean = opts.bean ?? 3;
  const trimStops = opts.trimStops ?? true;
  const lineWidthMm = opts.lineWidthMm ?? 0;
  const k = patchMm / 100;
  const toMm = (p: XY): XY => ({ x: p.x * k, y: p.y * k });
  // zigzag needle spacing along the line — dense enough to read as a solid
  // satin column
  const zigDensity = Math.max(0.35, routeStitchMm / 3);

  const blocks: StitchPlan["blocks"] = [];
  const push = (label: string, pts: XY[]) => {
    if (pts.length >= 2) blocks.push({ label, stitches: pts.map(rounded) });
  };

  // route: arc-length resample (GPS trace, no meaningful corners); zigzag when
  // a line width is set (safe — flattening removed all self-overlaps), else
  // bean stitch (each segment sewn forward-back-forward)
  const routeLine = resample(geometry.route.map(toMm), routeStitchMm);
  push(
    "route",
    lineWidthMm > 0 ? zigzag(routeLine, lineWidthMm, zigDensity) : beanify(routeLine, bean)
  );
  // marks (corner brackets): each bracket is TWO straight full-width satin
  // columns overlapping in a square at the corner — parallel equal-length
  // rails have zero pairing drift, ends stay full width, and every corner
  // stitches identically (the old bent-ribbon approach thinned a different
  // arm on each mirrored corner; confirmed on fabric)
  for (const mark of geometry.marks) {
    const mm = mark.map(toMm);
    if (lineWidthMm > 0 && mm.length === 3) {
      push("brackets", bracketColumns([mm[0], mm[1], mm[2]], lineWidthMm, zigDensity));
    } else {
      const markLine = resampleSegments(mm, routeStitchMm);
      push(
        "brackets",
        lineWidthMm > 0 ? zigzag(markLine, lineWidthMm, zigDensity) : beanify(markLine, bean)
      );
    }
  }

  // lettering: plain running stitch, finer step. Chars connect with TRAVEL
  // stitches routed along the text baseline (drop to baseline → advance →
  // rise into the next stroke) — a deliberate rail under the letters instead
  // of jump floats, because the SE700 cannot trim within-color jumps and
  // uncut floats across the letters destroy readability. Strokes always sew
  // in authored left-to-right direction so every char comes out identical.
  // Lettering: the vendored Glacial Tiny embroidery font (professionally
  // digitized satin rail pairs, designed for 2.8–8.4mm) when it covers the
  // text and zigzag mode is on; the squared stroke font as fallback. Element
  // gaps within a glyph travel directly (short); between glyphs, travels
  // route along the baseline so nothing crosses letterforms. Trim-stop
  // behavior is untouched — stops are assigned after ordering, below.
  for (const t of geometry.texts) {
    const yb = t.y * k;
    const pts: XY[] = [];
    const connect = (entry: XY) => {
      const cur = pts[pts.length - 1];
      if (!cur) return;
      const gap = Math.hypot(entry.x - cur.x, entry.y - cur.y);
      const travel: XY[] = [cur];
      if (gap > 1.2) {
        // between-glyph move: down to the baseline rail, across, back up
        if (Math.abs(cur.y - yb) > 0.05) travel.push({ x: cur.x, y: yb });
        if (Math.abs(entry.x - cur.x) > 0.05) travel.push({ x: entry.x, y: yb });
      }
      travel.push(entry);
      pts.push(...resampleSegments(travel, textStitchMm).slice(1, -1));
    };

    const capMm = t.size * 0.7 * k;
    if (t.font === "glacial" && glacialCovers(t.text)) {
      // small-location experiment: Glacial Tiny with the full modern satin
      // treatment (rung pairing + center-walk underlay + pull comp) — the
      // combination the lettering brief's attempt #3 was missing. 60wt spec.
      for (const glyph of layoutGlacialText(t)) {
        for (const el of glyph) {
          if (el.kind === "satin") {
            const aMm = el.a.map(toMm);
            const bMm = el.b.map(toMm);
            const under = satinUnderlay(aMm, bMm, el.rungs, SATIN_TEXT_UNDERLAY_STITCH_MM);
            const s = satinPairRungs(aMm, bMm, el.rungs, GLACIAL_SPACING_MM, GLACIAL_PULL_COMP_MM);
            connect(under[0]);
            pts.push(...under);
            pts.push(...s);
          } else {
            const line = resampleSegments(el.pts.map(toMm), textStitchMm);
            connect(line[0]);
            pts.push(...line);
          }
        }
      }
    } else if (digistCovers(t.text)) {
      // purchased DIGIST PES letters: professionally digitized fixed-size
      // stitch sequences, placed verbatim at true mm — never resampled,
      // never scaled. Baseline travels connect letters as usual.
      for (const letter of layoutDigistMm(t.text, t.x * k, t.y * k)) {
        for (const block of letter.blocks) {
          connect(block[0]);
          pts.push(...block);
        }
      }
    } else if (excaliburCovers(t.text) && capMm >= SATIN_TEXT_MIN_CAP_MM) {
      // REAL satin lettering: Excalibur (KOR classic), rails paired via the
      // digitizer's rungs — straight columns on diagonals and curves
      for (const glyph of layoutExcaliburText(t)) {
        for (const el of glyph) {
          if (el.kind === "satin") {
            const aMm = el.a.map(toMm);
            const bMm = el.b.map(toMm);
            // center-walk underlay first (down and back, ending at the
            // column start), then the pull-compensated satin over it
            const under = satinUnderlay(aMm, bMm, el.rungs, SATIN_TEXT_UNDERLAY_STITCH_MM);
            const s = satinPairRungs(
              aMm,
              bMm,
              el.rungs,
              SATIN_TEXT_SPACING_MM,
              SATIN_TEXT_PULL_COMP_MM
            );
            connect(under[0]);
            pts.push(...under);
            pts.push(...s);
          } else {
            const line = resampleSegments(el.pts.map(toMm), textStitchMm);
            connect(line[0]);
            pts.push(...line);
          }
        }
      }
    } else if (arimoCovers(t.text)) {
      // fallback below the satin floor: Arimo Bold's true contours stitched as
      // clean closed outline runs — thread width fills small letters into
      // solid-looking type. Travels ride the baseline.
      for (const glyph of layoutArimoText(t)) {
        for (const contour of glyph.contours) {
          const s = resampleSegments(contour.map(toMm), textStitchMm);
          connect(s[0]);
          pts.push(...s);
        }
      }
    } else {
      const capMm = t.size * 0.7 * k;
      const boldOffset = Math.max(0.15, Math.min(0.3, capMm * 0.05));
      for (const stroke of textStrokes(t)) {
        const raw = stroke.map(toMm);
        const s =
          lineWidthMm > 0
            ? offsetBold(resampleSegments(raw, textStitchMm), boldOffset)
            : resampleSegments(raw, textStitchMm);
        connect(s[0]);
        pts.push(...s);
      }
    }
    push(t.text, pts);
  }

  const ordered = orderBlocks(blocks);
  if (trimStops) {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].stitches;
      const next = ordered[i].stitches;
      const [x1, y1] = prev[prev.length - 1];
      const [x2, y2] = next[0];
      if (Math.hypot(x2 - x1, y2 - y1) >= STOP_JUMP_MM) ordered[i].stop = true;
    }
  }
  return { version: 1, name, units: "mm", patchMm, blocks: ordered };
}

type Block = StitchPlan["blocks"][number];
type Pt2 = [number, number];

const firstPt = (b: Block): Pt2 => b.stitches[0];
const lastPt = (b: Block): Pt2 => b.stitches[b.stitches.length - 1];
const dd = (a: Pt2, b: Pt2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Stitch-order strategy: route first (stitching the center first means every
// later float lies on top of it and stays trimmable), then text and other
// blocks chained nearest-neighbor, and the corner brackets LAST, walked
// around the perimeter — adjacent corner to adjacent corner, clockwise or
// counter-clockwise, whichever is cheaper from where the text ended. Jumps
// stay along the margins and never cross the artwork. Blocks are never
// reversed: everything sews in its authored direction so repeated elements
// (corners, letters) come out with identical stitch geometry and weight.
function orderBlocks(blocks: StitchPlan["blocks"]): StitchPlan["blocks"] {
  if (blocks.length <= 2) return blocks;
  const [route, ...rest] = blocks;
  const marks = rest.filter((b) => b.label === "brackets");
  const pool = rest.filter((b) => b.label !== "brackets");

  const ordered = [route];
  let cur = lastPt(route);
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
    pool.forEach((b, i) => {
      const d = dd(cur, firstPt(b));
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    });
    const b = pool.splice(bestIdx, 1)[0];
    ordered.push(b);
    cur = lastPt(b);
  }
  ordered.push(...perimeterWalk(marks, cur));
  return ordered;
}

// Visit corner marks in angular order around their centroid, starting nearest
// the current position, in whichever rotation direction costs less overall.
function perimeterWalk(marks: Block[], from: Pt2): Block[] {
  if (marks.length === 0) return [];
  const mids = marks.map((b): Pt2 => {
    const f = firstPt(b);
    const l = lastPt(b);
    return [(f[0] + l[0]) / 2, (f[1] + l[1]) / 2];
  });
  const cx = mids.reduce((s, m) => s + m[0], 0) / mids.length;
  const cy = mids.reduce((s, m) => s + m[1], 0) / mids.length;
  const byAngle = marks
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Math.atan2(mids[a][1] - cy, mids[a][0] - cx) -
        Math.atan2(mids[b][1] - cy, mids[b][0] - cx)
    );
  const n = byAngle.length;
  const startRank = byAngle
    .map((idx, rank) => ({ rank, d: dd(from, firstPt(marks[idx])) }))
    .sort((a, b) => a.d - b.d)[0].rank;

  const walk = (dir: 1 | -1): { seq: Block[]; cost: number } => {
    const seq: Block[] = [];
    let cur = from;
    let cost = 0;
    for (let k = 0; k < n; k++) {
      const idx = byAngle[(((startRank + k * dir) % n) + n) % n];
      const b = marks[idx];
      cost += dd(cur, firstPt(b));
      seq.push(b);
      cur = lastPt(b);
    }
    return { seq, cost };
  };

  const cw = walk(1);
  const ccw = walk(-1);
  return (cw.cost <= ccw.cost ? cw : ccw).seq;
}

export function downloadStitchPlan(plan: StitchPlan, filename: string) {
  const blob = new Blob([JSON.stringify(plan)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Quantize to 0.1mm — the native resolution of PES/PEC — so every consumer
// (TS writer, pyembroidery script) sees identical integer stitch units
function rounded(p: XY): [number, number] {
  return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
}

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Per-segment resampling: every original vertex becomes a needle point, so
// designed corners (brackets, letterforms) stay perfectly crisp regardless of
// stitch-length settings; long segments subdivide evenly.
function resampleSegments(pts: XY[], step: number): XY[] {
  if (pts.length < 2) return pts;
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return out;
}

// Faux-bold for text too small to satin: three parallel passes at
// perpendicular offsets (−o, center reversed, +o) chained into one continuous
// path — genuinely wider than bean (which re-uses the same needle holes)
// while keeping tiny letterforms crisp.
function offsetBold(line: XY[], offsetMm: number): XY[] {
  if (line.length < 2) return line;
  return [
    ...offsetPolyline(line, -offsetMm),
    ...[...line].reverse(),
    ...offsetPolyline(line, offsetMm),
  ];
}

function offsetPolyline(pts: XY[], o: number): XY[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    return { x: p.x + (o * nx) / l, y: p.y + (o * ny) / l };
  });
}

// Satin column along a centerline, built the way digitized fonts do it: two
// continuous offset RAILS, then rail-pair crossings by arc-length fraction.
// On tight curves the inside rail shortens, so the pairing stays monotone and
// the column follows the bend — no crossed X-stitches on hairpins (which the
// old alternate-point-offset approach produced on twisty routes).
// exported for hoopplan.ts (the multi-run hoop grid reuses the same satin)
export function zigzag(centerline: XY[], widthMm: number, densityMm: number): XY[] {
  if (centerline.length < 2) return centerline;
  const line = resample(centerline, Math.min(0.8, densityMm * 1.5));
  const half = widthMm / 2;
  // offset rails self-intersect where the curve radius drops below half the
  // column width (tight route curls) — cull the resulting reversal spikes or
  // the satin sprouts whiskers
  const railA = cullSpikes(offsetPolyline(line, half));
  const railB = cullSpikes(offsetPolyline(line, -half));
  const out = satinRails(railA, railB, densityMm);
  // anchor start/end on the centerline so travels/jumps meet cleanly
  out.unshift(line[0]);
  out.push(line[line.length - 1]);
  return out;
}

// One straight satin column between two points: parallel equal-length rails,
// uniform crossings, full width at both ends
function satinColumnStraight(p: XY, q: XY, widthMm: number, spacingMm: number): XY[] {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (widthMm / 2);
  const ny = (dx / len) * (widthMm / 2);
  return satinRails(
    [
      { x: p.x + nx, y: p.y + ny },
      { x: q.x + nx, y: q.y + ny },
    ],
    [
      { x: p.x - nx, y: p.y - ny },
      { x: q.x - nx, y: q.y - ny },
    ],
    spacingMm
  );
}

// L bracket = arm A column extended half a width past the corner + arm B
// column starting half a width before it — a clean square overlap
function bracketColumns(mark: [XY, XY, XY], widthMm: number, spacingMm: number): XY[] {
  const [a, c, b] = mark;
  const past = (from: XY, to: XY, d: number): XY => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: to.x + (dx / l) * d, y: to.y + (dy / l) * d };
  };
  const half = widthMm / 2;
  return [
    ...satinColumnStraight(a, past(a, c, half), widthMm, spacingMm),
    ...satinColumnStraight(past(b, c, half), b, widthMm, spacingMm),
  ];
}

// Remove near-duplicate points and direction reversals that offsetting
// introduces inside curves tighter than the offset distance
function cullSpikes(pts: XY[], minStep = 0.12): XY[] {
  let out = pts;
  for (let pass = 0; pass < 2; pass++) {
    const res: XY[] = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const p = res[res.length - 1];
      const c = out[i];
      const n = out[i + 1];
      const d1x = c.x - p.x;
      const d1y = c.y - p.y;
      const d2x = n.x - c.x;
      const d2y = n.y - c.y;
      const l1 = Math.hypot(d1x, d1y);
      const l2 = Math.hypot(d2x, d2y);
      if (l1 < minStep) continue;
      if (l1 > 0 && l2 > 0 && (d1x * d2x + d1y * d2y) / (l1 * l2) < -0.2) continue;
      res.push(c);
    }
    res.push(out[out.length - 1]);
    out = res;
  }
  return out;
}

// forward-back-forward per segment: classic bean stitch
function beanify(pts: XY[], repeat: number): XY[] {
  if (repeat <= 1 || pts.length < 2) return pts;
  const out: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    for (let r = 0; r < repeat; r++) {
      out.push(r % 2 === 0 ? pts[i] : pts[i - 1]);
    }
  }
  return out;
}
