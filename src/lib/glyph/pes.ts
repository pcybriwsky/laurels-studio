// Truncated PES v1 writer — a faithful TypeScript port of pyembroidery's
// PesWriter.write_truncated_version_1 + PecWriter (validated byte-for-byte
// against pyembroidery output). Truncated v1 = "#PES0001" signature + PEC
// block; the PEC block is the part Brother machines actually stitch.
//
// Single-color, running/bean-stitch designs only — which is exactly what the
// glyph stitch plans contain.
import { StitchPlan } from "./stitchplan";

const JUMP_CODE = 0b00010000;
const TRIM_CODE = 0b00100000;

// Brother PEC 64-thread palette (index 1..64; 0 is reserved)
// prettier-ignore
const PEC_THREADS: [number, number, number][] = [
  [14, 31, 124], [10, 85, 163], [0, 135, 119], [75, 107, 175], [237, 23, 31],
  [209, 92, 0], [145, 54, 151], [228, 154, 203], [145, 95, 172], [158, 214, 125],
  [232, 169, 0], [254, 186, 53], [255, 255, 0], [112, 188, 31], [186, 152, 0],
  [168, 168, 168], [125, 111, 0], [255, 255, 179], [79, 85, 86], [0, 0, 0],
  [11, 61, 145], [119, 1, 118], [41, 49, 51], [42, 19, 1], [246, 74, 138],
  [178, 118, 36], [252, 187, 197], [254, 55, 15], [240, 240, 240], [106, 28, 138],
  [168, 221, 196], [37, 132, 187], [254, 179, 67], [255, 243, 107], [208, 166, 96],
  [209, 84, 0], [102, 186, 73], [19, 74, 70], [135, 135, 135], [216, 204, 198],
  [67, 86, 7], [253, 217, 222], [249, 147, 188], [0, 56, 34], [178, 175, 212],
  [104, 106, 176], [239, 227, 185], [247, 56, 102], [181, 75, 100], [19, 43, 26],
  [199, 1, 86], [254, 158, 50], [168, 222, 235], [0, 103, 62], [78, 41, 144],
  [47, 126, 32], [255, 204, 204], [255, 217, 17], [9, 91, 166], [240, 249, 112],
  [227, 243, 91], [255, 153, 0], [255, 240, 141], [255, 200, 200],
];

