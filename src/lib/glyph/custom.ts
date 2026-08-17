// Custom tab: the unbundled design experiments — receipt + route-over-grid.
// Two-layer color law (design law #2): CREAM for structure (grid, receipt
// paper), ORANGE for effort (route, distance). All geometry in the shared
// 100x100 glyph space. Text is Arimo Bold outlines (scalable, print-true);
// stitch generation for these designs comes once the look settles.
import { RoutePoint } from "@/lib/strava";
import { GlyphNode } from "./types";
import { GlyphText } from "./compose";
import { arimoCovers, layoutArimoText } from "./outlinefont";
import type { GlyphLayer } from "./serialize";

export const CREAM = "#e8d4a0";
export const ORANGE = "#ff6a00";

export interface CustomStats {
  title: string; // "MANHATTAN"
  dateStr: string; // "2025.11.15"
  distStr: string; // "35.67 MI"
  timeStr: string; // "5:13:03"
  bottomStr: string; // "RUN 001 - PAID IN FULL"
}

// ---------- GPX ----------

export interface ParsedGpx {
  name: string | null;
  route: RoutePoint[];
  distanceMi: number;
  dateStr: string | null; // "2026.08.12"
  timeStr: string | null; // "5:13:03" moving-ish (first->last timestamp)
}

export function parseGpx(text: string): ParsedGpx {
  const route: RoutePoint[] = [];
  for (const m of text.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)) {
    route.push({ lat: parseFloat(m[1]), lng: parseFloat(m[2]) });
  }
  const name = text.match(/<name>([^<]+)<\/name>/)?.[1] ?? null;

  let dist = 0;
  for (let i = 1; i < route.length; i++) dist += haversineM(route[i - 1], route[i]);

  const times = [...text.matchAll(/<time>([^<]+)<\/time>/g)].map((m) => Date.parse(m[1]));
  let dateStr: string | null = null;
  let timeStr: string | null = null;
  if (times.length > 0 && !Number.isNaN(times[0])) {
    const d = new Date(times[0]);
    dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    if (times.length > 1) {
      const secs = Math.round((times[times.length - 1] - times[0]) / 1000);
      if (secs > 0 && secs < 48 * 3600) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        timeStr = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
      }
    }
  }
  return { name, route, distanceMi: dist / 1609.34, dateStr, timeStr };
}

function haversineM(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------- shared text helpers ----------

// Arimo line, shrink-to-fit maxW, returns fill nodes (empty if uncovered
// chars). Exported: the Route style uses it for its stats caption.
export function arimoLine(t: GlyphText, maxW: number): GlyphNode[] {
  if (!arimoCovers(t.text) || t.text.trim() === "") return [];
  let size = t.size;
  const w = measureW({ ...t, size });
  if (w > maxW) size = (size * maxW) / w;
  const out: GlyphNode[] = [];
  for (const glyph of layoutArimoText({ ...t, size })) {
    const d = glyph.contours
      .map((c) => `M ${c.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`)
      .join(" ");
    out.push({ kind: "path", d, fill: true });
  }
  return out;
}

function measureW(t: GlyphText): number {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const glyph of layoutArimoText(t)) {
    for (const c of glyph.contours) {
      for (const p of c) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
    }
  }
  return maxX > minX ? maxX - minX : 0;
}

// ---------- design: receipt ----------

export interface ReceiptOpts {
  zigzagAmp?: number; // tooth height, units (pronounced tear)
  zigzagTooth?: number; // tooth width, units
}

export function generateReceipt(stats: CustomStats, opts: ReceiptOpts = {}): GlyphLayer[] {
  const amp = opts.zigzagAmp ?? 4;
  const tooth = opts.zigzagTooth ?? 6;
  const L = 15;
  const R = 85;
  const TOP = 18;
  const BOT = 76; // zigzag baseline

  const cream: GlyphNode[] = [];
  const orange: GlyphNode[] = [];

  // paper: dashed running-stitch outline (left, top, right)
  cream.push({
    kind: "path",
    d: `M ${L} ${BOT} L ${L} ${TOP} L ${R} ${TOP} L ${R} ${BOT}`,
    stroke: 0.8,
    dash: "2.4 1.6",
  });
  // torn edge: pronounced zigzag
  const teeth = Math.max(2, Math.floor((R - L) / tooth));
  const tw = (R - L) / teeth;
  let zig = `M ${L} ${BOT}`;
  for (let i = 0; i < teeth; i++) {
    zig += ` L ${(L + (i + 0.5) * tw).toFixed(2)} ${(BOT + amp).toFixed(2)} L ${(L + (i + 1) * tw).toFixed(2)} ${BOT}`;
  }
  cream.push({ kind: "path", d: zig, stroke: 0.8, sharp: true });

  // header row: title left, date right (sized so a long title can't reach
  // the date's column)
  cream.push(...arimoLine({ x: L + 4, y: TOP + 10, text: stats.title, size: 6.5, anchor: "start" }, 32));
  cream.push(...arimoLine({ x: R - 4, y: TOP + 10, text: stats.dateStr, size: 5, anchor: "end" }, 18));
  // the earned number, big and orange
  orange.push(...arimoLine({ x: 50, y: 48, text: stats.distStr, size: 17, anchor: "middle" }, 60));
  // time under it
  cream.push(...arimoLine({ x: 50, y: 59, text: stats.timeStr, size: 9, anchor: "middle" }, 40));
  // bottom line — the receipt's voice
  cream.push(...arimoLine({ x: 50, y: 70, text: stats.bottomStr, size: 5, anchor: "middle" }, 56));

  return [
    { color: CREAM, nodes: cream },
    { color: ORANGE, nodes: orange },
  ];
}

