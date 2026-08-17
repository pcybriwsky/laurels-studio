import { GlyphNode } from "./types";
import { glyphToSvgString, glyphLayersToSvgString, GlyphLayer, SerializeOpts } from "./serialize";
import { pdfBytes, panelPdfBytes, PanelItem, PdfOpts } from "./pdf";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The SVG is the future embroidery input (Ink/Stitch → PES for the Brother
// machine); keep it standalone and clean.
export function downloadSvg(nodes: GlyphNode[], filename: string, opts?: SerializeOpts) {
  const svg = glyphToSvgString(nodes, opts);
  triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

// Rasterize via <img> + canvas. The SVG loads as an image, so it cannot fetch
// webfonts — text renders in the local system monospace, which the PNG then
// bakes in, making it fully portable for IG/video overlays.
export async function downloadPng(nodes: GlyphNode[], filename: string, opts: SerializeOpts = {}) {
  const blob = await rasterizePng(nodes, opts);
  triggerDownload(blob, filename);
}

// True vector PDF on a physical-size page — the print shop handoff. No
// background (PDF pages are transparent unless drawn on), artwork in the
// print color, resolution-independent.
export function downloadPdf(nodes: GlyphNode[], filename: string, opts: PdfOpts = {}) {
  const bytes = pdfBytes(nodes, opts);
  triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
}

// Leg-panel PDF: multiple glyphs at physical positions on a panel-size page.
export function downloadPanelPdf(
  items: PanelItem[],
  pageWIn: number,
  pageHIn: number,
  filename: string,
  color?: string
) {
  const bytes = panelPdfBytes(items, pageWIn, pageHIn, color);
  triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
}

// Print/DTF export: rasterize at print resolution and stamp the PNG with a
// pHYs chunk so Photoshop/RIPs read the physical size (e.g. 6000px @ 300dpi
// = 20"). Transparent background, RGB — exactly what the print shop asked for.
export async function downloadPngDpi(
  nodes: GlyphNode[],
  filename: string,
  opts: SerializeOpts & { dpi?: number } = {}
) {
  const dpi = opts.dpi ?? 300;
  const blob = await rasterizePng(nodes, opts);
  const stamped = withPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  triggerDownload(new Blob([stamped as BlobPart], { type: "image/png" }), filename);
}

// Multi-color (layered) exports for the Custom tab designs
export function downloadLayeredSvg(layers: GlyphLayer[], filename: string, size = 2048) {
  const svg = glyphLayersToSvgString(layers, { size });
  triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function downloadLayeredPng(layers: GlyphLayer[], filename: string, size = 2048) {
  const svg = glyphLayersToSvgString(layers, { size });
  const blob = await rasterizeSvg(svg, size);
  triggerDownload(blob, filename);
}

async function rasterizePng(nodes: GlyphNode[], opts: SerializeOpts = {}): Promise<Blob> {
  const size = opts.size ?? 2048;
  const svg = glyphToSvgString(nodes, { ...opts, size });
  return rasterizeSvg(svg, size);
}

async function rasterizeSvg(svg: string, size: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterization failed"));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    ctx.drawImage(img, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("PNG encode failed");
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// Insert a pHYs chunk (pixels-per-meter, unit=meter) before the first IDAT.
// Canvas-encoded PNGs carry no density; print tools then assume 72dpi.
// Exported for tests — pure bytes in, bytes out.
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4); // len + type + data + crc
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: meter
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // scan chunks from after the 8-byte signature to find the first IDAT
  let off = 8;
  while (off < png.length) {
    const len = new DataView(png.buffer, png.byteOffset + off).getUint32(0);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === "IDAT") break;
    if (type === "pHYs") {
      // replace existing density in place
      const out = png.slice();
      out.set(chunk.subarray(8, 17), off + 8);
      const dvOut = new DataView(out.buffer, out.byteOffset);
      dvOut.setUint32(off + 17, crc32(out.subarray(off + 4, off + 17)));
      return out;
    }
    off += 12 + len;
  }
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, off), 0);
  out.set(chunk, off);
  out.set(png.subarray(off), off + chunk.length);
  return out;
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
