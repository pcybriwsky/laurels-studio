// Offline render harness: builds block-style panels from realistic GPS routes
// and writes SVGs of both the design layers and the stitch plan, so rendering
// can be inspected without the browser. Run: npx tsx scripts/render-test.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildStyle, StyleInput } from "../src/lib/glyph/styles";
import type { GlyphLayer } from "../src/lib/glyph/serialize";
import type { GlyphNode } from "../src/lib/glyph/types";
import type { RoutePoint } from "../src/lib/strava";

const OUT = join(__dirname, "render-out");
mkdirSync(OUT, { recursive: true });

// ---------- realistic-ish routes around Brooklyn ----------
const BASE = { lat: 40.6782, lng: -73.9442 };
function noisy(points: [number, number][], jitter = 0.00008): RoutePoint[] {
  // densify each leg like real GPS (a point every ~10-20m) with small noise
  const out: RoutePoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLng] = points[i - 1];
    const [bLat, bLng] = points[i];
    const steps = Math.max(2, Math.round(Math.hypot(bLat - aLat, bLng - aLng) / 0.0004));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        lat: aLat + (bLat - aLat) * t + (Math.random() - 0.5) * jitter,
        lng: aLng + (bLng - aLng) * t + (Math.random() - 0.5) * jitter,
      });
    }
  }
  out.push({ lat: points[points.length - 1][0], lng: points[points.length - 1][1] });
  return out;
}

function parkLoop(cx: number, cy: number, r: number): RoutePoint[] {
  const pts: [number, number][] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) {
    pts.push([cx + Math.sin(a) * r * (1 + 0.15 * Math.sin(3 * a)), cy + Math.cos(a) * r * 0.7]);
  }
  return noisy(pts);
}

function outAndBack(cx: number, cy: number, len: number): RoutePoint[] {
  const out: [number, number][] = [
    [cx, cy],
    [cx + len * 0.3, cy + len * 0.1],
    [cx + len * 0.7, cy + len * 0.15],
    [cx + len, cy + len * 0.05],
  ];
  return noisy([...out, ...[...out].reverse()]);
}

function cityGrid(cx: number, cy: number, s: number): RoutePoint[] {
  return noisy([
    [cx, cy],
    [cx + s, cy],
    [cx + s, cy + s * 0.6],
    [cx + s * 0.4, cy + s * 0.6],
    [cx + s * 0.4, cy + s * 1.2],
    [cx + s * 1.3, cy + s * 1.2],
    [cx + s * 1.3, cy + s * 0.3],
    [cx + s * 1.8, cy + s * 0.3],
  ]);
}

const routes: { label: string; route: RoutePoint[] }[] = [];
for (let i = 0; i < 8; i++) {
  const dx = (i % 3) * 0.02;
  const dy = Math.floor(i / 3) * 0.02;
  const r =
    i % 3 === 0
      ? parkLoop(BASE.lat + dx, BASE.lng + dy, 0.008)
      : i % 3 === 1
        ? outAndBack(BASE.lat + dx, BASE.lng + dy, 0.02)
        : cityGrid(BASE.lat + dx, BASE.lng + dy, 0.008);
  routes.push({ label: `2026-0${(i % 6) + 1}-1${i}`, route: r });
}

