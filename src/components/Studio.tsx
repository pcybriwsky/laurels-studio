"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StravaActivity, RoutePoint, decodePolyline, metersToMiles } from "@/lib/strava";
import { buildFacts } from "@/lib/glyph/facts";
import { parseGpx, fetchStreets, CustomStats } from "@/lib/glyph/custom";
import { fetchElevationGrid, contoursFromGrid, browserTileFetcher, ElevGrid } from "@/lib/glyph/topo";
import {
  buildStyle,
  splitBlock,
  BLOCK_PANELS,
  StyleId,
  OutputId,
  UnderlayId,
  WorkingRun,
  BlockPanel,
} from "@/lib/glyph/styles";
import { StitchPlanOpts } from "@/lib/glyph/stitchplan";
import { fitHoopGrid, hoopLayout, hoopField } from "@/lib/glyph/hoopplan";
import { saveLoc, loadLocs, saveStitchOpts, loadStitchOpts } from "@/lib/db";
import { reverseGeocodeLabel } from "@/lib/geocode";
import { RunRail, cleanText } from "@/components/RunRail";
import { PreviewPane } from "@/components/PreviewPane";

const STYLES: { id: StyleId; label: string }[] = [
  { id: "glyph", label: "Glyph" },
  { id: "route", label: "Route" },
  { id: "grid", label: "Grid" },
  { id: "receipt", label: "Receipt" },
  { id: "block", label: "Block" },
];
const OUTPUTS: { id: OutputId; label: string }[] = [
  { id: "embroidery", label: "Embroidery" },
  { id: "print", label: "DTF / Print" },
];
const UNDERLAYS: { id: UnderlayId; label: string }[] = [
  { id: "none", label: "none" },
  { id: "grid", label: "grid" },
  { id: "streets", label: "streets" },
  { id: "topo", label: "topo" },
];

// some cached runs are missing start_date_local (older syncs stored less) —
// an unguarded access throws inside a memo/effect and takes down the whole UI
const runDay = (r: StravaActivity) => (r.start_date_local ?? r.start_date ?? "").slice(0, 10);

