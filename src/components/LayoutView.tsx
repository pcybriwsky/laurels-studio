"use client";

import { useMemo, useState } from "react";
import { StravaActivity, decodePolyline, RoutePoint } from "@/lib/strava";

interface LayoutViewProps {
  runs: StravaActivity[];
  selectedIds: Set<number>;
}

type Template = "full" | "accent" | "hero";
type Style = "grid" | "scatter";
type PanelKey = "FL" | "FR" | "BL" | "BR";

// Hero color (Bandit-style cream/gold on dark fabric)
const HERO_COLOR = "#e8d4a0";
// Texture color (low-opacity ghost across the body)
const TEXTURE_COLOR = "#ffffff";

interface Panel {
  key: PanelKey;
  side: "front" | "back";
  // Print area in shorts viewBox units (480x400)
  x: number;
  y: number;
  w: number;
  h: number;
}

// Two print areas per side, one for each leg panel.
const PANELS: Panel[] = [
  { key: "FL", side: "front", x: 60, y: 60, w: 160, h: 280 },
  { key: "FR", side: "front", x: 260, y: 60, w: 160, h: 280 },
  { key: "BL", side: "back", x: 60, y: 60, w: 160, h: 280 },
  { key: "BR", side: "back", x: 260, y: 60, w: 160, h: 280 },
];

// Accent: a single small panel on the front-right outer leg.
const ACCENT_PANEL: Panel = { key: "FR", side: "front", x: 320, y: 200, w: 90, h: 120 };

// Hero column: narrow vertical strip on front-right outer leg, low-mid placement (Bandit reference).
const HERO_PANEL: Panel = { key: "FR", side: "front", x: 348, y: 195, w: 48, h: 150 };

