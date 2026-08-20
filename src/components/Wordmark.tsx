/**
 * The bracket lockup, drawn rather than typed.
 *
 * Previously Unicode glyphs (U+2310 / U+2319) whose size and baseline were
 * decided by whatever font resolved them — they could never match.
 *
 * Two straight strokes per corner, never a bent path: the same law the
 * stitched badge follows, since bent satin ribbons sew unevenly.
 *
 * Alignment: the box is exactly cap-height tall and sits on the baseline
 * (vertical-align: baseline puts an inline SVG's bottom edge there). So the
 * opening bracket's arm lands on the cap line and the closing bracket's arm
 * lands on the baseline — the two corners frame the word's actual bounds
 * instead of floating around its line box.
 */
const CAP = "0.7em"; // IBM Plex Mono cap height ≈ 0.698em

export function Bracket({ corner }: { corner: "tl" | "br" }) {
  const tl = corner === "tl";
  // Inset keeps the stroke fully inside the box so the corner sits exactly on
  // the cap line / baseline rather than half a stroke past it.
  const x = tl ? 0.6 : 9.4;
  const y = tl ? 0.6 : 9.4;
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      style={{
        width: CAP,
        height: CAP,
        verticalAlign: "baseline",
        overflow: "visible",
      }}
    >
      <line
        x1={x}
        y1={y}
        x2={tl ? 7.4 : 2.6}
        y2={y}
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={tl ? 6.2 : 3.8}
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function Wordmark({
  label = "Laurels",
  tracking = "0.42em",
  gap = "0.5em",
  className = "",
}: {
  label?: string;
  tracking?: string;
  gap?: string;
  className?: string;
}) {
  return (
    <span className={className} style={{ letterSpacing: 0, whiteSpace: "nowrap" }}>
      <Bracket corner="tl" />
      <span
        style={{
          letterSpacing: tracking,
          // Letter-spacing also applies after the final character, which pushes
          // the closing bracket further out than the opening one. Cancel it.
          marginRight: `calc(-1 * ${tracking})`,
          paddingLeft: gap,
          paddingRight: gap,
        }}
      >
        {label}
      </span>
      <Bracket corner="br" />
    </span>
  );
}
