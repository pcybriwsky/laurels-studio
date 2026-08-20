"use client";

import { useState } from "react";
import { StravaActivity } from "@/lib/strava";
import { StyleResult, OutputId } from "@/lib/glyph/styles";
import { StitchPlanOpts, downloadStitchPlan } from "@/lib/glyph/stitchplan";
import { downloadPes } from "@/lib/glyph/pes";
import {
  downloadLayeredSvg,
  downloadLayeredPng,
  downloadPdf,
} from "@/lib/glyph/export";
import { StitchPreview } from "@/components/StitchPreview";
import { GlyphNodes } from "@/components/GlyphSvg";
import { PanelBuilder } from "@/components/PanelBuilder";

// Fabric simulation. Black shorts to start (Lululemon-black), not pure #000
// which loses the sense of material. Cream thread reads 12.9:1 here.
const FABRIC = "#111111";
const PES_THREAD_COLOR = "#ff6a00";

export function PreviewPane({
  result,
  output,
  stitchOpts,
  onStitchOpts,
  runs,
  blockBundle,
}: {
  result: StyleResult;
  output: OutputId;
  stitchOpts: Required<StitchPlanOpts>;
  onStitchOpts: (o: Partial<StitchPlanOpts>) => void;
  runs: StravaActivity[];
  blockBundle?: StyleResult[] | null;
}) {
  const [showPoints, setShowPoints] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { layers, plan, planNote, serial } = result;
  const totalStitches = plan ? plan.blocks.reduce((s, b) => s + b.stitches.length, 0) : 0;
  const blockPlans = (blockBundle ?? []).filter((r) => r.plan);
  const downloadAll4 = async () => {
    for (const r of blockPlans) {
      if (!r.plan) continue;
      downloadPes(r.plan, `${r.serial}.pes`, PES_THREAD_COLOR);
      await new Promise((res) => setTimeout(res, 400));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-6 items-start flex-wrap">
        <div className="flex-1 min-w-[300px] max-w-[560px]">
          {output === "embroidery" && plan ? (
            <StitchPreview plan={plan} showPoints={showPoints} backdrop={result.underlay} />
          ) : (
            <div className="rounded-xl p-5" style={{ background: FABRIC }}>
              <svg viewBox="0 0 100 100" className="w-full h-auto">
                {layers.map((l, i) => (
                  <g key={i} style={{ color: l.color }}>
                    <GlyphNodes nodes={l.nodes} />
                  </g>
                ))}
              </svg>
            </div>
          )}
          {output === "embroidery" && planNote && (
            <p className="text-xs text-gray-400 mt-2">{planNote}</p>
          )}
        </div>

        <div className="space-y-2 text-sm w-[230px]">
          {output === "embroidery" ? (
            <>
              {plan && (
                <div className="text-xs text-gray-500 font-mono">
                  {totalStitches} stitches · {plan.blocks.length} blocks ·{" "}
                  {plan.blocks.filter((b) => b.stop).length} stops · ~
                  {Math.max(1, Math.round(totalStitches / 400))} min
                </div>
              )}
              <button
                onClick={() => plan && downloadPes(plan, `${serial}.pes`, PES_THREAD_COLOR)}
                disabled={!plan}
                className="block w-full text-left px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↓ .pes (Brother)
              </button>
              {blockPlans.length > 0 && (
                <button
                  onClick={() => downloadAll4().catch(console.error)}
                  className="block w-full text-left px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 font-medium"
                >
                  ↓ all {blockPlans.length} .pes
                </button>
              )}
              <button
                onClick={() => plan && downloadStitchPlan(plan, `${serial}.stitch.json`)}
                disabled={!plan}
                className="block w-full text-left px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                ↓ stitch plan JSON
              </button>
              {plan && (
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={showPoints}
                    onChange={(e) => setShowPoints(e.target.checked)}
                  />
                  needle points
                </label>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() =>
                  layers.length &&
                  downloadPdf(
                    layers.flatMap((l) => l.nodes),
                    `${serial}-dtf.pdf`,
                    { sizeIn: 20, color: PES_THREAD_COLOR }
                  )
                }
                disabled={layers.length === 0}
                className="block w-full text-left px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 font-medium disabled:opacity-40"
                title="single-color vector PDF, 20 inch page, transparent background"
              >
                ↓ PDF 20″ vector (DTF)
              </button>
              <button
                onClick={() => downloadLayeredPng(layers, `${serial}.png`).catch(console.error)}
                disabled={layers.length === 0}
                className="block w-full text-left px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                ↓ PNG 2048px
              </button>
              <button
                onClick={() => downloadLayeredSvg(layers, `${serial}.svg`)}
                disabled={layers.length === 0}
                className="block w-full text-left px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                ↓ SVG
              </button>
              <button
                onClick={() => setPanelOpen((v) => !v)}
                className="block w-full text-left px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
              >
                {panelOpen ? "▾" : "▸"} compose leg panel…
              </button>
            </>
          )}
        </div>
      </div>

      {output === "embroidery" && plan && (
        <div className="border border-gray-200 rounded-xl p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm items-end">
            <Slider
              label={`Patch ${stitchOpts.patchMm}mm`}
              min={30}
              max={75}
              step={5}
              value={stitchOpts.patchMm}
              onChange={(v) => onStitchOpts({ patchMm: v })}
            />
            <Slider
              label={`Route ${stitchOpts.routeStitchMm.toFixed(1)}mm`}
              min={1.5}
              max={4}
              step={0.1}
              value={stitchOpts.routeStitchMm}
              onChange={(v) => onStitchOpts({ routeStitchMm: v })}
            />
            <Slider
              label={`Text ${stitchOpts.textStitchMm.toFixed(1)}mm`}
              min={0.8}
              max={2}
              step={0.1}
              value={stitchOpts.textStitchMm}
              onChange={(v) => onStitchOpts({ textStitchMm: v })}
            />
            <Slider
              label={
                stitchOpts.lineWidthMm > 0
                  ? `Width ${stitchOpts.lineWidthMm.toFixed(1)}mm`
                  : "Width off (bean)"
              }
              min={0}
              max={3}
              step={0.1}
              value={stitchOpts.lineWidthMm}
              onChange={(v) => onStitchOpts({ lineWidthMm: v })}
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-500 pb-1">
              <input
                type="checkbox"
                checked={stitchOpts.trimStops}
                onChange={(e) => onStitchOpts({ trimStops: e.target.checked })}
              />
              trim stops
            </label>
          </div>
        </div>
      )}

      {output === "print" && panelOpen && (
        <div className="border border-gray-200 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">
            leg panel PDFs (print shop handoff)
          </div>
          <PanelBuilder runs={runs} />
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1 font-mono">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-orange-600"
      />
    </label>
  );
}
