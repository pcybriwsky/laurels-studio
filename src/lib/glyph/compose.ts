import { RoutePoint } from "@/lib/strava";
import { GlyphNode } from "./types";
import { RunFacts } from "./facts";
import { flattenRoute } from "./flatten";
import { textStrokes } from "./strokefont";
import { arimoCovers, layoutArimoText } from "./outlinefont";
import { excaliburCovers, layoutExcaliburText } from "./satintext";
import { glacialCovers, layoutGlacialText } from "./glacialtext";
import { digistCovers, layoutDigistMm, DIGIST_CAP_MM } from "./digisttext";

// One canonical glyph per run — fully deterministic, no randomness.
// Just the essentials: route hero, distance, moving time, date.
// Route dots decode: filled = start, open = finish; a closed loop gets start only.
// The drawn route IS the stitch plan: overlapping passes (out-and-back streets)
// are flattened into a single continuous Eulerian walk that only doubles a
// segment when the path needs it to stay unbroken — see flatten.ts.
// Embroidery constraints: strokes >= 1.2 units, primary text 8 units (~7mm on a
// 90mm patch), minimal text.
const THIN = 1.2;
const ROUTE_W = 3.2;

// "embroidery" draws the flattened Eulerian stitch path (overlaps merged);
// "raw" draws the GPS track as recorded — for prints, video, and comparison.
// "print" is the DTF/transfer artwork mode: raw route + clean Arimo Bold
// letterforms instead of stitch-path text — same grid, print-native rendering.
export type PathMode = "embroidery" | "raw" | "print";

export interface GlyphText {
  x: number;
  y: number; // baseline
  text: string;
  size: number;
  anchor: "start" | "middle" | "end";
  // "glacial" = render via the small Glacial Tiny satin font instead of the
  // fixed-size DIGIST letters (scrap-test toggle for tiny location text)
  font?: "glacial";
}

export interface ComposeOpts {
  // when set, the location line renders in Glacial at this cap height (mm at
  // the 70mm reference patch; scales with patch size like the route does).
  // undefined/0 = DIGIST fixed 6.9mm as usual.
  locGlacialMm?: number;
  // print-mode hero treatment: adds a moving-time line between distance and
  // date (three-line stack, still bottom-anchored to the bracket line).
  // Ignored outside "print" — the embroidered badge never changes from this.
  showTime?: boolean;
}

// Structured geometry in glyph units (100x100 viewBox) — the single source of
// truth shared by the SVG nodes and the stitch plan, so they cannot drift.
export interface GlyphGeometry {
  route: { x: number; y: number }[];
  // stroked polylines besides the route (v1: four corner brackets)
  marks: { x: number; y: number }[][];
  texts: GlyphText[];
}

export interface GlyphResult {
  nodes: GlyphNode[];
  // present in embroidery mode: unique stitch segments + how many the walk
  // had to double to stay continuous
  stitch: { segments: number; doubled: number } | null;
  geometry: GlyphGeometry;
}

export function generateGlyph(facts: RunFacts, mode: PathMode = "embroidery"): GlyphNode[] {
  return generateGlyphDetailed(facts, mode).nodes;
}

// --- Route Badge v1 layout constants (the open items to tune after scrap
// tests live here) ---
// Scrap test #1 verdict: one full-width stat line can't reach legible letter
// height at small patch sizes, so the stats stack: distance big, date small.
const BRACKET_INSET = 4; // corner bracket position from glyph edge
const BRACKET_ARM = 11; // corner bracket arm length
const BRACKET_W = 2.6; // bracket stroke weight (test vs route weight)
// Text renders from the DIGIST PES letters: FIXED 6.9mm caps at any patch
// size (fixed-size stitch files — that's how professional alphabets work).
// t.size only matters for the fallback fonts. Layout leaves room for two
// 6.9mm lines at 70–75mm patches.
const DIST_SIZE = 12;
const DATE_SIZE = 9;
// Layout v2 (2026-08-11): stat stack bottom-aligned — the date baseline sits
// ON the bottom bracket line (y=96), mirroring the location's cap tops on the
// top bracket line (y=4); distance rides 12 units above it. The route box
// expands into the freed middle with ~4 units of air on both sides.
// (v1 — DIST 75.5 / DATE 87.5 / route h50 — is what the first two stitched
// badges carry; the mockup renders v2 for them.)
const ROUTE_BOX = { x: 10, y: 12, w: 80, h: 58 };
const DIST_BASELINE = 84;
const DATE_BASELINE = 96;
// Optional place label ("NYC") at the badge top, centered between the top
// brackets, cap tops flush with the bracket square (y = BRACKET_INSET) at the
// reference patch. DIGIST (same letters as the stat stack — one voice across
// the badge; the small-Glacial scrap test read rough on fabric). Location
// badges use a FIXED slightly-smaller route box, symmetric between the label
// and the stats (~4.1 units of air both sides at the DIGIST label height),
// independent of any settings toggle.
const LOC_ROUTE_BOX = { x: 10, y: 18, w: 80, h: 52 };
// design view shows fixed-mm letters as they appear at this patch size
const DIGIST_REF_PATCH_MM = 70;