export function LayoutView({ runs, selectedIds }: LayoutViewProps) {
  const [template, setTemplate] = useState<Template>("full");
  const [style, setStyle] = useState<Style>("grid");
  const [density, setDensity] = useState(1.0); // scatter density multiplier
  const [rotation, setRotation] = useState<"none" | "slight" | "full">("slight");
  const [textureEnabled, setTextureEnabled] = useState(false);
  const [textureOpacity, setTextureOpacity] = useState(0.1);

  const items = useMemo(() => {
    const list: { run: StravaActivity; route: RoutePoint[] }[] = [];
    for (const r of runs) {
      if (!selectedIds.has(r.id)) continue;
      const route = r.map?.summary_polyline ? decodePolyline(r.map.summary_polyline) : [];
      list.push({ run: r, route });
    }
    return list;
  }, [runs, selectedIds]);

  // Distribute items across panels. For full coverage: chunk into 4 even groups
  // in chronological order (already sorted desc) — FL, FR, BL, BR. For accent
  // and hero: everything goes on the single FR panel.
  const distributed = useMemo(() => {
    if (items.length === 0) return new Map<PanelKey, typeof items>();
    const m = new Map<PanelKey, typeof items>();
    if (template === "accent" || template === "hero") {
      m.set("FR", items);
      return m;
    }
    const n = items.length;
    const sizes = chunkSizes(n, 4);
    let idx = 0;
    (["FL", "FR", "BL", "BR"] as PanelKey[]).forEach((k, i) => {
      m.set(k, items.slice(idx, idx + sizes[i]));
      idx += sizes[i];
    });
    return m;
  }, [items, template]);

  // Texture items: GPS-having runs not in the current selection. Shown as a low-opacity
  // ghost across the full leg panels regardless of template.
  const textureItems = useMemo(() => {
    if (!textureEnabled) return [];
    const out: { run: StravaActivity; route: RoutePoint[] }[] = [];
    for (const r of runs) {
      if (selectedIds.has(r.id)) continue;
      if (!r.map?.summary_polyline) continue;
      out.push({ run: r, route: decodePolyline(r.map.summary_polyline) });
    }
    return out;
  }, [runs, selectedIds, textureEnabled]);

  const textureDistributed = useMemo(() => {
    const m = new Map<PanelKey, typeof textureItems>();
    if (textureItems.length === 0) return m;
    const sizes = chunkSizes(textureItems.length, 4);
    let idx = 0;
    (["FL", "FR", "BL", "BR"] as PanelKey[]).forEach((k, i) => {
      m.set(k, textureItems.slice(idx, idx + sizes[i]));
      idx += sizes[i];
    });
    return m;
  }, [textureItems]);

  if (items.length === 0 && !textureEnabled) {
    return (
      <div className="border rounded-lg p-8 text-center bg-gray-50">
        <p className="text-gray-600 mb-2">No runs selected.</p>
        <p className="text-sm text-gray-500">
          Switch to the Data view and check the runs you want on the design.
        </p>
      </div>
    );
  }

  const panelsForTemplate: Panel[] =
    template === "full" ? PANELS : template === "hero" ? [HERO_PANEL] : [ACCENT_PANEL];

  const heroOverflow = template === "hero" && items.length > 8;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 p-3 border rounded-lg bg-gray-50">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Template</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as Template)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="full">Full coverage (4 panels)</option>
            <option value="accent">Accent (right leg only)</option>
            <option value="hero">Hero column (Bandit-style)</option>
          </select>
        </div>
        {template !== "hero" && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as Style)}
              className="border rounded px-2 py-1 text-sm bg-white"
            >
              <option value="grid">Grid (checkerboard)</option>
              <option value="scatter">Scatter (allover)</option>
            </select>
          </div>
        )}
        {style === "scatter" && template !== "hero" && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Density: {density.toFixed(2)}×
              </label>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={density}
                onChange={(e) => setDensity(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Rotation</label>
              <select
                value={rotation}
                onChange={(e) => setRotation(e.target.value as typeof rotation)}
                className="border rounded px-2 py-1 text-sm bg-white"
              >
                <option value="none">None</option>
                <option value="slight">Slight (±20°)</option>
                <option value="full">Full (0–360°)</option>
              </select>
            </div>
          </>
        )}
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={textureEnabled}
              onChange={(e) => setTextureEnabled(e.target.checked)}
            />
            <span className="text-gray-700">Texture pass</span>
          </label>
          {textureEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Opacity: {(textureOpacity * 100).toFixed(0)}%
              </span>
              <input
                type="range"
                min={0.04}
                max={0.3}
                step={0.01}
                value={textureOpacity}
                onChange={(e) => setTextureOpacity(Number(e.target.value))}
              />
            </div>
          )}
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">{items.length}</span> selected
          {textureEnabled && (
            <span className="text-gray-500"> · {textureItems.length} in texture</span>
          )}
          {template === "full" && (
            <>
              {" "}
              · split{" "}
              {(["FL", "FR", "BL", "BR"] as PanelKey[])
                .map((k) => distributed.get(k)?.length ?? 0)
                .join(" / ")}
            </>
          )}
        </div>
        {heroOverflow && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Hero column works best with 4–8 runs. {items.length} will render very small —
            consider using "Last 5" or "Last 8" to curate.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-6">
        <ShortsView
          label="Front"
          side="front"
          template={template}
          panels={panelsForTemplate.filter((p) => p.side === "front")}
          distributed={distributed}
          style={style}
          density={density}
          rotation={rotation}
          textureDistributed={textureDistributed}
          textureOpacity={textureOpacity}
        />
        <ShortsView
          label="Back"
          side="back"
          template={template}
          panels={panelsForTemplate.filter((p) => p.side === "back")}
          distributed={distributed}
          style={style}
          density={density}
          rotation={rotation}
          textureDistributed={textureDistributed}
          textureOpacity={textureOpacity}
        />
      </div>
    </div>
  );
}

// Split n items into k roughly-equal chunks, with the remainder distributed to the first chunks.
function chunkSizes(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const rem = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}

interface FitResult {
  cols: number;
  rows: number;
  cell: number;
}

function fitGrid(n: number, w: number, h: number): FitResult {
  if (n <= 0) return { cols: 1, rows: 1, cell: 0 };
  let best: FitResult = { cols: 1, rows: n, cell: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(w / cols, h / rows);
    if (cell > best.cell) best = { cols, rows, cell };
  }
  return best;
}