// ---------- design: route over grid ----------

export interface GridRouteOpts {
  spacing?: number; // grid cell, units
  routeWidth?: number; // route stroke, units
  gridInset?: number; // grid margin from edges
  // real street polylines (OSM) — when present they replace the abstract
  // grid, projected with the SAME transform as the route so they align
  streets?: RoutePoint[][];
}

export function generateGridRoute(route: RoutePoint[], opts: GridRouteOpts = {}): GlyphLayer[] {
  const spacing = opts.spacing ?? 12;
  const routeWidth = opts.routeWidth ?? 3.2;
  const inset = opts.gridInset ?? 6;

  const cream: GlyphNode[] = [];
  const orange: GlyphNode[] = [];

  const tx = routeTransform(route, 14, 14, 72, 72);

  if (opts.streets && opts.streets.length > 0 && tx) {
    // the field: the place's actual roads, thin running stitch, clipped to
    // the design area (segments split where they leave the frame)
    const lo = inset;
    const hi = 100 - inset;
    for (const way of opts.streets) {
      const pts = way.map(tx);
      let run: { x: number; y: number }[] = [];
      const flush = () => {
        if (run.length >= 2) {
          cream.push({
            kind: "path",
            d: run.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" "),
            stroke: 0.45,
            dash: "1.6 1.2",
            opacity: 0.75,
          });
        }
        run = [];
      };
      for (const p of pts) {
        if (p.x >= lo && p.x <= hi && p.y >= lo && p.y <= hi) run.push(p);
        else flush();
      }
      flush();
    }
  } else {
    // the field: abstract thin dashed running-stitch grid
    cream.push(...abstractGridNodes(spacing, inset));
  }

  // the effort: route, aspect-fit with latitude correction
  if (tx && route.length >= 2) {
    const pts = route.map(tx);
    orange.push({
      kind: "path",
      d: pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" "),
      stroke: routeWidth,
    });
  }

  return [
    { color: CREAM, nodes: cream },
    { color: ORANGE, nodes: orange },
  ];
}

// Abstract grid as a standalone underlay layer — usable under any style
// (design law: cream = structure). Frame-space, so no alignment concerns.
export function abstractGridNodes(spacing = 12, inset = 6): GlyphNode[] {
  const out: GlyphNode[] = [];
  for (let v = inset + spacing; v < 100 - inset; v += spacing) {
    out.push({ kind: "path", d: `M ${v} ${inset} L ${v} ${100 - inset}`, stroke: 0.45, dash: "1.6 1.2", opacity: 0.75 });
    out.push({ kind: "path", d: `M ${inset} ${v} L ${100 - inset} ${v}`, stroke: 0.45, dash: "1.6 1.2", opacity: 0.75 });
  }
  return out;
}

export function generateUnderlay(spacing = 12): GlyphLayer {
  return { color: CREAM, nodes: abstractGridNodes(spacing) };
}

// ---------- real streets (OpenStreetMap via Overpass) ----------

// Fetch drivable/runnable roads around the route's bounding box (padded so
// context streets fill the frame beyond the route itself). Public Overpass
// API — fine for click-through exploration, not bulk use.
export async function fetchStreets(route: RoutePoint[]): Promise<RoutePoint[][]> {
  if (route.length < 2) return [];
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  // pad ~35% each side: the canvas extends past the route's fit box
  const padLat = (Math.max(...lats) - Math.min(...lats)) * 0.35 + 0.001;
  const padLng = (Math.max(...lngs) - Math.min(...lngs)) * 0.35 + 0.001;
  const s = Math.min(...lats) - padLat;
  const n = Math.max(...lats) + padLat;
  const w = Math.min(...lngs) - padLng;
  const e = Math.max(...lngs) + padLng;
  const query = `[out:json][timeout:25];way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](${s},${w},${n},${e});out geom;`;
  // public Overpass instances get flaky under load — try mirrors in order
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: "POST",
        // browsers ignore the UA header (they send their own); Node needs it —
        // Overpass 406s requests without a real User-Agent
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "apparel-brand-lab/0.1",
        },
        body: "data=" + encodeURIComponent(query),
      });
      if (r.ok) {
        res = r;
        break;
      }
      lastErr = new Error(`Overpass ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error("Overpass unreachable");
  const data: { elements?: { geometry?: { lat: number; lon: number }[] }[] } = await res.json();
  const ways = (data.elements ?? [])
    .map((el) => (el.geometry ?? []).map((g) => ({ lat: g.lat, lng: g.lon })))
    .filter((w) => w.length >= 2);
  // density guard: cap total vertices so dense cities stay renderable
  let total = ways.reduce((s2, w2) => s2 + w2.length, 0);
  let out = ways;
  if (total > 30000) {
    out = ways.map((w2) => w2.filter((_, i) => i % 2 === 0 || i === w2.length - 1));
    total = out.reduce((s2, w2) => s2 + w2.length, 0);
  }
  return out;
}

// Full-frame projection of a route into the design space — the Route style's
// stitch path builds from these points (same box generateGridRoute draws).
export function projectFullFrame(route: RoutePoint[]): { x: number; y: number }[] {
  const tx = routeTransform(route, 14, 14, 72, 72);
  return tx ? route.map(tx) : [];
}

// shared aspect-fit transform (route defines it; streets reuse it)
function routeTransform(
  route: RoutePoint[],
  x: number,
  y: number,
  w: number,
  h: number
): ((p: RoutePoint) => { x: number; y: number }) | null {
  if (route.length < 2) return null;
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
  return (p) => ({
    x: x + w / 2 + (p.lng - cx) * kx * scale,
    y: y + h / 2 + (cy - p.lat) * scale,
  });
}