export function Studio({ runs }: { runs: StravaActivity[] }) {
  const gpsRuns = useMemo(() => runs.filter((r) => r.map?.summary_polyline), [runs]);

  const [style, setStyle] = useState<StyleId>("glyph");
  const [output, setOutput] = useState<OutputId>("embroidery");
  const [underlay, setUnderlay] = useState<UnderlayId>("none");
  const [underlaySpacing, setUnderlaySpacing] = useState(12);
  const [topoLevels, setTopoLevels] = useState(7);
  const [routeWidth, setRouteWidth] = useState(3.2);
  const [gridSize, setGridSize] = useState<3 | 4>(3);

  const [working, setWorking] = useState<WorkingRun | null>(null);
  const [gpxName, setGpxName] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [blockPicked, setBlockPicked] = useState<number[]>([]);
  const [blockFrom, setBlockFrom] = useState("");
  const [blockTo, setBlockTo] = useState("");
  const [blockPanel, setBlockPanel] = useState<BlockPanel>(0);
  // hero badge lines — empty string = auto ("<total> MILES" / "ONE GOAL")
  const [blockL1, setBlockL1] = useState("");
  const [blockL2, setBlockL2] = useState("");
  const [locs, setLocs] = useState<Map<number, string>>(new Map());
  const [lookupBusy, setLookupBusy] = useState(false);

  const [streetWays, setStreetWays] = useState<RoutePoint[][]>([]);
  const [topoGrid, setTopoGrid] = useState<ElevGrid | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [geoRetry, setGeoRetry] = useState(0);
  const streetCache = useRef<Map<string, RoutePoint[][]>>(new Map());
  const topoCache = useRef<Map<string, ElevGrid>>(new Map());
  const [showStats, setShowStats] = useState(true);

  const [stitchOpts, setStitchOpts] = useState<Required<StitchPlanOpts>>({
    patchMm: 70,
    routeStitchMm: 1.5,
    textStitchMm: 0.8,
    bean: 5,
    trimStops: true,
    lineWidthMm: 2,
  });
  const [optsLoaded, setOptsLoaded] = useState(false);

  useEffect(() => {
    loadStitchOpts<Partial<StitchPlanOpts>>()
      .then((saved) => {
        if (saved) {
          setStitchOpts((d) => {
            const merged = { ...d, ...saved };
            merged.patchMm = Math.min(75, Math.max(30, merged.patchMm));
            return merged;
          });
        }
      })
      .catch(() => {})
      .finally(() => setOptsLoaded(true));
    loadLocs().then(setLocs).catch(() => {});
  }, []);
  useEffect(() => {
    if (optsLoaded) saveStitchOpts(stitchOpts).catch(() => {});
  }, [stitchOpts, optsLoaded]);

  // default pick: latest run
  useEffect(() => {
    if (!working && gpsRuns.length > 0) pickRun(gpsRuns[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsRuns]);

  const pickRun = (r: StravaActivity) => {
    const f = buildFacts(r, 0);
    setWorking({
      source: "strava",
      stravaId: r.id,
      name: r.name,
      route: r.map?.summary_polyline ? decodePolyline(r.map.summary_polyline) : [],
      stats: {
        title: locs.get(r.id) ?? "",
        dateStr: f.dateStr,
        distStr: f.distStr,
        timeStr: f.timeStr,
        bottomStr: "PAID IN FULL",
      },
    });
    // hero is never in the training panels
    if (style === "block") setBlockPicked((prev) => prev.filter((id) => id !== r.id));
  };

  const onGpx = async (file: File) => {
    try {
      const parsed = parseGpx(await file.text());
      const route =
        parsed.route.length > 3000
          ? parsed.route.filter((_, i) => i % Math.ceil(parsed.route.length / 3000) === 0)
          : parsed.route;
      setWorking({
        source: "gpx",
        stravaId: null,
        name: parsed.name ?? file.name,
        route,
        stats: {
          title: parsed.name ? cleanText(parsed.name) : "",
          dateStr: parsed.dateStr ?? "",
          distStr: `${parsed.distanceMi.toFixed(2)} MI`,
          timeStr: parsed.timeStr ?? "",
          bottomStr: "PAID IN FULL",
        },
      });
      setGpxName(file.name);
    } catch (e) {
      console.error("GPX parse failed:", e);
    }
  };

  const onStat = (k: keyof CustomStats, v: string) => {
    setWorking((w) => (w ? { ...w, stats: { ...w.stats, [k]: v } } : w));
    // place labels persist for Strava runs (same store the badge always used)
    if (k === "title" && working?.source === "strava" && working.stravaId != null) {
      saveLoc(working.stravaId, v).catch(() => {});
      setLocs((m) => {
        const next = new Map(m);
        if (v) next.set(working.stravaId!, v);
        else next.delete(working.stravaId!);
        return next;
      });
    }
  };

  const onLookup = async () => {
    if (!working || working.route.length === 0) return;
    setLookupBusy(true);
    try {
      const p = working.route[0];
      const label = await reverseGeocodeLabel(p.lat, p.lng);
      if (label) onStat("title", cleanText(label));
    } catch (e) {
      console.error("geocode failed:", e);
    } finally {
      setLookupBusy(false);
    }
  };

  // grid multi-pick
  const capacity = gridSize * gridSize;
  const toggleGrid = (id: number) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < capacity ? [...prev, id] : prev
    );

  const heroId = working?.source === "strava" ? working.stravaId : null;

  const toggleBlock = (id: number) => {
    if (id === heroId) return;
    setBlockPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // the date range IS the selection: picking both dates fills the block
  // automatically (no fill button). Checkbox tweaks survive until the range
  // changes, which starts a fresh block.
  useEffect(() => {
    if (!blockFrom || !blockTo) return;
    const lo = blockFrom <= blockTo ? blockFrom : blockTo;
    const hi = blockFrom <= blockTo ? blockTo : blockFrom;
    setBlockPicked(
      gpsRuns
        .filter((r) => {
          const d = runDay(r);
          return d >= lo && d <= hi && r.id !== heroId;
        })
        .sort((a, b) => runDay(a).localeCompare(runDay(b)))
        .map((r) => r.id)
    );
    // heroId deliberately omitted: picking a new hero already strips it from
    // blockPicked without resetting the user's checkbox tweaks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockFrom, blockTo, gpsRuns]);

  const gridRuns = useMemo(() => {
    const byId = new Map(gpsRuns.map((r) => [r.id, r]));
    return picked
      .map((id) => byId.get(id))
      .filter((r): r is StravaActivity => !!r?.map?.summary_polyline)
      .map((r) => ({
        label: runDay(r),
        route: decodePolyline(r.map!.summary_polyline!),
      }));
  }, [picked, gpsRuns]);

  // training block: oldest first, hero excluded, split into three thirds.
  // each panel's hoop grid auto-fits so every run in that third is stitched.
  const blockOrdered = useMemo(() => {
    const byId = new Map(gpsRuns.map((r) => [r.id, r]));
    return blockPicked
      .filter((id) => id !== heroId)
      .map((id) => byId.get(id))
      .filter((r): r is StravaActivity => !!r?.map?.summary_polyline)
      .sort((a, b) => runDay(a).localeCompare(runDay(b)));
  }, [blockPicked, gpsRuns, heroId]);

  const blockRuns = useMemo(
    () =>
      blockOrdered.map((r) => ({
        label: runDay(r),
        route: decodePolyline(r.map!.summary_polyline!),
      })),
    [blockOrdered]
  );

  const blockMarks = useMemo(() => {
    const panels = splitBlock(blockOrdered);
    const marks = new Map<number, { panel: 1 | 2 | 3 }>();
    panels.forEach((group, i) => {
      group.forEach((r) => {
        marks.set(r.id, { panel: (i + 1) as 1 | 2 | 3 });
      });
    });
    return marks;
  }, [blockOrdered]);

  // cumulative miles through each panel — the count "runs down the leg"
  // (238 → 471 → 712) and the last number is the block total
  const blockCumMiles = useMemo(() => {
    const panels = splitBlock(blockOrdered);
    let cum = 0;
    return panels.map((group) => {
      cum += group.reduce((s, r) => s + metersToMiles(r.distance), 0);
      return cum;
    }) as [number, number, number];
  }, [blockOrdered]);
  const blockTotalMi = Math.round(blockCumMiles[2]);
  const blockCaptions = useMemo(
    () =>
      blockOrdered.length > 0
        ? (blockCumMiles.map((m) => `${Math.round(m)} MI`) as [string, string, string])
        : null,
    [blockOrdered.length, blockCumMiles]
  );
  // hero statement lines: auto from the block total, editable per line
  const heroLine1 = blockL1.trim() || `${blockTotalMi} MILES`;
  const heroLine2 = blockL2.trim() || "ONE GOAL";
  const blockHeroLines = useMemo(
    () => (blockOrdered.length > 0 ? ([heroLine1, heroLine2] as [string, string]) : null),
    [blockOrdered.length, heroLine1, heroLine2]
  );

  const blockFit =
    style === "block" && blockPanel !== "hero"
      ? (() => {
          const n = splitBlock(blockOrdered)[blockPanel].length;
          const grid = fitHoopGrid(n);
          const { box } = hoopLayout(grid, hoopField(blockCaptions?.[blockPanel]));
          return { n, grid, box };
        })()
      : null;

  // geographic underlays (streets / topo): Route style only — they share the
  // route's projection so everything stays aligned
  const geoAvailable = style === "route" && !!working && working.route.length > 1;
  const geoRoute = geoAvailable ? working!.route : null;
  const geoKind = underlay === "streets" || underlay === "topo" ? underlay : null;
  const geoKey =
    geoRoute && geoKind
      ? `${geoKind}:${geoRoute[0].lat},${geoRoute[0].lng},${geoRoute.length}`
      : "";
  useEffect(() => {
    if (!geoKind || !geoRoute) return;
    if (geoKind === "streets") {
      const cached = streetCache.current.get(geoKey);
      if (cached) {
        setStreetWays(cached);
        setGeoState("ready");
        return;
      }
      setGeoState("loading");
      fetchStreets(geoRoute)
        .then((ways) => {
          streetCache.current.set(geoKey, ways);
          setStreetWays(ways);
          setGeoState("ready");
        })
        .catch((e) => {
          console.error("streets fetch failed:", e);
          setGeoState("error");
        });
    } else {
      const cached = topoCache.current.get(geoKey);
      if (cached) {
        setTopoGrid(cached);
        setGeoState("ready");
        return;
      }
      setGeoState("loading");
      fetchElevationGrid(geoRoute, browserTileFetcher())
        .then((grid) => {
          if (!grid) throw new Error("no elevation");
          topoCache.current.set(geoKey, grid);
          setTopoGrid(grid);
          setGeoState("ready");
        })
        .catch((e) => {
          console.error("topo fetch failed:", e);
          setGeoState("error");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey, geoRetry]);

  // contours recompute instantly from the cached grid as the slider moves
  const geoWays = useMemo<RoutePoint[][]>(() => {
    if (geoKind === "streets") return streetWays;
    if (geoKind === "topo" && topoGrid) return contoursFromGrid(topoGrid, topoLevels);
    return [];
  }, [geoKind, streetWays, topoGrid, topoLevels]);

  const styleInput = useMemo(
    () => ({
      style,
      output,
      run: working,
      gridRuns,
      underlay: (underlay === "streets" || underlay === "topo") && !geoAvailable ? "none" : underlay,
      underlaySpacing,
      geoWays: geoState === "ready" ? geoWays : [],
      showStats,
      stitchOpts,
      gridSize,
      routeWidth,
      blockRuns,
      blockPanel,
      blockCaptions,
      blockHeroLines,
    }),
    [
      style,
      output,
      working,
      gridRuns,
      underlay,
      underlaySpacing,
      geoWays,
      geoState,
      showStats,
      stitchOpts,
      gridSize,
      routeWidth,
      geoAvailable,
      blockRuns,
      blockPanel,
      blockCaptions,
      blockHeroLines,
    ]
  );

  const result = useMemo(() => buildStyle(styleInput), [styleInput]);

  const blockBundle = useMemo(
    () =>
      style === "block" && output === "embroidery"
        ? BLOCK_PANELS.map((p) => buildStyle({ ...styleInput, blockPanel: p }))
        : null,
    [style, output, styleInput]
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[270px_1fr] gap-6">
      <RunRail
        runs={gpsRuns}
        style={style}
        working={working}
        picked={style === "block" ? blockPicked : picked}
        capacity={capacity}
        gpxName={gpxName}
        onPickRun={pickRun}
        onToggleGrid={style === "block" ? toggleBlock : toggleGrid}
        onFillLatest={() => setPicked(gpsRuns.slice(0, capacity).map((r) => r.id))}
        onClearGrid={() => setPicked([])}
        onGpx={onGpx}
        onStat={onStat}
        onLookup={onLookup}
        lookupBusy={lookupBusy}
        block={
          style === "block"
            ? {
                from: blockFrom,
                to: blockTo,
                marks: blockMarks,
                onFrom: setBlockFrom,
                onTo: setBlockTo,
                onClear: () => {
                  setBlockPicked([]);
                  setBlockFrom("");
                  setBlockTo("");
                },
                heroLines: [heroLine1, heroLine2],
                onHeroLine: (i, v) => (i === 0 ? setBlockL1(v) : setBlockL2(v)),
              }
            : null
        }
      />

      <div className="space-y-4 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <Seg options={STYLES} value={style} onChange={setStyle} />
          <Seg options={OUTPUTS} value={output} onChange={setOutput} />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-gray-400">under</span>
            <Seg
              options={UNDERLAYS.map((u) => ({
                ...u,
                disabled: (u.id === "streets" || u.id === "topo") && !geoAvailable,
              }))}
              value={underlay}
              onChange={setUnderlay}
              small
            />
          </div>
          {geoKind && geoAvailable && (
            <span className="text-xs text-gray-400">
              {geoState === "loading" ? (
                geoKind === "topo" ? "fetching elevation…" : "fetching roads…"
              ) : geoState === "error" ? (
                <button onClick={() => setGeoRetry((n) => n + 1)} className="text-red-500 underline">
                  failed — retry
                </button>
              ) : geoState === "ready" ? (
                `${geoWays.length} ${geoKind === "topo" ? "contours" : "roads"}`
              ) : null}
            </span>
          )}
          {underlay === "topo" && geoState === "ready" && (
            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">
                detail {topoLevels}
              </span>
              <input
                type="range"
                min={3}
                max={14}
                step={1}
                value={topoLevels}
                onChange={(e) => setTopoLevels(Number(e.target.value))}
                className="accent-orange-600"
              />
            </label>
          )}
          {underlay === "grid" && (
            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">
                spacing {underlaySpacing}
              </span>
              <input
                type="range"
                min={6}
                max={22}
                step={1}
                value={underlaySpacing}
                onChange={(e) => setUnderlaySpacing(Number(e.target.value))}
                className="accent-orange-600"
              />
            </label>
          )}
          {style === "route" && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={showStats}
                  onChange={(e) => setShowStats(e.target.checked)}
                />
                stats
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">
                  route {routeWidth.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={1.5}
                  max={5}
                  step={0.1}
                  value={routeWidth}
                  onChange={(e) => setRouteWidth(Number(e.target.value))}
                  className="accent-orange-600"
                />
              </label>
            </>
          )}
          {style === "grid" && (
            <>
              <Seg
                options={[
                  { id: 3 as const, label: "3×3 · 1″" },
                  { id: 4 as const, label: "4×4 · 0.8″" },
                ]}
                value={gridSize}
                onChange={setGridSize}
                small
              />
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">
                  route {routeWidth.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={1.5}
                  max={5}
                  step={0.1}
                  value={routeWidth}
                  onChange={(e) => setRouteWidth(Number(e.target.value))}
                  className="accent-orange-600"
                />
              </label>
            </>
          )}
          {style === "block" && (
            <>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">
                  route {routeWidth.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={1.5}
                  max={5}
                  step={0.1}
                  value={routeWidth}
                  onChange={(e) => setRouteWidth(Number(e.target.value))}
                  className="accent-orange-600"
                />
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-gray-400">panel</span>
                <Seg
                  options={[
                    { id: 0 as BlockPanel, label: "1" },
                    { id: 1 as BlockPanel, label: "2" },
                    { id: 2 as BlockPanel, label: "3" },
                    { id: "hero" as BlockPanel, label: "hero" },
                  ]}
                  value={blockPanel}
                  onChange={setBlockPanel}
                  small
                />
              </div>
              {blockFit && (
                <span className="text-xs text-gray-400 font-mono">
                  {blockFit.grid}×{blockFit.grid} · {blockFit.n} runs · {blockFit.box.toFixed(0)}mm
                </span>
              )}
            </>
          )}
        </div>

        <PreviewPane
          result={result}
          output={output}
          stitchOpts={stitchOpts}
          onStitchOpts={(o) => setStitchOpts((s) => ({ ...s, ...o }))}
          runs={gpsRuns}
          blockBundle={blockBundle}
        />
      </div>
    </div>
  );
}

// the one segmented control (replaces every ad-hoc button row)
function Seg<T extends string | number>({
  options,
  value,
  onChange,
  small,
}: {
  options: { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => !o.disabled && onChange(o.id)}
          disabled={o.disabled}
          className={`${small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${
            value === o.id
              ? "bg-gray-900 text-white"
              : o.disabled
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
