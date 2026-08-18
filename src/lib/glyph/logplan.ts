// Log style: the captain's log — one row per run, ledger-composed into the
// 100mm hoop. Row = small route glyph · date (MM.DD) · distance (right-
// aligned) · thin rule. Text engines: "bean" (Hershey Simplex single-stroke,
// bean-stitched — the log look) or "juju" (DIGIST satin caps, fixed 6.9mm —
// the badge fallback). Overflow paginates into multiple hoopings.
//
// Draft composition v1 (fixed column x-origins, mm ≡ design units):
//   margins 6 · glyph box at x8 (square, row-height sized) · date col x22 ·
//   distance right-anchored x92 · rule x8→92 under the row
import { RoutePoint } from "@/lib/strava";
import { XY, flattenRoute, resample } from "./flatten";
import { StitchPlan, zigzag } from "./stitchplan";
import { GlyphNode } from "./types";
import { hersheyCovers, layoutHersheyMm, beanTextRuns, HersheyLayout } from "./beantext";
import { digistCovers, layoutDigistMm } from "./digisttext";
import { CREAM, ORANGE } from "./custom";
import type { GlyphLayer } from "./serialize";

export interface LogRow {
  route: RoutePoint[];
  dateStr: string; // "08.15"
  distStr: string; // "10.0"
}

export interface LogOpts {
  capMm: number; // 4.7 / 5.5 / 6.9
  stitchLenMm: number; // 1.2–2.2
  passes: number; // 1 / 3 / 5
  engine: "bean" | "juju";
}

export const LOG_FIELD_MM = 100;
const MARGIN = 6;
const X_GLYPH = 8;
const X_DATE = 24;
const X_DIST_R = 92;
const RULE_X0 = 8;
const RULE_X1 = 92;
const GLYPH_ZIG_MM = 1.1;
const ROUTE_STITCH_MM = 1.4;
const STOP_JUMP_MM = 5;

export function logRowHeight(capMm: number): number {
  return Math.max(11, capMm + 6.5);
}

export function logRowsPerPage(capMm: number): number {
  return Math.max(1, Math.floor((LOG_FIELD_MM - 2 * MARGIN) / logRowHeight(capMm)));
}

export function logPageCount(rowCount: number, capMm: number): number {
  return Math.max(1, Math.ceil(rowCount / logRowsPerPage(capMm)));
}

export interface LogBuild {
  plan: StitchPlan;
  layers: GlyphLayer[];
}

export function buildLogPlan(rows: LogRow[], page: number, opts: LogOpts): LogBuild {
  const perPage = logRowsPerPage(opts.capMm);
  const pageRows = rows.slice(page * perPage, (page + 1) * perPage);
  const rowH = logRowHeight(opts.capMm);

  const blocks: StitchPlan["blocks"] = [];
  const creamNodes: GlyphNode[] = [];
  const orangeNodes: GlyphNode[] = [];
  const push = (label: string, pts: XY[]) => {
    if (pts.length >= 2) blocks.push({ label, stitches: pts.map((p) => round2(p)) });
  };

  pageRows.forEach((row, i) => {
    const top = MARGIN + i * rowH;
    const baseline = top + rowH / 2 + opts.capMm / 2 - 1; // text vertically centered
    const label = `r${i + 1}`;

    // --- route glyph: aspect-fit into a square box, thin zigzag satin ---
    const box = rowH - 3.5;
    const pts = projectInto(row.route, X_GLYPH, top + 1.2, box, box);
    if (pts.length >= 2) {
      const walk = flattenRoute(pts).walk;
      const line = resample(walk, ROUTE_STITCH_MM);
      push(`${label} route`, zigzag(line, GLYPH_ZIG_MM, 0.45));
      orangeNodes.push({
        kind: "path",
        d: walk.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" "),
        stroke: GLYPH_ZIG_MM,
      });
    }

    // --- text columns ---
    textBlocks(row.dateStr, X_DATE, baseline, "start", opts, `${label} ${row.dateStr}`, push, creamNodes);
    textBlocks(row.distStr, X_DIST_R, baseline, "end", opts, `${label} ${row.distStr}`, push, creamNodes);

    // --- rule: single running pass under the row ---
    const ruleY = top + rowH - 1.6;
    const rule = resample(
      [
        { x: RULE_X0, y: ruleY },
        { x: RULE_X1, y: ruleY },
      ],
      2
    );
    push(`${label} rule`, rule);
    creamNodes.push({
      kind: "path",
      d: `M ${RULE_X0} ${ruleY.toFixed(2)} L ${RULE_X1} ${ruleY.toFixed(2)}`,
      stroke: 0.35,
      opacity: 0.8,
    });
  });

  // trim stops at long jumps (existing machine behavior)
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1].stitches;
    const next = blocks[i].stitches;
    const [x1, y1] = prev[prev.length - 1];
    const [x2, y2] = next[0];
    if (Math.hypot(x2 - x1, y2 - y1) >= STOP_JUMP_MM) blocks[i].stop = true;
  }

  return {
    plan: {
      version: 1,
      name: `log-p${page + 1}`,
      units: "mm",
      patchMm: LOG_FIELD_MM,
      blocks,
    },
    layers: [
      { color: CREAM, nodes: creamNodes },
      { color: ORANGE, nodes: orangeNodes },
    ],
  };
}

