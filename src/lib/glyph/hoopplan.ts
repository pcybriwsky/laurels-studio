// Multi-run hoop grid: N route-only glyphs (no stats, no brackets) composed
// into ONE stitch plan filling the SE700's 100x100mm field — the constellation
// design from the original marathon shorts, machine-ready. 3x3 gives ~1"
// glyphs, 4x4 gives ~0.8". Same zigzag satin as the badge route, thinner.
// Deliberately separate from the badge pipeline — a different design, not a
// replacement.
import { RoutePoint } from "@/lib/strava";
import { flattenRoute, resample, XY } from "./flatten";
import { StitchPlan, zigzag } from "./stitchplan";
import { digistCovers, layoutDigistMm, DIGIST_CAP_MM } from "./digisttext";

export interface HoopGlyphInput {
  label: string; // block label shown in counts + used for trims
  route: RoutePoint[];
}

export interface HoopPlanOpts {
  grid: number; // NxN cells filling the 100mm hoop (3 ≈ 1", 4 ≈ 0.8")
  lineWidthMm?: number; // satin ribbon width (default 1.5 — badge uses 2-3)
  routeStitchMm?: number;
  trimStops?: boolean;
  // DIGIST caption centered under the grid (e.g. cumulative block miles).
  // Reserves a bottom strip; the grid compresses to the space above it.
  caption?: string;
}

export const FIELD_MM = 100; // SE700 4x4 hoop
// caption strip: DIGIST caps are fixed 6.9mm; ~1.1mm air above, ~2mm below
export const CAPTION_STRIP_MM = 10;
const CAPTION_TRAVEL_MM = 1.3; // baseline-travel stitch length between letters
const STOP_JUMP_MM = 5;

// Grid area height when a caption strip is reserved (else the full field).
export function hoopField(caption?: string | null): number {
  return caption ? FIELD_MM - CAPTION_STRIP_MM : FIELD_MM;
}

// caption baseline: letters vertically centered inside the strip
export function captionBaselineMm(field: number): number {
  return field + ((FIELD_MM - field) + DIGIST_CAP_MM) / 2;
}

// Smallest square grid that holds `count` glyphs. 1 run → 1×1, 10 → 4×4.
export function fitHoopGrid(count: number): number {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

// Cell geometry in mm (same numbers as the 100-unit design preview).
// `field` = grid area edge length (smaller than FIELD_MM when a caption
// strip is reserved).
export function hoopLayout(
  grid: number,
  field: number = FIELD_MM
): { cell: number; margin: number; box: number } {
  const n = Math.max(1, Math.round(grid));
  const cell = field / n;
  // ~12% of cell, matching the old 4mm @ 3×3 / 2.5mm @ 4×4
  const margin = Math.max(1, Math.min(4, cell * 0.12));
  return { cell, margin, box: cell - 2 * margin };
}

// Glyph origin (top-left of the drawable box) for each of `count` glyphs in
// an NxN grid. Serpentine index order (odd rows right-to-left) keeps stitch
// jumps short, and partial rows + missing rows are CENTERED so a panel with
// 3 runs in a 2×2 grid reads as a balanced triangle, not a grid with a
// random empty corner. Design preview and stitch plan both draw from these
// cells, so they can never disagree.
export function hoopCells(
  count: number,
  grid: number,
  field: number = FIELD_MM
): { x0: number; y0: number }[] {
  const n = Math.max(1, Math.round(grid));
  const { cell, margin } = hoopLayout(n, field);
  // grid area horizontally centered in the full hoop when narrowed
  const gx = (FIELD_MM - field) / 2;
  const rows = Math.ceil(count / n);
  const yOff = ((n - rows) * cell) / 2;
  const cells: { x0: number; y0: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / n);
    const inRow = Math.min(n, count - row * n);
    const xOff = ((n - inRow) * cell) / 2;
    const k = i % n;
    const col = row % 2 === 0 ? k : inRow - 1 - k;
    cells.push({ x0: gx + xOff + col * cell + margin, y0: yOff + row * cell + margin });
  }
  return cells;
}

export function buildHoopPlan(glyphs: HoopGlyphInput[], opts: HoopPlanOpts): StitchPlan {
  const grid = Math.max(1, Math.round(opts.grid));
  const routeStitchMm = opts.routeStitchMm ?? 1.5;
  const trimStops = opts.trimStops ?? true;
  const caption = opts.caption?.trim() || null;
  const field = hoopField(caption);
  const { box } = hoopLayout(grid, field);
  // keep satin from filling the whole cell on dense auto-fit grids
  const lineWidthMm = Math.min(opts.lineWidthMm ?? 1.5, Math.max(0.4, box * 0.08));
  const zigDensity = Math.max(0.35, routeStitchMm / 3);

  const blocks: StitchPlan["blocks"] = [];
  const capacity = grid * grid;
  const shown = glyphs.slice(0, capacity);
  const cells = hoopCells(shown.length, grid, field);
  shown.forEach((g, i) => {
    const { x0, y0 } = cells[i];
    const pts = projectRoute(g.route, x0, y0, box, box);
    if (pts.length < 2) return;
    // flatten overlapping passes (out-and-backs) exactly like the badge route
    const walk = flattenRoute(pts).walk;
    const line = resample(walk, routeStitchMm);
    const stitched = zigzag(line, lineWidthMm, zigDensity);
    if (stitched.length >= 2) {
      blocks.push({ label: g.label, stitches: stitched.map(rounded) });
    }
  });

  // DIGIST caption under the grid: purchased PES letters placed verbatim at
  // true mm (same rule as the badge stats — never scaled, never resampled),
  // letters connected with baseline travels instead of untrimmable floats
  if (caption && digistCovers(caption)) {
    const yb = captionBaselineMm(field);
    const pts: XY[] = [];
    for (const letter of layoutDigistMm(caption, FIELD_MM / 2, yb)) {
      for (const block of letter.blocks) {
        const cur = pts[pts.length - 1];
        if (cur) {
          const entry = block[0];
          const travel: XY[] = [cur];
          if (Math.hypot(entry.x - cur.x, entry.y - cur.y) > 1.2) {
            if (Math.abs(cur.y - yb) > 0.05) travel.push({ x: cur.x, y: yb });
            if (Math.abs(entry.x - cur.x) > 0.05) travel.push({ x: entry.x, y: yb });
          }
          travel.push(entry);
          pts.push(...resampleTravel(travel, CAPTION_TRAVEL_MM).slice(1, -1));
        }
        pts.push(...block);
      }
    }
    if (pts.length >= 2) blocks.push({ label: caption, stitches: pts.map(rounded) });
  }

  if (trimStops) {
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1].stitches;
      const next = blocks[i].stitches;
      const [x1, y1] = prev[prev.length - 1];
      const [x2, y2] = next[0];
      if (Math.hypot(x2 - x1, y2 - y1) >= STOP_JUMP_MM) blocks[i].stop = true;
    }
  }

  return {
    version: 1,
    name: `hoopgrid-${grid}x${grid}`,
    units: "mm",
    patchMm: FIELD_MM,
    blocks,
  };
}

// aspect-preserving fit with cos(latitude) correction — same math as the badge
function projectRoute(route: RoutePoint[], x: number, y: number, w: number, h: number): XY[] {
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

function rounded(p: XY): [number, number] {
  return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100];
}

// per-segment resample keeping every authored vertex (travel rails need the
// baseline corner points intact)
function resampleTravel(pts: XY[], step: number): XY[] {
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
