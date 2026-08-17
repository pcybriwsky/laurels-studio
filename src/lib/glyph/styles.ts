// Style adapters: one interface over the existing generators, so the Studio
// renders every design through the same layered path.
//
//   WorkingData (route(s) + editable stats) × Style → { layers, plan }
//
// layers  = multi-color design rendering (preview + SVG/PNG/PDF exports)
// plan    = machine stitch plan when the style supports embroidery today
//           (null + note when the stitch generator hasn't been built yet)
//
// No geometry lives here — compose.ts / hoopplan.ts / custom.ts stay the
// single sources of truth.
import { RoutePoint } from "@/lib/strava";
import { RunFacts } from "./facts";
import { generateGlyphDetailed, ComposeOpts } from "./compose";
import { buildStitchPlan, StitchPlan, StitchPlanOpts } from "./stitchplan";
import {
  buildHoopPlan,
  fitHoopGrid,
  hoopLayout,
  hoopCells,
  hoopField,
  captionBaselineMm,
  HoopGlyphInput,
} from "./hoopplan";
import { digistCovers, layoutDigistMm } from "./digisttext";
import {
  CustomStats,
  generateReceipt,
  generateGridRoute,
  generateUnderlay,
  projectFullFrame,
  arimoLine,
  CREAM,
  ORANGE,
} from "./custom";
import { flattenRoute } from "./flatten";
import type { GlyphLayer } from "./serialize";

export type StyleId = "glyph" | "route" | "grid" | "receipt" | "block";
export type OutputId = "embroidery" | "print";
export type UnderlayId = "none" | "grid" | "streets" | "topo";
// Block style: which artifact is on screen — one of three chronological
// training panels, or the hero run's badge
export type BlockPanel = 0 | 1 | 2 | "hero";

export interface WorkingRun {
  source: "strava" | "gpx";
  stravaId: number | null;
  name: string;
  route: RoutePoint[];
  stats: CustomStats; // every field user-editable
}

export interface StyleInput {
  style: StyleId;
  output: OutputId;
  run: WorkingRun | null; // glyph + receipt + 1-run grid
  gridRuns: HoopGlyphInput[]; // grid style, 2+ runs
  underlay: UnderlayId;
  underlaySpacing: number;
  geoWays: RoutePoint[][]; // fetched streets OR topo contours (route style)
  showStats: boolean; // route style: stats caption under the route
  stitchOpts: Required<StitchPlanOpts>;
  gridSize: number; // Grid style: 3 or 4. Block panels: fitHoopGrid(count).
  routeWidth: number; // route/grid stroke (design units)
  // block style: the training block (hero excluded, oldest first) + which
  // panel is being previewed/exported
  blockRuns: HoopGlyphInput[];
  blockPanel: BlockPanel;
  // cumulative-miles captions, one per training panel (["238 MI", ...]) —
  // stitched in DIGIST under each constellation grid
  blockCaptions: [string, string, string] | null;
  // hero badge text: replaces the distance + date lines ("712 MILES" / "ONE
  // GOAL"), same centered stat-stack layout
  blockHeroLines: [string, string] | null;
  // internal: single-panel caption forwarded from blockStyle to gridStyle
  caption?: string | null;
}

export interface StyleResult {
  layers: GlyphLayer[]; // full composite (design/print preview + exports)
  underlay: GlyphLayer[]; // just the beneath-stuff — backdrop in stitch preview
  plan: StitchPlan | null;
  planNote: string | null; // why plan is null (shown in embroidery output)
  serial: string; // export filename stem
}

export function buildStyle(input: StyleInput): StyleResult {
  switch (input.style) {
    case "glyph":
      return glyphStyle(input);
    case "route":
      return routeStyle(input);
    case "grid":
      return gridStyle(input);
    case "receipt":
      return receiptStyle(input);
    case "block":
      return blockStyle(input);
  }
}

// Split a training block into three chronological panels — the marathon
// shorts recipe: three constellation hoopings + the hero's badge leg.
// Runs should already be oldest-first; leftover slots in the last panel
// are simply empty.
export function splitBlock<T>(runs: T[]): [T[], T[], T[]] {
  const per = Math.ceil(runs.length / 3);
  return [runs.slice(0, per), runs.slice(per, 2 * per), runs.slice(2 * per)];
}

export const BLOCK_PANELS: BlockPanel[] = [0, 1, 2, "hero"];

