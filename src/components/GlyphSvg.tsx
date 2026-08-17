import { GlyphNode, GLYPH_FONT } from "@/lib/glyph/types";

// Live-preview renderer for glyph node trees. Color flows via currentColor so
// one prop recolors the whole glyph; export uses serialize.ts instead.
export function GlyphSvg({
  nodes,
  size,
  color = "#e8d4a0",
  className,
}: {
  nodes: GlyphNode[];
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ color }}
    >
      <GlyphNodes nodes={nodes} />
    </svg>
  );
}

// Fragment form for embedding a glyph inside another SVG (e.g. the shorts grid).
export function GlyphNodes({ nodes }: { nodes: GlyphNode[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Node key={i} n={n} />
      ))}
    </>
  );
}

function shapeProps(n: {
  stroke?: number;
  fill?: boolean;
  dash?: string;
  opacity?: number;
  sharp?: boolean;
}) {
  return n.fill
    ? { fill: "currentColor" as const, fillRule: "evenodd" as const, opacity: n.opacity }
    : {
        fill: "none" as const,
        stroke: "currentColor" as const,
        strokeWidth: n.stroke ?? 1.2,
        strokeLinecap: n.sharp ? ("butt" as const) : ("round" as const),
        strokeLinejoin: n.sharp ? ("miter" as const) : ("round" as const),
        strokeDasharray: n.dash,
        opacity: n.opacity,
      };
}

function Node({ n }: { n: GlyphNode }) {
  switch (n.kind) {
    case "path":
      return <path d={n.d} {...shapeProps(n)} />;
    case "circle":
      return <circle cx={n.cx} cy={n.cy} r={n.r} {...shapeProps(n)} />;
    case "rect":
      return <rect x={n.x} y={n.y} width={n.w} height={n.h} {...shapeProps(n)} />;
    case "line":
      return (
        <line
          x1={n.x1}
          y1={n.y1}
          x2={n.x2}
          y2={n.y2}
          stroke="currentColor"
          strokeWidth={n.stroke ?? 1.2}
          strokeLinecap="round"
          strokeDasharray={n.dash}
          opacity={n.opacity}
        />
      );
    case "text":
      return (
        <text
          x={n.x}
          y={n.y}
          fontSize={n.size}
          fontFamily={GLYPH_FONT}
          fill="currentColor"
          textAnchor={n.anchor}
          opacity={n.opacity}
        >
          {n.text}
        </text>
      );
    case "group":
      return (
        <g transform={n.transform} opacity={n.opacity}>
          <GlyphNodes nodes={n.children} />
        </g>
      );
  }
}
