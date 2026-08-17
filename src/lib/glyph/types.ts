// Glyphs are generated as a plain node tree, not DOM/JSX, so one generator can
// feed both the live React preview and standalone SVG export (which later feeds
// Ink/Stitch → PES for the Brother embroidery machine).

// Single monospace stack shared by preview and export. v2: convert text to paths
// (opentype.js + bundled mono font) for vendor-proof SVGs and reliable stitching.
export const GLYPH_FONT = "ui-monospace, Menlo, Monaco, 'Courier New', monospace";

export type TextAnchor = "start" | "middle" | "end";

// All shapes are single-color: stroked with currentColor unless fill is set.
interface StyleProps {
  stroke?: number; // stroke width in viewBox units; default 1.2
  fill?: boolean; // filled solid instead of stroked
  dash?: string;
  opacity?: number;
  sharp?: boolean; // butt caps + miter joins — crisp corners (brackets)
}

export type GlyphNode =
  | ({ kind: "path"; d: string } & StyleProps)
  | ({ kind: "circle"; cx: number; cy: number; r: number } & StyleProps)
  | ({ kind: "rect"; x: number; y: number; w: number; h: number } & StyleProps)
  | ({ kind: "line"; x1: number; y1: number; x2: number; y2: number } & StyleProps)
  | { kind: "text"; x: number; y: number; text: string; size: number; anchor?: TextAnchor; opacity?: number }
  | { kind: "group"; transform?: string; opacity?: number; children: GlyphNode[] };

// An accepted glyph stores only the inputs to regeneration — the render is
// deterministic from (runId, salt), so it reproduces identically forever.
export interface GlyphRecord {
  runId: number;
  salt: number;
  acceptedAt: number;
  gridSlot: number; // index into the fixed shorts grid, assigned sequentially
}
