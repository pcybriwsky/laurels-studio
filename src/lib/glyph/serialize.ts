import { GlyphNode, GLYPH_FONT } from "./types";

// Standalone SVG export. Colors are resolved to concrete values (no
// currentColor) and only presentation attributes are used, so the file renders
// identically in a browser tab, a canvas rasterizer, and Ink/Stitch.
export interface SerializeOpts {
  size?: number;
  color?: string;
}

export function glyphToSvgString(nodes: GlyphNode[], opts: SerializeOpts = {}): string {
  const size = opts.size ?? 2048;
  const color = opts.color ?? "#e8d4a0";
  const body = nodes.map((n) => nodeToString(n, color)).join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">\n` +
    `  ${body}\n` +
    `</svg>\n`
  );
}

// Multi-color designs (Custom tab): each layer is a node tree in its own
// resolved color — cream structure, orange payload.
export interface GlyphLayer {
  color: string;
  nodes: GlyphNode[];
}

export function glyphLayersToSvgString(layers: GlyphLayer[], opts: { size?: number } = {}): string {
  const size = opts.size ?? 2048;
  const body = layers
    .map((l) => l.nodes.map((n) => nodeToString(n, l.color)).join("\n  "))
    .join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">\n` +
    `  ${body}\n` +
    `</svg>\n`
  );
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styleAttrs(
  n: { stroke?: number; fill?: boolean; dash?: string; opacity?: number; sharp?: boolean },
  color: string
): string {
  const opacity = n.opacity !== undefined ? ` opacity="${fmt(n.opacity)}"` : "";
  if (n.fill) return `fill="${color}" fill-rule="evenodd"${opacity}`;
  const dash = n.dash ? ` stroke-dasharray="${n.dash}"` : "";
  const cap = n.sharp ? "butt" : "round";
  const join = n.sharp ? "miter" : "round";
  return (
    `fill="none" stroke="${color}" stroke-width="${fmt(n.stroke ?? 1.2)}" ` +
    `stroke-linecap="${cap}" stroke-linejoin="${join}"${dash}${opacity}`
  );
}

function nodeToString(n: GlyphNode, color: string): string {
  switch (n.kind) {
    case "path":
      return `<path d="${n.d}" ${styleAttrs(n, color)}/>`;
    case "circle":
      return `<circle cx="${fmt(n.cx)}" cy="${fmt(n.cy)}" r="${fmt(n.r)}" ${styleAttrs(n, color)}/>`;
    case "rect":
      return `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.w)}" height="${fmt(n.h)}" ${styleAttrs(n, color)}/>`;
    case "line":
      return (
        `<line x1="${fmt(n.x1)}" y1="${fmt(n.y1)}" x2="${fmt(n.x2)}" y2="${fmt(n.y2)}" ` +
        `stroke="${color}" stroke-width="${fmt(n.stroke ?? 1.2)}" stroke-linecap="round"` +
        `${n.dash ? ` stroke-dasharray="${n.dash}"` : ""}${n.opacity !== undefined ? ` opacity="${fmt(n.opacity)}"` : ""}/>`
      );
    case "text": {
      const anchor = n.anchor ? ` text-anchor="${n.anchor}"` : "";
      const opacity = n.opacity !== undefined ? ` opacity="${fmt(n.opacity)}"` : "";
      return (
        `<text x="${fmt(n.x)}" y="${fmt(n.y)}" font-family="${GLYPH_FONT}" ` +
        `font-size="${fmt(n.size)}" fill="${color}"${anchor}${opacity}>${esc(n.text)}</text>`
      );
    }
    case "group": {
      const transform = n.transform ? ` transform="${n.transform}"` : "";
      const opacity = n.opacity !== undefined ? ` opacity="${fmt(n.opacity)}"` : "";
      const children = n.children.map((c) => nodeToString(c, color)).join("");
      return `<g${transform}${opacity}>${children}</g>`;
    }
  }
}
