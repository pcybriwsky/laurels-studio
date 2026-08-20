/**
 * The bracket lockup, drawn rather than typed.
 *
 * These were Unicode glyphs (U+2310 / U+2319) — unrelated codepoints whose
 * size, weight and baseline are decided by whatever font resolves them, so
 * they never matched each other and rendered differently per platform.
 *
 * Drawn as two straight strokes per corner, never a bent path — the same law
 * the stitched badge follows, since bent satin ribbons sew unevenly.
 * Sized in em so the mark scales with whatever text it sits beside.
 */
export function Bracket({ corner }: { corner: "tl" | "br" }) {
  const tl = corner === "tl";
  return (
    <svg
      viewBox="0 0 12 14"
      aria-hidden
      className="shrink-0"
      style={{ width: "0.72em", height: "0.84em" }}
    >
      <line
        x1={tl ? 1 : 11}
        y1={tl ? 1 : 13}
        x2={tl ? 11 : 1}
        y2={tl ? 1 : 13}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <line
        x1={tl ? 1 : 11}
        y1={tl ? 1 : 13}
        x2={tl ? 1 : 11}
        y2={tl ? 9 : 5}
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function Wordmark({
  label = "Laurels",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-[0.7em] ${className}`}>
      <Bracket corner="tl" />
      {label}
      <Bracket corner="br" />
    </span>
  );
}