// One text run in the chosen engine: bean = Hershey stitch runs + stroke
// design nodes; juju = DIGIST fixed-size satin paths (design = stitch path).
function textBlocks(
  text: string,
  x: number,
  baseline: number,
  anchor: "start" | "end",
  opts: LogOpts,
  label: string,
  push: (label: string, pts: XY[]) => void,
  design: GlyphNode[]
) {
  if (!text.trim()) return;
  if (opts.engine === "bean" && hersheyCovers(text)) {
    const layout = layoutHersheyMm(text, opts.capMm, x, baseline, anchor);
    for (const run of beanTextRuns(layout, opts.stitchLenMm, opts.passes)) {
      push(label, run);
    }
    design.push(...hersheyDesignNodes(layout, opts.passes));
  } else if (digistCovers(text)) {
    // JuJu fallback: fixed 6.9mm caps regardless of capMm (that's the font).
    // layoutDigistMm centers on x — probe at 0, measure, shift to the anchor.
    const probe = layoutDigistMm(text, 0, baseline);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const letter of probe) {
      for (const block of letter.blocks) {
        for (const p of block) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
        }
      }
    }
    const dx = anchor === "end" ? x - maxX : x - minX;
    for (const letter of probe) {
      for (const block of letter.blocks) {
        const pts = block.map((p) => ({ x: p.x + dx, y: p.y }));
        push(label, pts);
        design.push({
          kind: "path",
          d: pts.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" "),
          stroke: 0.5,
        });
      }
    }
  }
}

// design preview: single-stroke skeleton, weight suggesting the pass count
export function hersheyDesignNodes(layout: HersheyLayout, passes: number): GlyphNode[] {
  const w = passes >= 5 ? 0.85 : passes >= 3 ? 0.65 : 0.45;
  return layout.strokes
    .filter((s) => s.length >= 2)
    .map((s) => ({
      kind: "path" as const,
      d: s.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" "),
      stroke: w,
    }));
}

// The acceptance scrap, one click: rows = cap 4.7/5.5/6.9, cols = passes 3/5,
// "08.15 10.0" per cell, bean engine. One hooping, cream 40wt, judge at
// arm's length.
export function buildLetteringTestPlan(stitchLenMm: number): StitchPlan {
  // single column, six rows: (cap 4.7/5.5/6.9) × (passes 3/5) — two columns
  // of "08.15 10.0" collide at 6.9mm caps, so the matrix stacks vertically
  const cells: { capMm: number; passes: number }[] = [
    { capMm: 4.7, passes: 3 },
    { capMm: 4.7, passes: 5 },
    { capMm: 5.5, passes: 3 },
    { capMm: 5.5, passes: 5 },
    { capMm: 6.9, passes: 3 },
    { capMm: 6.9, passes: 5 },
  ];
  const blocks: StitchPlan["blocks"] = [];
  cells.forEach((cell, r) => {
    const baseline = 14 + r * 15;
    const layout = layoutHersheyMm("08.15 10.0", cell.capMm, 8, baseline, "start");
    for (const run of beanTextRuns(layout, stitchLenMm, cell.passes)) {
      if (run.length >= 2)
        blocks.push({
          label: `cap${cell.capMm} x${cell.passes}`,
          stitches: run.map((p) => round2(p)),
        });
    }
  });
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1].stitches;
    const next = blocks[i].stitches;
    if (Math.hypot(next[0][0] - prev[prev.length - 1][0], next[0][1] - prev[prev.length - 1][1]) >= STOP_JUMP_MM)
      blocks[i].stop = true;
  }
  return { version: 1, name: "lettering-test", units: "mm", patchMm: LOG_FIELD_MM, blocks };
}

function projectInto(route: RoutePoint[], x: number, y: number, w: number, h: number): XY[] {
  if (route.length < 2) return [];
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * kx, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min(w / spanX, h / spanY);
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  return route.map((p) => ({
    x: x + w / 2 + (p.lng - cx) * kx * scale,
    y: y + h / 2 + (cy - p.lat) * scale,
  }));
}

function round2(p: XY): [number, number] {
  return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100];
}
