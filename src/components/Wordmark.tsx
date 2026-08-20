/**
 * Studio lockup — record voice throughout.
 *
 * The studio is the workshop, not a brand surface, so it keeps the mono
 * wordmark WITH corners: record mark plus record voice. The public site uses
 * the ceremonial lockup instead (serif caps, no corners, laurel above). The
 * two surfaces differ on purpose.
 */

/**
 * Two rectangles joined at the corner — never a bent path, because bent satin
 * ribbons sew unevenly. Settled proportion: 13% thickness, 58% arms, which
 * reads as a viewfinder rather than a frame and stitches to 3.3mm on a 25mm
 * tag. Sized in em so it scales with whatever text it sits beside.
 */
const THICK = 0.13;
const ARM = 0.58;
const BOX = 100; // viewBox units; em sizing happens on the element

export function Corner({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const w = BOX * THICK;
  const arm = BOX * ARM;
  const top = corner === "tl" || corner === "tr";
  const left = corner === "tl" || corner === "bl";
  const rects: [number, number, number, number][] = [
    [left ? 0 : BOX - arm, top ? 0 : BOX - w, arm, w],
    [left ? 0 : BOX - w, top ? 0 : BOX - arm, w, arm],
  ];
  // Crop the viewBox to the ink itself. The L only occupies `arm` of the box,
  // so a full-box viewBox would anchor empty space and float the corner off
  // the text. Cropped, vertical-align:baseline lands the ink on the baseline
  // and the far arm on the cap line — the corners frame the word's real bounds.
  const vx = left ? 0 : BOX - arm;
  const vy = top ? 0 : BOX - arm;
  return (
    <svg
      viewBox={`${vx} ${vy} ${arm} ${arm}`}
      aria-hidden
      className="shrink-0"
      style={{ width: "0.7em", height: "0.7em", verticalAlign: "baseline" }}
    >
      {rects.map(([x, y, rw, rh], i) => (
        <rect key={i} x={x} y={y} width={rw} height={rh} fill="currentColor" />
      ))}
    </svg>
  );
}

export function Wordmark({
  label = "Laurels",
  tracking = "0.3em",
  gap = "0.55em",
  className = "",
}: {
  label?: string;
  tracking?: string;
  gap?: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        letterSpacing: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Corner corner="tl" />
      <span
        style={{
          letterSpacing: tracking,
          // letter-spacing trails the final character too; cancel it so the
          // closing corner isn't pushed further out than the opening one.
          marginRight: `calc(-1 * ${tracking})`,
          paddingLeft: gap,
          paddingRight: gap,
        }}
      >
        {label}
      </span>
      <Corner corner="br" />
    </span>
  );
}