function ShortsView({
  label,
  side,
  template,
  panels,
  distributed,
  style,
  density,
  rotation,
  textureDistributed,
  textureOpacity,
}: {
  label: string;
  side: "front" | "back";
  template: Template;
  panels: Panel[];
  distributed: Map<PanelKey, { run: StravaActivity; route: RoutePoint[] }[]>;
  style: Style;
  density: number;
  rotation: "none" | "slight" | "full";
  textureDistributed: Map<PanelKey, { run: StravaActivity; route: RoutePoint[] }[]>;
  textureOpacity: number;
}) {
  const W = 480;
  const H = 400;
  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          <clipPath id={`shorts-body-${side}`}>
            <path d={shortsPath()} />
          </clipPath>
          {panels.map((p) => (
            <clipPath key={p.key} id={`print-${side}-${p.key}`}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} />
            </clipPath>
          ))}
        </defs>

        <ShortsArtwork side={side} />

        {/* Texture pass — non-selected runs scattered across the full leg panels at low opacity */}
        {textureDistributed.size > 0 && (
          <g clipPath={`url(#shorts-body-${side})`} opacity={textureOpacity}>
            {PANELS.filter((p) => p.side === side).map((p) => {
              const tItems = textureDistributed.get(p.key) ?? [];
              return (
                <g key={`tex-${p.key}`}>
                  <ScatterLayout
                    panel={p}
                    items={tItems}
                    density={1.0}
                    rotation="slight"
                    stroke={TEXTURE_COLOR}
                    seedSalt={9999}
                  />
                </g>
              );
            })}
          </g>
        )}

        <g clipPath={`url(#shorts-body-${side})`}>
          {panels.map((p) => {
            const cellItems = distributed.get(p.key) ?? [];
            return (
              <g key={p.key} clipPath={`url(#print-${side}-${p.key})`}>
                {template === "hero" ? (
                  <HeroColumn panel={p} items={cellItems} />
                ) : style === "grid" ? (
                  <GridLayout panel={p} items={cellItems} />
                ) : (
                  <ScatterLayout
                    panel={p}
                    items={cellItems}
                    density={density}
                    rotation={rotation}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Print-area outlines (visual aid) — suppressed in hero template for clarity */}
        {template !== "hero" &&
          panels.map((p) => (
            <rect
              key={`outline-${p.key}`}
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={0.5}
              strokeDasharray="4 3"
              clipPath={`url(#shorts-body-${side})`}
            />
          ))}

        {/* Panel labels — suppressed in hero template */}
        {template !== "hero" &&
          panels.map((p) => (
            <text
              key={`label-${p.key}`}
              x={p.x + 4}
              y={p.y + 12}
              fontSize="9"
              fill="#94a3b8"
              fontFamily="ui-monospace, monospace"
            >
              {p.key} ({distributed.get(p.key)?.length ?? 0})
            </text>
          ))}
      </svg>
    </div>
  );
}

function GridLayout({
  panel,
  items,
}: {
  panel: Panel;
  items: { run: StravaActivity; route: RoutePoint[] }[];
}) {
  const fit = fitGrid(items.length, panel.w, panel.h);
  const usedW = fit.cols * fit.cell;
  const usedH = fit.rows * fit.cell;
  const offsetX = panel.x + (panel.w - usedW) / 2;
  const offsetY = panel.y + (panel.h - usedH) / 2;
  return (
    <>
      {items.map(({ run, route }, i) => {
        const col = i % fit.cols;
        const row = Math.floor(i / fit.cols);
        const x = offsetX + col * fit.cell;
        const y = offsetY + row * fit.cell;
        const checker = (col + row) % 2 === 0;
        return (
          <g key={run.id} transform={`translate(${x} ${y})`}>
            <rect
              x={0}
              y={0}
              width={fit.cell}
              height={fit.cell}
              fill={checker ? "#ffffff" : "#f1f5f9"}
              opacity={0.85}
            />
            <DoodleSVG
              route={route}
              size={fit.cell}
              stroke="#0b1220"
              strokeWidth={Math.max(0.5, fit.cell / 50)}
            />
          </g>
        );
      })}
    </>
  );
}

// Mulberry32 — small deterministic PRNG so a given panel/count renders identically across re-renders.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScatterPlacement {
  cx: number;
  cy: number;
  size: number;
  angle: number;
}

// Mitchell's best-candidate sampling: for each new point, generate K candidates
// and pick the one whose nearest-neighbor distance is largest. Cheap, decent blue-noise quality.
// Guarantees exactly N points (no rejection) so every selected run is placed.
function scatterPlacements(
  n: number,
  panelW: number,
  panelH: number,
  density: number,
  rotation: "none" | "slight" | "full",
  seed: number
): ScatterPlacement[] {
  if (n === 0) return [];
  const rand = rng(seed);
  // Target spacing derived from area per item, scaled by inverse density (denser = smaller spacing).
  const targetR = Math.sqrt((panelW * panelH) / n) * 0.55 * (1 / density);
  // Doodle size slightly larger than spacing radius so motifs touch but don't overwhelm.
  const baseSize = targetR * 1.6;
  const placements: ScatterPlacement[] = [];

  for (let i = 0; i < n; i++) {
    const candidates = 12;
    let best: { x: number; y: number; d: number } | null = null;
    for (let c = 0; c < candidates; c++) {
      const x = rand() * panelW;
      const y = rand() * panelH;
      let nearest = Infinity;
      for (const pl of placements) {
        const dx = pl.cx - x;
        const dy = pl.cy - y;
        const d = dx * dx + dy * dy;
        if (d < nearest) nearest = d;
      }
      if (best === null || nearest > best.d) best = { x, y, d: nearest };
    }
    // Three subtle scale tiers for organic variation.
    const tier = rand();
    const sizeMul = tier < 0.2 ? 0.78 : tier < 0.8 ? 1.0 : 1.22;
    const size = baseSize * sizeMul;

    let angle = 0;
    if (rotation === "slight") angle = (rand() - 0.5) * 40; // ±20°
    else if (rotation === "full") angle = rand() * 360;

    placements.push({ cx: best!.x, cy: best!.y, size, angle });
  }
  return placements;
}

function ScatterLayout({
  panel,
  items,
  density,
  rotation,
  stroke = "#0b1220",
  seedSalt = 0,
}: {
  panel: Panel;
  items: { run: StravaActivity; route: RoutePoint[] }[];
  density: number;
  rotation: "none" | "slight" | "full";
  stroke?: string;
  seedSalt?: number;
}) {
  // Seed by panel key + count + salt so the layout is stable across re-renders
  // but distinct between texture-pass and main-pass.
  const seed =
    panel.key.charCodeAt(0) * 131 +
    panel.key.charCodeAt(1) +
    items.length * 17 +
    seedSalt;
  const placements = useMemo(
    () => scatterPlacements(items.length, panel.w, panel.h, density, rotation, seed),
    [items.length, panel.w, panel.h, density, rotation, seed]
  );

  return (
    <>
      {items.map(({ run, route }, i) => {
        const p = placements[i];
        if (!p) return null;
        const x = panel.x + p.cx - p.size / 2;
        const y = panel.y + p.cy - p.size / 2;
        return (
          <g
            key={run.id}
            transform={`translate(${x} ${y}) rotate(${p.angle.toFixed(2)} ${(p.size / 2).toFixed(2)} ${(p.size / 2).toFixed(2)})`}
          >
            <DoodleSVG
              route={route}
              size={p.size}
              stroke={stroke}
              strokeWidth={Math.max(0.4, p.size / 45)}
            />
          </g>
        );
      })}
    </>
  );
}

// Bandit-style vertical column of hero glyphs on the front-right outer leg.
// Each run gets a generous square cell, heavy stroke, tonal cream color against dark fabric.
function HeroColumn({
  panel,
  items,
}: {
  panel: Panel;
  items: { run: StravaActivity; route: RoutePoint[] }[];
}) {
  const N = items.length;
  if (N === 0) return null;
  const gap = Math.max(2, panel.h * 0.04);
  const cell = Math.min(panel.w, (panel.h - gap * (N - 1)) / N);
  const totalH = cell * N + gap * (N - 1);
  const startY = panel.y + (panel.h - totalH) / 2;
  const x = panel.x + (panel.w - cell) / 2;
  return (
    <>
      {items.map(({ run, route }, i) => {
        const y = startY + i * (cell + gap);
        return (
          <g key={run.id} transform={`translate(${x} ${y})`}>
            <DoodleSVG
              route={route}
              size={cell}
              stroke={HERO_COLOR}
              strokeWidth={Math.max(1, cell / 16)}
            />
          </g>
        );
      })}
    </>
  );
}

function DoodleSVG({
  route,
  size,
  stroke,
  strokeWidth,
}: {
  route: RoutePoint[];
  size: number;
  stroke: string;
  strokeWidth: number;
}) {
  if (!route || route.length < 2) {
    return <circle cx={size / 2} cy={size / 2} r={1.2} fill={stroke} opacity={0.3} />;
  }
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const range = Math.max(maxLat - minLat, maxLng - minLng) || 1;
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  const pad = Math.max(2, size * 0.08);
  const inner = size - 2 * pad;
  const sx = (lng: number) => pad + ((lng - cx) / range) * inner + inner / 2;
  const sy = (lat: number) => pad + ((cy - lat) / range) * inner + inner / 2;
  const d = route
    .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.lng).toFixed(2)} ${sy(p.lat).toFixed(2)}`)
    .join(" ");
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function ShortsArtwork({ side }: { side: "front" | "back" }) {
  return (
    <g>
      <path d={shortsPath()} fill="#1f2937" stroke="#0b1220" strokeWidth={1.5} />
      {/* Waistband */}
      <path
        d="M 60 60 Q 240 50 420 60 L 420 84 Q 240 74 60 84 Z"
        fill="#111827"
        stroke="#0b1220"
        strokeWidth={1}
      />
      {side === "front" ? (
        <>
          {/* Drawstring eyelets */}
          <circle cx="232" cy="74" r="1.2" fill="#94a3b8" />
          <circle cx="248" cy="74" r="1.2" fill="#94a3b8" />
          {/* Drawstring */}
          <path
            d="M 232 74 Q 240 92 248 74"
            fill="none"
            stroke="#94a3b8"
            strokeWidth={0.8}
          />
          {/* Fly stitching */}
          <line
            x1="240"
            y1="84"
            x2="240"
            y2="140"
            stroke="#0b1220"
            strokeWidth={0.6}
            opacity={0.6}
          />
        </>
      ) : (
        <>
          {/* Back center seam */}
          <line
            x1="240"
            y1="60"
            x2="240"
            y2="200"
            stroke="#0b1220"
            strokeWidth={0.8}
            opacity={0.6}
          />
          {/* Yoke seam */}
          <path
            d="M 90 110 Q 240 96 390 110"
            fill="none"
            stroke="#0b1220"
            strokeWidth={0.6}
            opacity={0.5}
          />
          {/* Back pocket hint */}
          <rect
            x={300}
            y={130}
            width={60}
            height={28}
            fill="none"
            stroke="#0b1220"
            strokeWidth={0.6}
            opacity={0.5}
            rx={2}
          />
        </>
      )}
      {/* Inseam center notch */}
      <path
        d="M 240 200 Q 235 250 220 360 M 240 200 Q 245 250 260 360"
        fill="none"
        stroke="#0b1220"
        strokeWidth={0.8}
        opacity={0.6}
      />
      {/* Outseam stitching */}
      <path
        d="M 60 84 L 42 220 L 122 358 M 420 84 L 438 220 L 358 358"
        fill="none"
        stroke="#0b1220"
        strokeWidth={0.6}
        opacity={0.5}
        strokeDasharray="2 2"
      />
      {/* Hem stitching */}
      <path
        d="M 122 358 L 222 358 M 258 358 L 358 358"
        fill="none"
        stroke="#0b1220"
        strokeWidth={0.6}
        opacity={0.5}
        strokeDasharray="2 2"
      />
    </g>
  );
}

function shortsPath() {
  return "M 60 60 Q 240 48 420 60 L 440 220 Q 425 300 358 358 L 258 358 Q 250 280 240 200 Q 230 280 222 358 L 122 358 Q 55 300 40 220 Z";
}