// Marathon shorts: three constellation hoopings (training thirds) plus
// the hero badge. Each panel auto-sizes its NxN hoop so every run fits.
function blockStyle(input: StyleInput): StyleResult {
  if (input.blockPanel === "hero") {
    if (!input.run) return empty("pick a hero run");
    // the hero badge trades its distance/date lines for the block statement
    // ("712 MILES" / "ONE GOAL") — same centered stack, same fonts
    const run = input.blockHeroLines
      ? {
          ...input.run,
          stats: {
            ...input.run.stats,
            distStr: input.blockHeroLines[0],
            dateStr: input.blockHeroLines[1],
          },
        }
      : input.run;
    const result = glyphStyle({ ...input, run });
    // serial from the run's REAL date — the statement line ("ONE GOAL")
    // replaced dateStr, which glyphStyle's serial normally derives from
    const orig = `${input.run.stravaId ?? "gpx"}-${
      input.run.stats.dateStr.replace(/\./g, "").slice(4) || "0000"
    }`;
    return { ...result, serial: `block-hero-${orig}` };
  }

  const panels = splitBlock(input.blockRuns);
  const panelRuns = panels[input.blockPanel];
  if (panelRuns.length === 0) {
    return empty(`panel ${input.blockPanel + 1} is empty — fill a date range`);
  }

  const grid = fitHoopGrid(panelRuns.length);
  const caption = input.blockCaptions?.[input.blockPanel] ?? null;
  const result = gridStyle({ ...input, gridRuns: panelRuns, gridSize: grid, caption });
  return { ...result, serial: `block-p${input.blockPanel + 1}-${panelRuns.length}runs` };
}

// Facts constructed directly from the editable stats — the glyph composer
// only reads the preformatted strings + route, so overrides flow through.
function factsFrom(run: WorkingRun): RunFacts {
  const serial = `${run.stravaId ?? "gpx"}-${run.stats.dateStr.replace(/\./g, "").slice(4) || "0000"}`;
  return {
    runId: run.stravaId ?? 0,
    name: run.name,
    ordinal: 0,
    ordinalStr: "000",
    serial,
    dateStr: run.stats.dateStr,
    distStr: run.stats.distStr,
    timeStr: run.stats.timeStr,
    locStr: run.stats.title.trim() ? run.stats.title.trim().toUpperCase() : null,
    miles: 0,
    timeOfDay: "day",
    route: run.route,
  };
}

function underlayLayers(input: StyleInput): GlyphLayer[] {
  if (input.underlay !== "grid") return [];
  return [generateUnderlay(input.underlaySpacing)];
}

function glyphStyle(input: StyleInput): StyleResult {
  if (!input.run) return empty("pick a run");
  const facts = factsFrom(input.run);
  const opts: ComposeOpts = {};
  const mode = input.output === "print" ? "print" : "embroidery";
  const detailed = generateGlyphDetailed(facts, mode, opts);
  const under = underlayLayers(input);
  const layers: GlyphLayer[] = [
    ...under,
    { color: input.output === "print" ? ORANGE : CREAM, nodes: detailed.nodes },
  ];
  const plan =
    input.output === "embroidery"
      ? buildStitchPlan(detailed.geometry, facts.serial, input.stitchOpts)
      : null;
  return {
    layers,
    underlay: under,
    plan,
    planNote:
      input.underlay !== "none" && input.output === "embroidery"
        ? "underlay is design-only for now — the .pes contains the badge, not the grid"
        : null,
    serial: facts.serial,
  };
}

// Route style: the run outside the brackets — full-frame, geographic underlay
// (streets or topo contours, same projection), optional stats caption.
// Embroidery: the ROUTE stitches (flatten → patch scale via buildStitchPlan);
// the underlay and caption are design-only for now.
function routeStyle(input: StyleInput): StyleResult {
  if (!input.run || input.run.route.length < 2) return empty("pick a run");
  const geo = input.underlay === "streets" || input.underlay === "topo";
  const layers = generateGridRoute(input.run.route, {
    spacing: input.underlaySpacing,
    routeWidth: input.routeWidth,
    streets: geo && input.geoWays.length > 0 ? input.geoWays : undefined,
  });
  const shown = input.underlay === "none" ? layers.filter((l) => l.color !== CREAM) : layers;

  if (input.showStats) {
    const caption = [input.run.stats.distStr, input.run.stats.dateStr]
      .filter(Boolean)
      .join("   ");
    shown.push({
      color: CREAM,
      nodes: arimoLine({ x: 50, y: 96, text: caption, size: 5.5, anchor: "middle" }, 76),
    });
  }
  const under = shown.filter((l) => l.color === CREAM);

  const plan =
    input.output === "embroidery"
      ? buildStitchPlan(
          { route: flattenRoute(projectFullFrame(input.run.route)).walk, marks: [], texts: [] },
          `route-${input.run.stats.dateStr.replace(/\./g, "") || "custom"}`,
          input.stitchOpts
        )
      : null;

  return {
    layers: shown,
    underlay: under,
    plan,
    planNote:
      input.underlay !== "none" || input.showStats
        ? "the .pes contains the route only — underlay + caption stitching come once the design settles"
        : null,
    serial: `route-${input.run.stats.dateStr.replace(/\./g, "") || "custom"}`,
  };
}

