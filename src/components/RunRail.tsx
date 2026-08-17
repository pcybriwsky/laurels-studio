"use client";

import { useEffect, useRef } from "react";
import { StravaActivity, metersToMiles } from "@/lib/strava";
import { CustomStats } from "@/lib/glyph/custom";
import { WorkingRun, StyleId } from "@/lib/glyph/styles";

// free-text fields render in fonts covering A-Z 0-9 . : - only
export const cleanText = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 .:\-]/g, "").slice(0, 24);

export interface BlockRail {
  from: string;
  to: string;
  marks: Map<number, { panel: 1 | 2 | 3 }>;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClear: () => void;
  // hero badge statement ("712 MILES" / "ONE GOAL") — auto from the block
  // total, editable here
  heroLines: [string, string];
  onHeroLine: (i: 0 | 1, v: string) => void;
}

// The one run picker. Radio-select for single-run styles, ordered multi-select
// for the grid style, date-range + hero for the block (marathon shorts) style.
// GPX uploads pin a synthetic row on top.
export function RunRail({
  runs,
  style,
  working,
  picked,
  capacity,
  gpxName,
  onPickRun,
  onToggleGrid,
  onFillLatest,
  onClearGrid,
  onGpx,
  onStat,
  onLookup,
  lookupBusy,
  block,
}: {
  runs: StravaActivity[];
  style: StyleId;
  working: WorkingRun | null;
  picked: number[];
  capacity: number;
  gpxName: string | null;
  onPickRun: (r: StravaActivity) => void;
  onToggleGrid: (id: number) => void;
  onFillLatest: () => void;
  onClearGrid: () => void;
  onGpx: (f: File) => void;
  onStat: (k: keyof CustomStats, v: string) => void;
  onLookup: () => void;
  lookupBusy: boolean;
  block: BlockRail | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const multi = style === "grid";
  const isBlock = style === "block";
  const heroId = working?.source === "strava" ? working.stravaId : null;

  // Chrome session restore repopulates the date inputs a beat AFTER the page
  // loads, silently (no input/change events) — so the DOM can show dates that
  // React state never received and the block never fills. Poll the inputs for
  // a few seconds after the block card mounts and push any silently-restored
  // values into state.
  const blockRef = useRef(block);
  blockRef.current = block;
  useEffect(() => {
    if (!isBlock) return;
    let ticks = 0;
    const id = setInterval(() => {
      const b = blockRef.current;
      const f = fromRef.current?.value ?? "";
      const t = toRef.current?.value ?? "";
      if (b && f && f !== b.from) b.onFrom(f);
      if (b && t && t !== b.to) b.onTo(t);
      if (++ticks >= 10) clearInterval(id);
    }, 300);
    return () => clearInterval(id);
  }, [isBlock]);

  // one-click ranges: N weeks back from the newest run, or every run — no
  // date typing, no session-restore pitfalls
  const newestDay = runs.length
    ? (runs[0].start_date_local ?? runs[0].start_date ?? "").slice(0, 10)
    : "";
  const oldestDay = runs.length
    ? (runs[runs.length - 1].start_date_local ?? runs[runs.length - 1].start_date ?? "").slice(0, 10)
    : "";
  const preset = (weeks: number | "all") => {
    const b = blockRef.current;
    if (!b || !newestDay) return;
    if (weeks === "all") {
      b.onFrom(oldestDay);
    } else {
      const d = new Date(newestDay + "T12:00:00");
      d.setDate(d.getDate() - weeks * 7);
      b.onFrom(d.toISOString().slice(0, 10));
    }
    b.onTo(newestDay);
  };

  return (
    <div className="flex flex-col gap-3">
      {isBlock && block && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-400">training block</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="text-gray-400 mb-0.5 block">from</span>
              <input
                ref={fromRef}
                type="date"
                value={block.from}
                onChange={(e) => block.onFrom(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="block text-xs">
              <span className="text-gray-400 mb-0.5 block">to</span>
              <input
                ref={toRef}
                type="date"
                value={block.to}
                onChange={(e) => block.onTo(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">last</span>
            {([8, 12, 16] as const).map((w) => (
              <button
                key={w}
                onClick={() => preset(w)}
                className="px-1.5 py-0.5 border border-gray-200 rounded font-mono text-gray-600 hover:border-orange-400 hover:text-orange-600"
              >
                {w}w
              </button>
            ))}
            <button
              onClick={() => preset("all")}
              className="px-1.5 py-0.5 border border-gray-200 rounded font-mono text-gray-600 hover:border-orange-400 hover:text-orange-600"
            >
              all
            </button>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={block.from && block.to && picked.length === 0 ? "text-red-500" : "text-gray-400"}>
              {block.from && block.to
                ? `${picked.length} runs in range`
                : "pick a range — runs fill in automatically"}
            </span>
            {(picked.length > 0 || block.from || block.to) && (
              <button onClick={block.onClear} className="text-gray-500 hover:text-gray-900">
                clear
              </button>
            )}
          </div>
          {picked.length > 0 && (
            <div className="pt-1 border-t border-gray-100 space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-gray-400">
                hero statement
              </div>
              {([0, 1] as const).map((i) => (
                <input
                  key={i}
                  value={block.heroLines[i]}
                  onChange={(e) => block.onHeroLine(i, cleanText(e.target.value))}
                  className="w-full border border-gray-200 rounded-md px-2 py-1 font-mono text-xs"
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border border-gray-200 rounded-xl overflow-hidden flex flex-col max-h-[52vh]">
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50/60 flex items-center justify-between text-xs">
          {multi ? (
            <>
              <span className="font-mono">
                {picked.length}/{capacity}
              </span>
              <span className="flex gap-3">
                <button onClick={onFillLatest} className="text-gray-500 hover:text-gray-900">
                  latest {capacity}
                </button>
                {picked.length > 0 && (
                  <button onClick={onClearGrid} className="text-gray-500 hover:text-gray-900">
                    clear
                  </button>
                )}
              </span>
            </>
          ) : isBlock ? (
            <span className="font-mono text-gray-500">
              {picked.length} runs
              {heroId != null ? " · hero set" : " · pick hero"}
            </span>
          ) : (
            <span className="text-gray-500">pick a run</span>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="text-orange-600 font-medium hover:text-orange-700"
          >
            + GPX
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".gpx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onGpx(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="overflow-y-auto">
          {gpxName && !multi && (
            <button
              onClick={() => {}}
              className={`w-full text-left px-3 py-2 border-b border-gray-100 text-sm ${
                working?.source === "gpx" ? "bg-orange-50" : ""
              }`}
            >
              <div className="font-medium truncate">⬆ {gpxName}</div>
              <div className="text-xs text-gray-400">
                uploaded GPX{isBlock && working?.source === "gpx" ? " · hero" : ""}
              </div>
            </button>
          )}
          {runs.map((r) => {
            const isHero = heroId === r.id;
            const inBlock = isBlock && picked.includes(r.id);
            const mark = isBlock ? block?.marks.get(r.id) : undefined;
            const active = multi
              ? picked.includes(r.id)
              : isBlock
                ? isHero || inBlock
                : working?.source === "strava" && working.stravaId === r.id;
            const idx = multi ? picked.indexOf(r.id) : -1;

            if (isBlock) {
              return (
                <div
                  key={r.id}
                  className={`flex items-stretch border-b border-gray-100 text-sm ${
                    isHero ? "bg-orange-50" : inBlock ? "bg-orange-50/40" : ""
                  }`}
                >
                  <label
                    className="flex items-center px-2 cursor-pointer"
                    title={isHero ? "hero is on its own leg" : "include in training panels"}
                  >
                    <input
                      type="checkbox"
                      checked={inBlock}
                      disabled={isHero}
                      onChange={() => onToggleGrid(r.id)}
                      className="accent-orange-600"
                    />
                  </label>
                  <button
                    onClick={() => onPickRun(r)}
                    className="flex-1 text-left px-2 py-2 hover:bg-orange-50/60 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{new Date(r.start_date_local ?? r.start_date).toLocaleDateString()}</span>
                      {isHero ? (
                        <span className="text-orange-600 text-xs font-medium">hero</span>
                      ) : mark ? (
                        <span className="text-orange-600 text-xs font-mono">#{mark.panel}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {r.name} · {metersToMiles(r.distance).toFixed(1)} mi
                    </div>
                  </button>
                </div>
              );
            }

            return (
              <button
                key={r.id}
                onClick={() => (multi ? onToggleGrid(r.id) : onPickRun(r))}
                className={`w-full text-left px-3 py-2 border-b border-gray-100 text-sm hover:bg-orange-50/60 ${
                  active ? "bg-orange-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{new Date(r.start_date_local ?? r.start_date).toLocaleDateString()}</span>
                  {idx >= 0 ? (
                    <span className="text-orange-600 text-xs font-mono">#{idx + 1}</span>
                  ) : active ? (
                    <span className="text-orange-600 text-xs">●</span>
                  ) : null}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {r.name} · {metersToMiles(r.distance).toFixed(1)} mi
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!multi && working && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-400">
            {isBlock ? "hero data" : "data"}
          </div>
          {(
            [
              ["title", "place / title"],
              ["dateStr", "date"],
              ["distStr", "distance"],
              ["timeStr", "time"],
              ...(style === "receipt" ? ([["bottomStr", "bottom line"]] as const) : []),
            ] as [keyof CustomStats, string][]
          ).map(([k, label]) => (
            <label key={k} className="block text-xs">
              <span className="flex items-center justify-between text-gray-400 mb-0.5">
                {label}
                {k === "title" && working.source === "strava" && (
                  <button
                    onClick={onLookup}
                    disabled={lookupBusy}
                    className="text-gray-400 underline disabled:opacity-50"
                    title="reverse-geocode the run's start point"
                  >
                    {lookupBusy ? "…" : "lookup"}
                  </button>
                )}
              </span>
              <input
                value={working.stats[k]}
                onChange={(e) => onStat(k, cleanText(e.target.value))}
                className="w-full border border-gray-200 rounded-md px-2 py-1 font-mono"
                placeholder="—"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