// ---------- minimal SVG serializer mirroring GlyphSvg.tsx ----------
function nodeSvg(n: GlyphNode, color: string): string {
  const g = n as { stroke?: number; dash?: string; fill?: boolean; opacity?: number };
  const shape = (extra: string) =>
    g.fill
      ? `${extra} fill="${color}" fill-rule="evenodd"${g.opacity ? ` opacity="${g.opacity}"` : ""}`
      : `${extra} fill="none" stroke="${color}" stroke-width="${g.stroke ?? 1.2}" stroke-linecap="round" stroke-linejoin="round"${
          g.dash ? ` stroke-dasharray="${g.dash}"` : ""
        }${g.opacity ? ` opacity="${g.opacity}"` : ""}`;
  switch (n.kind) {
    case "path":
      return `<path ${shape(`d="${n.d}"`)} />`;
    case "circle":
      return `<circle ${shape(`cx="${n.cx}" cy="${n.cy}" r="${n.r}"`)} />`;
    case "rect":
      return `<rect ${shape(`x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"`)} />`;
    case "line":
      return `<line x1="${n.x1}" y1="${n.y1}" x2="${n.x2}" y2="${n.y2}" stroke="${color}" stroke-width="${g.stroke ?? 1.2}" stroke-linecap="round" />`;
    case "group":
      return `<g transform="${n.transform ?? ""}">${n.children.map((c) => nodeSvg(c, color)).join("")}</g>`;
    default:
      return "";
  }
}

function layersSvg(layers: GlyphLayer[]): string {
  const body = layers.map((l) => l.nodes.map((n) => nodeSvg(n, l.color)).join("\n")).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="800" height="800"><rect width="100" height="100" fill="#141a2e"/>${body}</svg>`;
}

function planSvg(plan: NonNullable<ReturnType<typeof buildStyle>["plan"]>): string {
  const polys = plan.blocks
    .map(
      (b) =>
        `<polyline points="${b.stitches.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="#e8d4a0" stroke-width="0.25"/>`
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.patchMm} ${plan.patchMm}" width="800" height="800"><rect width="${plan.patchMm}" height="${plan.patchMm}" fill="#141a2e"/>${polys}</svg>`;
}

// ---------- build the block ----------
const baseInput: Omit<StyleInput, "blockPanel"> = {
  style: "block",
  output: "print",
  run: null,
  gridRuns: [],
  underlay: "none",
  underlaySpacing: 12,
  geoWays: [],
  showStats: false,
  stitchOpts: {
    patchMm: 70,
    routeStitchMm: 1.5,
    textStitchMm: 0.8,
    lineWidthMm: 2,
    trimStops: true,
    bean: 0,
  },
  gridSize: 3,
  routeWidth: 3.2,
  blockRuns: routes,
  blockCaptions: ["238 MI", "471 MI", "712 MI"],
  blockHeroLines: ["712 MILES", "ONE GOAL"],
};

for (const panel of [0, 1, 2] as const) {
  const print = buildStyle({ ...baseInput, blockPanel: panel, output: "print" });
  writeFileSync(join(OUT, `panel${panel + 1}-design.svg`), layersSvg(print.layers));
  const emb = buildStyle({ ...baseInput, blockPanel: panel, output: "embroidery" });
  if (emb.plan) writeFileSync(join(OUT, `panel${panel + 1}-stitch.svg`), planSvg(emb.plan));
  console.log(
    `panel ${panel + 1}: ${print.serial} — layers=${print.layers.length} nodes=${print.layers.reduce((s, l) => s + l.nodes.length, 0)} plan=${emb.plan ? emb.plan.blocks.length + " blocks" : "none"}`
  );
}
// hero badge with the block statement lines
const heroRun = {
  source: "strava" as const,
  stravaId: 1,
  name: "Marathon",
  route: routes[0].route,
  stats: {
    title: "NYC",
    dateStr: "2026.11.02",
    distStr: "26.2 MI",
    timeStr: "3:59:00",
    bottomStr: "",
  },
};
const heroPrint = buildStyle({ ...baseInput, run: heroRun, blockPanel: "hero", output: "print" });
writeFileSync(join(OUT, "hero-design.svg"), layersSvg(heroPrint.layers));
const heroEmb = buildStyle({
  ...baseInput,
  run: heroRun,
  blockPanel: "hero",
  output: "embroidery",
});
writeFileSync(join(OUT, "hero-emb-design.svg"), layersSvg(heroEmb.layers));
console.log(`hero: ${heroPrint.serial} plan=${heroEmb.plan ? "yes" : "no"}`);
console.log("wrote SVGs to", OUT);
