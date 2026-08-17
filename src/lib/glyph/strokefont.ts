// Minimal single-stroke (engraving-style) font for stitchable text: each char
// is open polylines that run as a plain running stitch — no satin, no fills.
// Grid: 4 wide x 8 tall, y-down, baseline at y=8. Only the chars the glyph
// needs: digits, '.', ':', 'M', 'I', space.
import type { GlyphText } from "./compose";

type Stroke = [number, number][];

const GLYPHS: Record<string, Stroke[]> = {
  // Squared OCR-style digits: long straight segments and 90° corners only, so
  // satin columns develop cleanly between corner anchors (short bevel
  // segments — the old octagonal forms — collapse the column into spikes).
  // Start/end at the baseline where possible so travel rails stay low.
  "0": [
    [
      [0, 8], [0, 0], [4, 0], [4, 8], [0, 8],
    ],
  ],
  "1": [
    [
      [0.8, 1.2], [2, 0], [2, 8],
    ],
  ],
  "2": [
    [
      [0, 0], [4, 0], [4, 4], [0, 4], [0, 8], [4, 8],
    ],
  ],
  "3": [
    [
      [0, 0], [4, 0], [4, 8], [0, 8],
    ],
    [
      [2, 4], [4, 4],
    ],
  ],
  "4": [
    [
      [3, 8], [3, 0], [0, 5], [4, 5],
    ],
  ],
  "5": [
    [
      [4, 0], [0, 0], [0, 4], [4, 4], [4, 8], [0, 8],
    ],
  ],
  "6": [
    [
      [4, 0], [0, 0], [0, 8], [4, 8], [4, 4], [0, 4],
    ],
  ],
  "7": [
    [
      [0, 0], [4, 0], [1.5, 8],
    ],
  ],
  "8": [
    [
      [0, 4], [0, 0], [4, 0], [4, 4], [0, 4], [0, 8], [4, 8], [4, 4],
    ],
  ],
  "9": [
    [
      [0, 8], [4, 8], [4, 0], [0, 0], [0, 4], [4, 4],
    ],
  ],
  ".": [
    [
      [2, 7], [2, 8],
    ],
  ],
  "·": [
    [
      [1.6, 4.5], [2.4, 4.5],
    ],
  ],
  ":": [
    [
      [2, 2], [2, 3],
    ],
    [
      [2, 5.5], [2, 6.5],
    ],
  ],
  M: [
    [
      [0, 8], [0, 0], [2, 4], [4, 0], [4, 8],
    ],
  ],
  I: [
    [
      [1, 0], [3, 0],
    ],
    [
      [2, 0], [2, 8],
    ],
    [
      [1, 8], [3, 8],
    ],
  ],
  " ": [],
};

// Convert a laid-out text element (glyph units, SVG-style anchor) into strokes
// in glyph units. Metrics chosen to visually match the SVG monospace render:
// cap height ~0.7em, advance 0.6em.
export function textStrokes(t: GlyphText): { x: number; y: number }[][] {
  const capH = 0.7 * t.size;
  const scale = capH / 8;
  const charW = 4 * scale;
  const advance = 0.6 * t.size;
  const n = t.text.length;
  const width = n > 0 ? (n - 1) * advance + charW : 0;
  const x0 = t.anchor === "end" ? t.x - width : t.anchor === "middle" ? t.x - width / 2 : t.x;

  const out: { x: number; y: number }[][] = [];
  for (let i = 0; i < n; i++) {
    const strokes = GLYPHS[t.text[i]] ?? [];
    const ox = x0 + i * advance;
    for (const stroke of strokes) {
      out.push(
        stroke.map(([gx, gy]) => ({
          x: ox + gx * scale,
          y: t.y - (8 - gy) * scale,
        }))
      );
    }
  }
  return out;
}