// compuphase.com/cmetric.htm — same metric pyembroidery uses
function colorDistanceRedMean(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number {
  const redMean = Math.round((r1 + r2) / 2);
  const r = r1 - r2;
  const g = g1 - g2;
  const b = b1 - b2;
  return (((512 + redMean) * r * r) >> 8) + 4 * g * g + (((767 - redMean) * b * b) >> 8);
}

// 1-based index into the PEC palette nearest to the given color
export function nearestPecIndex(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  let best = 1;
  let bestD = Infinity;
  PEC_THREADS.forEach(([tr, tg, tb], i) => {
    const d = colorDistanceRedMean(r, g, b, tr, tg, tb);
    if (d <= bestD) {
      bestD = d;
      best = i + 1;
    }
  });
  return best;
}

class Buf {
  bytes: number[] = [];
  u8(...v: number[]) {
    for (const b of v) this.bytes.push(b & 0xff);
  }
  u16le(v: number) {
    this.u8(v & 0xff, (v >> 8) & 0xff);
  }
  u24le(v: number) {
    this.u8(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
  }
  u32le(v: number) {
    this.u8(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  patchU24le(at: number, v: number) {
    this.bytes[at] = v & 0xff;
    this.bytes[at + 1] = (v >> 8) & 0xff;
    this.bytes[at + 2] = (v >> 16) & 0xff;
  }
}

type Cmd = { kind: "jump" | "stitch" | "color" | "end"; x: number; y: number };

// PEC delta value: short form 7-bit for -63..62, else 12-bit long form with flag
function writeValue(b: Buf, value: number, long: boolean, flag: number) {
  if (!long && value > -64 && value < 63) {
    b.u8(value & 0x7f);
  } else {
    let v = value & 0x0fff;
    v |= 0x8000;
    v |= flag << 8;
    b.u8((v >> 8) & 0xff, v & 0xff);
  }
}

function pecEncode(b: Buf, cmds: Cmd[]) {
  let init = true;
  let jumping = true;
  let colorTwo = true;
  let xx = 0;
  let yy = 0;
  for (const c of cmds) {
    const dx = Math.round(c.x - xx);
    const dy = Math.round(c.y - yy);
    xx += dx;
    yy += dy;
    if (c.kind === "stitch") {
      if (jumping) {
        if (dx !== 0 && dy !== 0) {
          writeValue(b, 0, false, 0);
          writeValue(b, 0, false, 0);
        }
        jumping = false;
      }
      writeValue(b, dx, false, 0);
      writeValue(b, dy, false, 0);
    } else if (c.kind === "jump") {
      jumping = true;
      const flag = init ? JUMP_CODE : TRIM_CODE;
      writeValue(b, dx, true, flag);
      writeValue(b, dy, true, flag);
    } else if (c.kind === "color") {
      if (jumping) {
        writeValue(b, 0, false, 0);
        writeValue(b, 0, false, 0);
        jumping = false;
      }
      b.u8(0xfe, 0xb0);
      b.u8(colorTwo ? 0x02 : 0x01);
      colorTwo = !colorTwo;
    } else {
      b.u8(0xff);
      break;
    }
    init = false;
  }
}

// 48x38 thumbnail frame template (PecGraphics.blank)
function pecBlank(): number[] {
  const g = new Array(228).fill(0);
  const row = (r: number, bytes: number[]) => bytes.forEach((v, i) => (g[r * 6 + i] = v));
  row(1, [0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f]);
  row(2, [0x08, 0x00, 0x00, 0x00, 0x00, 0x10]);
  row(3, [0x04, 0x00, 0x00, 0x00, 0x00, 0x20]);
  for (let r = 4; r <= 33; r++) row(r, [0x02, 0x00, 0x00, 0x00, 0x00, 0x40]);
  row(34, [0x04, 0x00, 0x00, 0x00, 0x00, 0x20]);
  row(35, [0x08, 0x00, 0x00, 0x00, 0x00, 0x10]);
  row(36, [0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f]);
  return g;
}

function markBit(g: number[], x: number, y: number) {
  // python-exact semantics: index by y*stride + trunc(x/8), python modulo
  let index = y * 6 + Math.trunc(x / 8);
  if (index < 0) {
    if (index < -g.length) return; // python IndexError -> skipped
    index += g.length;
  }
  if (index >= g.length) return;
  g[index] |= 1 << (((x % 8) + 8) % 8);
}

function drawScaled(
  extents: [number, number, number, number],
  points: { x: number; y: number }[],
  g: number[],
  buffer: number
) {
  const [left, top, right, bottom] = extents;
  const dw = right - left || 1;
  const dh = bottom - top || 1;
  const gw = 48;
  const gh = 38;
  const scale = Math.min((gw - buffer) / dw, (gh - buffer) / dh);
  const cx = (right + left) / 2;
  const cy = (bottom + top) / 2;
  const tx = -cx * scale + gw / 2;
  const ty = -cy * scale + gh / 2;
  for (const p of points) {
    markBit(g, Math.floor(p.x * scale + tx), Math.floor(p.y * scale + ty));
  }
}

// Build the PES bytes for a single-thread stitch plan (coordinates in mm).
// Blocks flagged `stop` get a same-color color-change before their jump — the
// machine pauses and auto-trims, then resumes on Start (the SE700 trims at
// color changes but not at within-color jumps).
export function pesBytes(plan: StitchPlan, colorHex = "#e8d4a0"): Uint8Array {
  // mm -> PES units (0.1mm)
  const blocks = plan.blocks
    .filter((b) => b.stitches.length > 0)
    .map((b) => ({
      stop: b.stop === true,
      pts: b.stitches.map(([x, y]) => ({ x: Math.round(x * 10), y: Math.round(y * 10) })),
    }));

  const cmds: Cmd[] = [];
  blocks.forEach(({ stop, pts }, i) => {
    if (i > 0 && stop) {
      const prev = cmds[cmds.length - 1];
      cmds.push({ kind: "color", x: prev.x, y: prev.y });
    }
    cmds.push({ kind: "jump", x: pts[0].x, y: pts[0].y });
    for (const p of pts) cmds.push({ kind: "stitch", x: p.x, y: p.y });
  });
  const last = cmds[cmds.length - 1] ?? { x: 0, y: 0 };
  cmds.push({ kind: "end", x: last.x, y: last.y });

  const xs = cmds.map((c) => c.x);
  const ys = cmds.map((c) => c.y);
  const extents: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];

  // Each stop starts a new "color block" (all the same physical thread). All
  // entries collapse to the same nearest palette index, matching
  // pyembroidery's build_unique_palette tie-breaking for identical threads.
  const numColorBlocks = 1 + blocks.filter((bl, i) => i > 0 && bl.stop).length;

  const b = new Buf();
  // --- truncated PES v1 wrapper ---
  b.ascii("#PES0001");
  b.u8(0x16, 0, 0, 0);
  b.u8(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  // --- PEC header ---
  const name = (plan.name ?? "Untitled").slice(0, 8);
  b.ascii(`LA:${name.padEnd(16, " ")}\r`);
  b.u8(...Array(12).fill(0x20));
  b.u8(0xff, 0x00);
  b.u8(48 / 8, 38); // icon byte stride, icon height
  const pecIndex = nearestPecIndex(colorHex);
  const colorIndexList = [numColorBlocks - 1, ...Array(numColorBlocks).fill(pecIndex)];
  b.u8(...Array(12).fill(0x20));
  b.u8(...colorIndexList);
  for (let i = numColorBlocks; i < 463; i++) b.u8(0x20);

  // --- PEC stitch block ---
  const blockStart = b.bytes.length;
  b.u8(0x00, 0x00);
  b.u24le(0); // length placeholder
  b.u8(0x31, 0xff, 0xf0);
  b.u16le(Math.round(extents[2] - extents[0]));
  b.u16le(Math.round(extents[3] - extents[1]));
  b.u16le(0x1e0);
  b.u16le(0x1b0);
  pecEncode(b, cmds);
  b.patchU24le(blockStart + 2, b.bytes.length - blockStart);

  // --- PEC graphics: one overall thumbnail + one per color block ---
  const overall = pecBlank();
  for (const { pts } of blocks) drawScaled(extents, pts, overall, 4);
  b.u8(...overall);
  // group plan blocks into color blocks (split at stops)
  const groups: { x: number; y: number }[][] = [[]];
  blocks.forEach(({ stop, pts }, i) => {
    if (i > 0 && stop) groups.push([]);
    groups[groups.length - 1].push(...pts);
  });
  for (const groupPts of groups) {
    const g = pecBlank();
    drawScaled(extents, groupPts, g, 5);
    b.u8(...g);
  }

  return new Uint8Array(b.bytes);
}

export function downloadPes(plan: StitchPlan, filename: string, colorHex?: string) {
  const bytes = pesBytes(plan, colorHex);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