export function generateGlyphDetailed(
  facts: RunFacts,
  mode: PathMode = "embroidery",
  opts: ComposeOpts = {}
): GlyphResult {
  const nodes: GlyphNode[] = [];
  let stitch: GlyphResult["stitch"] = null;

  // --- corner brackets (viewfinder style) — frame without box bulk ---
  const i = BRACKET_INSET;
  const a = BRACKET_INSET + BRACKET_ARM;
  const o = 100 - BRACKET_INSET;
  // Every corner is authored horizontal-arm → corner → vertical-arm and is
  // stitched in that authored direction (no flipping), so all four sew with
  // identical geometry and come out the same weight on fabric
  const marks: { x: number; y: number }[][] = [
    [{ x: a, y: i }, { x: i, y: i }, { x: i, y: a }],
    [{ x: 100 - a, y: i }, { x: o, y: i }, { x: o, y: a }],
    [{ x: a, y: o }, { x: i, y: o }, { x: i, y: 100 - a }],
    [{ x: 100 - a, y: o }, { x: o, y: o }, { x: o, y: 100 - a }],
  ];
  for (const m of marks) {
    nodes.push({ kind: "path", d: pointsToPath(m), stroke: BRACKET_W, sharp: true });
  }

  // --- optional location line (metrics needed before the route box) ---
  let locText: GlyphText | null = null;
  if (facts.locStr) {
    // print mode ignores the small-Glacial experiment: DTF text is always the
    // clean DIGIST-equivalent size, so the layout math stays on the v2 grid
    const small =
      mode !== "print" && (opts.locGlacialMm ?? 0) > 0 && glacialCovers(facts.locStr);
    // capMm = size * 0.7 * (patchMm/100): exact at the 70mm reference patch
    const size = small ? opts.locGlacialMm! / (0.7 * (DIGIST_REF_PATCH_MM / 100)) : DATE_SIZE;
    // DIGIST renders at its fixed mm regardless of t.size; Glacial scales
    const capUnits = small ? 0.7 * size : DIGIST_CAP_MM * (100 / DIGIST_REF_PATCH_MM);
    locText = {
      x: 50,
      y: BRACKET_INSET + capUnits, // baseline: cap tops sit on the bracket line
      text: facts.locStr,
      size,
      anchor: "middle",
      ...(small ? { font: "glacial" as const } : {}),
    };
  }

  // --- route hero, centered, stamp-style stack ---
  // print-hero three-line stack (dist/time/date) reaches higher, so the route
  // box gives back 8 units at the bottom to keep the ~4-unit gap
  const heroTime = mode === "print" && !!opts.showTime;
  const box0 = locText ? LOC_ROUTE_BOX : ROUTE_BOX;
  const box = heroTime ? { ...box0, h: box0.h - 8 } : box0;
  const pts = projectRoute(facts.route, box.x, box.y, box.w, box.h);
  let walk = pts;
  if (mode === "embroidery") {
    const flat = flattenRoute(pts);
    walk = flat.walk;
    stitch = { segments: flat.totalEdges, doubled: flat.doubledEdges };
  }
  if (walk.length >= 2) {
    // No start/finish dot markers: small filled circles digitize into dense
    // stitch blobs (thousands of stitches for a few mm)
    nodes.push({ kind: "path", d: pointsToPath(walk), stroke: ROUTE_W });
  } else {
    nodes.push({ kind: "circle", cx: 50, cy: 44, r: 2.2, stroke: THIN });
  }

  // --- stat stack: distance big, date small ---
  // Rendered from the same letterforms the machine stitches: Glacial Tiny
  // satin glyphs (filled rail-pair quads) with the squared stroke font as
  // fallback — screen, PNG/IG exports, and fabric always match.
  const texts: GlyphText[] = heroTime
    ? [
        { x: 50, y: 78.4, text: facts.distStr, size: DIST_SIZE, anchor: "middle" },
        { x: 50, y: 87.2, text: facts.timeStr, size: DATE_SIZE, anchor: "middle" },
        { x: 50, y: DATE_BASELINE, text: facts.dateStr, size: DATE_SIZE, anchor: "middle" },
      ]
    : [
        { x: 50, y: DIST_BASELINE, text: facts.distStr, size: DIST_SIZE, anchor: "middle" },
        { x: 50, y: DATE_BASELINE, text: facts.dateStr, size: DATE_SIZE, anchor: "middle" },
      ];
  // location last so texts[0] stays the distance line (the UI reads it for
  // the letter-size readout)
  if (locText) texts.push(locText);
  // Print (DTF) text: real Arimo Bold outlines. Arimo is much WIDER than the
  // condensed DIGIST block letters, so each line keeps its own design size
  // (distance big, date/location small) and shrinks to fit its available
  // width: the location and date lines must clear the corner bracket arms
  // (~66 units), the distance line only the badge margins (~78).
  const measureArimoW = (tt: GlyphText): number => {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const glyph of layoutArimoText(tt)) {
      for (const c of glyph.contours) {
        for (const p of c) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
        }
      }
    }
    return maxX > minX ? maxX - minX : 0;
  };

  for (const t of texts) {
    if (mode === "print" && arimoCovers(t.text)) {
      const isLoc = t.y < 20;
      const maxW = isLoc || t.y > 90 ? 66 : 78;
      let size = t.size;
      const w = measureArimoW({ ...t, size });
      if (w > maxW) size = (size * maxW) / w;
      const tt: GlyphText = { ...t, size, font: undefined };
      // location stays top-flush on the bracket line at its final size
      if (isLoc) tt.y = BRACKET_INSET + 0.7 * size;
      for (const glyph of layoutArimoText(tt)) {
        const d = glyph.contours
          .map(
            (c) =>
              `M ${c.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`
          )
          .join(" ");
        nodes.push({ kind: "path", d, fill: true });
      }
    } else if (t.font === "glacial" && glacialCovers(t.text)) {
      // small-location experiment: Glacial Tiny satin ribbons, same filled
      // rail-pair rendering as the Excalibur path
      for (const glyph of layoutGlacialText(t)) {
        for (const el of glyph) {
          if (el.kind === "satin") {
            const fwd = el.a.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
            const back = [...el.b].reverse().map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
            nodes.push({ kind: "path", d: `M ${[...fwd, ...back].join(" L ")} Z`, fill: true });
          } else {
            nodes.push({ kind: "path", d: pointsToPath(el.pts), stroke: 0.6 });
          }
        }
      }
    } else if (digistCovers(t.text)) {
      // render the actual PES stitch paths (at the reference patch size) —
      // the design view shows real thread texture
      const mmToUnits = 100 / DIGIST_REF_PATCH_MM;
      for (const letter of layoutDigistMm(
        t.text,
        t.x / mmToUnits,
        t.y / mmToUnits
      )) {
        for (const block of letter.blocks) {
          nodes.push({
            kind: "path",
            d: pointsToPath(block.map((p) => ({ x: p.x * mmToUnits, y: p.y * mmToUnits }))),
            stroke: 0.5,
          });
        }
      }
    } else if (excaliburCovers(t.text)) {
      // satin letterforms as filled rail-pair ribbons + run connectors —
      // matches the stitched look
      for (const glyph of layoutExcaliburText(t)) {
        for (const el of glyph) {
          if (el.kind === "satin") {
            const fwd = el.a.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
            const back = [...el.b].reverse().map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
            nodes.push({ kind: "path", d: `M ${[...fwd, ...back].join(" L ")} Z`, fill: true });
          } else {
            nodes.push({
              kind: "path",
              d: pointsToPath(el.pts),
              stroke: 0.6,
            });
          }
        }
      }
    } else if (arimoCovers(t.text)) {
      for (const glyph of layoutArimoText(t)) {
        // all of a glyph's contours in one even-odd path so counters punch out
        const d = glyph.contours
          .map(
            (c) =>
              `M ${c.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`
          )
          .join(" ");
        nodes.push({ kind: "path", d, fill: true });
      }
    } else {
      for (const stroke of textStrokes(t)) {
        nodes.push({ kind: "path", d: pointsToPath(stroke), stroke: t.size * 0.14 });
      }
    }
  }

  return { nodes, stitch, geometry: { route: walk, marks, texts } };
}

// Fit the route into a target rect, aspect-preserving and centered, with
// cos(latitude) longitude correction so the drawn shape matches the real
// ground track (uncorrected routes stretch east–west at higher latitudes).
// No decimation here — flattenRoute resamples at stitch scale anyway.
function projectRoute(
  route: RoutePoint[],
  x: number,
  y: number,
  w: number,
  h: number
): { x: number; y: number }[] {
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

function pointsToPath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}
