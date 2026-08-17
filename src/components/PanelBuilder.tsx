"use client";

import { useMemo, useState } from "react";
import { StravaActivity, metersToMiles } from "@/lib/strava";
import { buildFacts } from "@/lib/glyph/facts";
import { generateGlyphDetailed } from "@/lib/glyph/compose";
import { downloadPanelPdf } from "@/lib/glyph/export";
import { PanelItem } from "@/lib/glyph/pdf";
import { GlyphNodes } from "@/components/GlyphSvg";

const PRINT_COLOR = "#ff6a00";

// DTF leg-panel builder for the print-shop handoff (Eric / Established
// Screens). Two panel types on a physical-size page, exported as true vector
// PDF, orange on transparent, RGB:
//  - grid: the left leg — full mini badges (route + mileage + date +
//    brackets) tiled to fill the panel
//  - hero: the right leg — one big run with distance, moving time, and date
export function PanelBuilder({ runs }: { runs: StravaActivity[] }) {
  const [panelW, setPanelW] = useState(10); // inches
  const [panelH, setPanelH] = useState(14);
  const [badgeIn, setBadgeIn] = useState(2.5);
  const [heroId, setHeroId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [tab, setTab] = useState<"grid" | "hero">("grid");

  const byId = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  // grid geometry: as many whole cells as fit; badges centered in cells
  const cols = Math.max(1, Math.floor(panelW / badgeIn));
  const rows = Math.max(1, Math.floor(panelH / badgeIn));
  const capacity = cols * rows;
  const cellW = panelW / cols;
  const cellH = panelH / rows;
  const glyphIn = badgeIn * 0.94; // breathing room inside the cell

  const toggle = (id: number) => {
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < capacity
          ? [...prev, id]
          : prev
    );
  };

  const gridItems: PanelItem[] = useMemo(() => {
    return picked
      .map((id, i) => {
        const run = byId.get(id);
        if (!run?.map?.summary_polyline) return null;
        const facts = buildFacts(run, 0);
        const nodes = generateGlyphDetailed(facts, "print").nodes;
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
          nodes,
          xIn: col * cellW + (cellW - glyphIn) / 2,
          yIn: row * cellH + (cellH - glyphIn) / 2,
          sizeIn: glyphIn,
        };
      })
      .filter((x): x is PanelItem => x !== null);
  }, [picked, byId, cols, cellW, cellH, glyphIn]);

  const heroItems: PanelItem[] = useMemo(() => {
    const run = heroId != null ? byId.get(heroId) : undefined;
    if (!run?.map?.summary_polyline) return [];
    const facts = buildFacts(run, 0);
    const nodes = generateGlyphDetailed(facts, "print", { showTime: true }).nodes;
    const size = Math.min(panelW, panelH) - 1; // 0.5" margin all around
    return [
      {
        nodes,
        xIn: (panelW - size) / 2,
        yIn: (panelH - size) / 2,
        sizeIn: size,
      },
    ];
  }, [heroId, byId, panelW, panelH]);

  const items = tab === "grid" ? gridItems : heroItems;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      <div className="border rounded-lg overflow-y-auto max-h-[75vh]">
        <div className="px-3 py-2 border-b bg-gray-50 sticky top-0 flex items-center justify-between text-xs">
          {tab === "grid" ? (
            <>
              <span className="font-medium">
                {picked.length} / {capacity} picked
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => setPicked(runs.slice(0, capacity).map((r) => r.id))}
                  className="underline text-gray-500"
                >
                  latest {capacity}
                </button>
                {picked.length > 0 && (
                  <button onClick={() => setPicked([])} className="underline text-gray-500">
                    clear
                  </button>
                )}
              </span>
            </>
          ) : (
            <span className="font-medium">pick the hero run</span>
          )}
        </div>
        {runs.map((r) => {
          const active = tab === "grid" ? picked.includes(r.id) : heroId === r.id;
          const idx = tab === "grid" ? picked.indexOf(r.id) : -1;
          return (
            <button
              key={r.id}
              onClick={() => (tab === "grid" ? toggle(r.id) : setHeroId(r.id))}
              className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-orange-50 ${
                active ? "bg-orange-100" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {new Date(r.start_date_local ?? r.start_date).toLocaleDateString()}
                </span>
                {idx >= 0 && <span className="text-orange-600 text-xs font-mono">#{idx + 1}</span>}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {r.name} · {metersToMiles(r.distance).toFixed(1)} mi
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex rounded border overflow-hidden">
            <button
              onClick={() => setTab("grid")}
              className={`px-3 py-1.5 text-sm ${tab === "grid" ? "bg-gray-900 text-white" : "bg-white"}`}
            >
              Grid leg
            </button>
            <button
              onClick={() => setTab("hero")}
              className={`px-3 py-1.5 text-sm ${tab === "hero" ? "bg-gray-900 text-white" : "bg-white"}`}
            >
              Hero leg
            </button>
          </div>
          <label className="text-xs text-gray-600 flex items-center gap-1">
            panel
            <input
              type="number"
              min={4}
              max={22}
              step={0.5}
              value={panelW}
              onChange={(e) => setPanelW(Number(e.target.value) || 10)}
              className="border rounded px-1.5 py-0.5 w-14 font-mono"
            />
            ×
            <input
              type="number"
              min={4}
              max={30}
              step={0.5}
              value={panelH}
              onChange={(e) => setPanelH(Number(e.target.value) || 14)}
              className="border rounded px-1.5 py-0.5 w-14 font-mono"
            />
            in
          </label>
          {tab === "grid" && (
            <label className="block">
              <span className="block text-xs text-gray-500 mb-1">
                Badge: {badgeIn.toFixed(1)}″ → {cols}×{rows} grid
              </span>
              <input
                type="range"
                min={1.5}
                max={4}
                step={0.25}
                value={badgeIn}
                onChange={(e) => setBadgeIn(Number(e.target.value))}
              />
            </label>
          )}
        </div>

        {items.length > 0 ? (
          <div className="flex gap-4 items-start flex-wrap">
            <svg
              viewBox={`0 0 ${panelW * 10} ${panelH * 10}`}
              className="rounded"
              style={{
                background: "#111827",
                color: PRINT_COLOR,
                width: "100%",
                maxWidth: 380,
                aspectRatio: `${panelW} / ${panelH}`,
              }}
            >
              {items.map((it, i) => (
                <g
                  key={i}
                  transform={`translate(${it.xIn * 10} ${it.yIn * 10}) scale(${(it.sizeIn * 10) / 100})`}
                >
                  <GlyphNodes nodes={it.nodes} />
                </g>
              ))}
            </svg>
            <div className="space-y-2 text-sm max-w-[240px]">
              <div className="text-xs text-gray-500 font-mono">
                {panelW}″ × {panelH}″ page ·{" "}
                {tab === "grid" ? `${items.length} badges @ ${glyphIn.toFixed(1)}″` : "1 hero"}
              </div>
              <button
                onClick={() =>
                  downloadPanelPdf(
                    items,
                    panelW,
                    panelH,
                    `dtf-panel-${tab}-${panelW}x${panelH}in.pdf`,
                    PRINT_COLOR
                  )
                }
                className="block w-full text-left px-3 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-700 font-medium"
              >
                ↓ PDF {panelW}″×{panelH}″ vector (DTF)
              </button>
              <p className="text-xs text-gray-400">
                True vector, orange on transparent, RGB. Page = panel size —
                tell Eric to print at 100% (or resize to the shorts; it stays
                sharp). DTF sheets run 22″ wide in 10″ height steps.
              </p>
            </div>
          </div>
        ) : (
          <div className="border rounded-lg p-8 text-center text-gray-500">
            {tab === "grid"
              ? `Pick runs on the left — up to ${capacity} for this panel at ${badgeIn}″ badges.`
              : "Pick the hero run on the left — it gets distance, time, and date."}
          </div>
        )}
      </div>
    </div>
  );
}
