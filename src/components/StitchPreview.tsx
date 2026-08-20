import { useEffect, useMemo, useRef, useState } from "react";
import { StitchPlan } from "@/lib/glyph/stitchplan";
import type { GlyphLayer } from "@/lib/glyph/serialize";
import { GlyphNodes } from "@/components/GlyphSvg";

const THREAD = "#e8d4a0";
const JUMP_COLOR = "#f87171";
const STITCH_OUT_MS = 8000;

// Needle-level preview of a stitch plan: every polyline vertex is a real
// needle penetration, dashed red lines are the jumps the machine makes
// between blocks (threads you trim afterwards).
//
// "Stitch out" replays the plan in true machine order over 8 seconds —
// blocks appear as they sew, jumps and trim stops pop in when reached, and
// a needle dot leads the thread.
export function StitchPreview({
  plan,
  showPoints,
  backdrop,
}: {
  plan: StitchPlan;
  showPoints: boolean;
  // design-only layers (underlay/captions) shown behind the stitches so the
  // machine preview reads as the finished composite; drawn in glyph units,
  // scaled to the patch
  backdrop?: GlyphLayer[];
}) {
  const patch = plan.patchMm;

  // animation progress: null = idle (everything shown), 0..1 = stitching
  const [progress, setProgress] = useState<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // plan changed under us (slider moved, run switched) — stop cleanly
    cancelAnimationFrame(rafRef.current);
    setProgress(null);
  }, [plan]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const play = () => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = (t - t0) / STITCH_OUT_MS;
      if (p >= 1) {
        setProgress(null); // done — fall back to the complete render
      } else {
        setProgress(p);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // cumulative stitch counts, machine order — the animation timeline
  const { starts, total } = useMemo(() => {
    const starts: number[] = [];
    let n = 0;
    for (const b of plan.blocks) {
      starts.push(n);
      n += b.stitches.length;
    }
    return { starts, total: n };
  }, [plan]);

  const visible = progress === null ? total : Math.floor(progress * total);

  // needle position: the last visible stitch
  const needle = useMemo(() => {
    if (progress === null || visible === 0) return null;
    const k = visible - 1;
    for (let i = plan.blocks.length - 1; i >= 0; i--) {
      if (k >= starts[i]) {
        const s = plan.blocks[i].stitches[Math.min(k - starts[i], plan.blocks[i].stitches.length - 1)];
        return s ? { x: s[0], y: s[1] } : null;
      }
    }
    return null;
  }, [progress, visible, plan, starts]);

  const jumps = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 1; i < plan.blocks.length; i++) {
      const prev = plan.blocks[i - 1].stitches;
      const next = plan.blocks[i].stitches;
      if (prev.length === 0 || next.length === 0) continue;
      const [x1, y1] = prev[prev.length - 1];
      const [x2, y2] = next[0];
      out.push({ x1, y1, x2, y2 });
    }
    return out;
  }, [plan]);

  const grid = useMemo(() => {
    const lines: number[] = [];
    for (let v = 10; v < patch; v += 10) lines.push(v);
    return lines;
  }, [patch]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={play}
          className="px-3 py-1 text-sm border rounded hover:bg-gray-50 font-medium"
          title="Replay the machine's stitch order over 8 seconds"
        >
          {progress === null ? "▶ stitch out" : "↺ restart"}
        </button>
        {progress !== null && (
          <span className="text-xs font-mono text-gray-500">
            {visible} / {total} stitches
          </span>
        )}
      </div>
      <svg
        viewBox={`-2 -2 ${patch + 4} ${patch + 4}`}
        className="w-full h-auto rounded"
        style={{ background: "#111111", maxWidth: 520 }}
      >
        {/* 10mm grid */}
        {grid.map((v) => (
          <g key={v} stroke="#ffffff" strokeWidth={0.08} opacity={0.15}>
            <line x1={v} y1={0} x2={v} y2={patch} />
            <line x1={0} y1={v} x2={patch} y2={v} />
          </g>
        ))}
        <rect
          x={0}
          y={0}
          width={patch}
          height={patch}
          fill="none"
          stroke="#ffffff"
          strokeWidth={0.15}
          opacity={0.3}
          strokeDasharray="1 1"
        />

        {/* design-only backdrop (underlay + captions), behind everything */}
      {backdrop?.map((l, i) => (
        <g key={`bd-${i}`} style={{ color: l.color }} opacity={0.85} transform={`scale(${patch / 100})`}>
          <GlyphNodes nodes={l.nodes} />
        </g>
      ))}

      {/* jumps between blocks — appear once the destination block starts */}
        {jumps.map((j, i) =>
          visible > starts[i + 1] ? (
            <line
              key={i}
              x1={j.x1}
              y1={j.y1}
              x2={j.x2}
              y2={j.y2}
              stroke={JUMP_COLOR}
              strokeWidth={0.25}
              strokeDasharray="1.2 0.8"
              opacity={0.7}
            />
          ) : null
        )}

        {/* auto-trim stops: machine pauses + cuts before this block */}
        {plan.blocks.map((b, i) =>
          b.stop && b.stitches.length > 0 && visible > starts[i] ? (
            <g key={`stop-${i}`}>
              <circle
                cx={b.stitches[0][0]}
                cy={b.stitches[0][1]}
                r={1.1}
                fill="none"
                stroke={JUMP_COLOR}
                strokeWidth={0.3}
              />
              <circle cx={b.stitches[0][0]} cy={b.stitches[0][1]} r={0.35} fill={JUMP_COLOR} />
            </g>
          ) : null
        )}

        {/* stitch paths, revealed in machine order */}
        {plan.blocks.map((b, i) => {
          const shown = Math.max(0, Math.min(b.stitches.length, visible - starts[i]));
          if (shown < 2) return null;
          const pts = shown === b.stitches.length ? b.stitches : b.stitches.slice(0, shown);
          return (
            <g key={i}>
              <path
                d={pts.map(([x, y], j) => `${j === 0 ? "M" : "L"} ${x} ${y}`).join(" ")}
                fill="none"
                stroke={THREAD}
                strokeWidth={0.28}
                strokeLinecap="round"
                strokeLinejoin="miter"
              />
              {showPoints &&
                pts.map(([x, y], j) => <circle key={j} cx={x} cy={y} r={0.2} fill={THREAD} />)}
            </g>
          );
        })}

        {/* the needle */}
        {needle && (
          <g>
            <circle cx={needle.x} cy={needle.y} r={1.4} fill="none" stroke="#ffffff" strokeWidth={0.25} opacity={0.9} />
            <circle cx={needle.x} cy={needle.y} r={0.45} fill="#ffffff" />
          </g>
        )}
      </svg>
    </div>
  );
}