function gridStyle(input: StyleInput): StyleResult {
  const runs = input.gridRuns;
  if (runs.length === 0) return empty("pick runs");

  const grid = Math.max(1, Math.round(input.gridSize));
  const caption = input.caption?.trim() || null;
  const field = hoopField(caption);
  const { cell, margin } = hoopLayout(grid, field);

  const plan =
    input.output === "embroidery"
      ? buildHoopPlan(runs, {
          grid,
          lineWidthMm: Math.min(2.5, Math.max(0.8, input.routeWidth * 0.47)),
          routeStitchMm: input.stitchOpts.routeStitchMm,
          trimStops: input.stitchOpts.trimStops,
          caption: caption ?? undefined,
        })
      : null;

  // design layers: exactly the stitch plan's cells (hoopCells centers partial
  // rows), drawn clean. Stroke stays in the pre-transform 100-space so it
  // scales DOWN with the cell — constant-width strokes turn real city routes
  // into blobs at mini-glyph size.
  const shown = runs.slice(0, grid * grid);
  const cells = hoopCells(shown.length, grid, field);
  const nodes = shown.flatMap((g, i) => {
    const sub = generateGridRoute(g.route, { routeWidth: input.routeWidth });
    const routeLayer = sub.find((l) => l.color === ORANGE);
    return (routeLayer?.nodes ?? []).map((n) =>
      transformNode(n, cells[i].x0, cells[i].y0, (cell - 2 * margin) / 100)
    );
  });

  // caption design nodes: the panel's 100 units ≡ 100mm, so DIGIST stitch
  // paths place 1:1 (embroidery look); print swaps in clean Arimo outlines,
  // mirroring the badge's print-mode text rule
  if (caption) {
    const yb = captionBaselineMm(field);
    if (input.output === "print") {
      nodes.push(...arimoLine({ x: 50, y: yb, text: caption, size: 8, anchor: "middle" }, 80));
    } else if (digistCovers(caption)) {
      for (const letter of layoutDigistMm(caption, 50, yb)) {
        for (const block of letter.blocks) {
          nodes.push({
            kind: "path",
            d: block
              .map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
              .join(" "),
            stroke: 0.5,
          });
        }
      }
    }
  }

  const under = underlayLayers(input);
  return {
    layers: [...under, { color: ORANGE, nodes }],
    underlay: under,
    plan,
    planNote: input.underlay !== "none" ? "underlay is design-only for now — the .pes contains the routes" : null,
    serial: `hoopgrid-${grid}x${grid}-${runs.length}runs`,
  };
}

function receiptStyle(input: StyleInput): StyleResult {
  if (!input.run) return empty("pick a run");
  const under = underlayLayers(input);
  const layers = [...under, ...generateReceipt(input.run.stats)];
  return {
    layers,
    underlay: under,
    plan: null,
    planNote: "receipt stitching isn't built yet — free-text DIGIST lines + tear are next once the design settles",
    serial: `receipt-${input.run.stats.dateStr.replace(/\./g, "") || "custom"}`,
  };
}

// scale/translate a path node's coordinates (glyph nodes have no transform)
function transformNode(
  n: GlyphLayer["nodes"][number],
  ox: number,
  oy: number,
  s: number
): GlyphLayer["nodes"][number] {
  if (n.kind !== "path") return n;
  const d = n.d.replace(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g, (_, x, y) => {
    return `${(ox + parseFloat(x) * s).toFixed(2)} ${(oy + parseFloat(y) * s).toFixed(2)}`;
  });
  const stroke = n.stroke !== undefined ? Math.max(0.3, n.stroke * s) : undefined;
  return { ...n, d, ...(stroke !== undefined ? { stroke } : {}) };
}

function empty(note: string): StyleResult {
  return { layers: [], underlay: [], plan: null, planNote: note, serial: "empty" };
}
