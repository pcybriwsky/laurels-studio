// Minimal vector-PDF writer for glyph node trees — the DTF/print handoff
// format. True vector output (the badge is entirely flat polyline paths), on
// a physical-size page (default 20"x20"), artwork in the print color, no
// background — a PDF page is transparent unless drawn on. No dependencies.
import { GlyphNode } from "./types";

export interface PdfOpts {
  sizeIn?: number; // page width/height in inches (square, like the glyph)
  color?: string; // artwork color, hex
}

const PT_PER_IN = 72;

export function pdfBytes(nodes: GlyphNode[], opts: PdfOpts = {}): Uint8Array {
  const sizeIn = opts.sizeIn ?? 20;
  return panelPdfBytes(
    [{ nodes, xIn: 0, yIn: 0, sizeIn }],
    sizeIn,
    sizeIn,
    opts.color ?? "#ff6a00"
  );
}

// A page of multiple glyphs at physical positions — the leg-panel handoff.
// Each item is a 100x100-unit glyph node tree placed at (xIn, yIn) from the
// page's TOP-left, rendered sizeIn inches square.
export interface PanelItem {
  nodes: GlyphNode[];
  xIn: number;
  yIn: number;
  sizeIn: number;
}

export function panelPdfBytes(
  items: PanelItem[],
  pageWIn: number,
  pageHIn: number,
  color = "#ff6a00"
): Uint8Array {
  const pageW = pageWIn * PT_PER_IN;
  const pageH = pageHIn * PT_PER_IN;
  const [r, g, b] = hexRgb(color);

  const c: string[] = [];
  c.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
  c.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`);
  for (const item of items) {
    const s = (item.sizeIn * PT_PER_IN) / 100; // glyph units -> points
    const ox = item.xIn * PT_PER_IN;
    // y-flip: glyph space is y-down from page top, PDF is y-up from bottom
    const oy = pageH - item.yIn * PT_PER_IN;
    c.push("q");
    c.push(`${fmt(s)} 0 0 ${fmt(-s)} ${fmt(ox)} ${fmt(oy)} cm`);
    for (const n of item.nodes) emitNode(n, c);
    c.push("Q");
  }
  const content = c.join("\n");

  // --- assemble objects ---
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageW)} ${fmt(pageH)}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
}

function emitNode(n: GlyphNode, c: string[]) {
  switch (n.kind) {
    case "path": {
      const subs = parsePath(n.d);
      if (subs.length === 0) return;
      for (const sub of subs) {
        sub.pts.forEach((p, i) => c.push(`${fmt(p.x)} ${fmt(p.y)} ${i === 0 ? "m" : "l"}`));
        if (sub.closed) c.push("h");
      }
      if (n.fill) {
        c.push("f*"); // even-odd, matching the SVG renderer
      } else {
        c.push(`${fmt(n.stroke ?? 1.2)} w`);
        c.push(n.sharp ? "0 J 0 j" : "1 J 1 j");
        c.push("S");
      }
      return;
    }
    case "circle": {
      // 4-arc cubic approximation
      const k = 0.5523 * n.r;
      const { cx, cy, r } = n;
      c.push(`${fmt(cx + r)} ${fmt(cy)} m`);
      c.push(`${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`);
      c.push(`${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`);
      c.push(`${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`);
      c.push(`${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`);
      c.push("h");
      if (n.fill) c.push("f*");
      else {
        c.push(`${fmt(n.stroke ?? 1.2)} w`);
        c.push("1 J 1 j");
        c.push("S");
      }
      return;
    }
    default:
      // rect/line/text/group never occur in exported badge nodes today
      return;
  }
}

// Parse the pipeline's own path format: "M x y L x y ... Z" segments only.
function parsePath(d: string): { pts: { x: number; y: number }[]; closed: boolean }[] {
  const out: { pts: { x: number; y: number }[]; closed: boolean }[] = [];
  const tokens = d.match(/[MLZ]|-?\d*\.?\d+/gi) ?? [];
  let cur: { pts: { x: number; y: number }[]; closed: boolean } | null = null;
  let i = 0;
  let cmd = "";
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "M" || t === "L" || t === "Z" || t === "m" || t === "l" || t === "z") {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z" && cur) {
        cur.closed = true;
        out.push(cur);
        cur = null;
      }
      continue;
    }
    const x = parseFloat(tokens[i]);
    const y = parseFloat(tokens[i + 1]);
    i += 2;
    if (cmd === "M") {
      if (cur) out.push(cur);
      cur = { pts: [{ x, y }], closed: false };
      cmd = "L"; // implicit lineto after moveto
    } else if (cur) {
      cur.pts.push({ x, y });
    }
  }
  if (cur) out.push(cur);
  return out;
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
