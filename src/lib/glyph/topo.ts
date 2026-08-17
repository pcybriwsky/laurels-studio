// Topographic contour underlay — elevation from the AWS Open Data Terrarium
// tiles (no API key), contours via marching squares, returned as lat/lng
// polylines so they project through the SAME transform as the route and the
// street underlay. Cream structure, like everything underneath.
//
// Terrarium encoding: elevation_m = (R * 256 + G + B / 256) - 32768
// Tiles: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
import { RoutePoint } from "@/lib/strava";

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const TILE = 256;
const SAMPLES = 110; // elevation grid resolution across the padded bbox

export interface TilePixels {
  data: Uint8Array | Uint8ClampedArray; // RGB(A) rows
  channels: number; // 3 or 4
}
export type TileFetcher = (z: number, x: number, y: number) => Promise<TilePixels>;

// ---------- web mercator ----------

const lngToX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const xToLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const yToLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// ---------- main ----------

// Elevation grid, fetched once per run and cached by the caller — contour
// extraction is a pure recompute so a detail slider stays instant.
export interface ElevGrid {
  values: Float32Array;
  size: number;
  min: number;
  max: number;
  toLatLng: (fi: number, fj: number) => RoutePoint;
}

export async function fetchTopoContours(
  route: RoutePoint[],
  fetchTile: TileFetcher,
  levelCount = 7
): Promise<RoutePoint[][]> {
  const grid = await fetchElevationGrid(route, fetchTile);
  return grid ? contoursFromGrid(grid, levelCount) : [];
}

export async function fetchElevationGrid(
  route: RoutePoint[],
  fetchTile: TileFetcher
): Promise<ElevGrid | null> {
  if (route.length < 2) return null;
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const padLat = (Math.max(...lats) - Math.min(...lats)) * 0.35 + 0.002;
  const padLng = (Math.max(...lngs) - Math.min(...lngs)) * 0.35 + 0.002;
  const s = Math.min(...lats) - padLat;
  const n = Math.max(...lats) + padLat;
  const w = Math.min(...lngs) - padLng;
  const e = Math.max(...lngs) + padLng;

  // zoom: bbox ≈ 1-2 tiles per axis, capped at 12 (≈30m data floor)
  const span = Math.max(e - w, (n - s) * 1.4);
  const z = Math.max(8, Math.min(12, Math.floor(Math.log2(360 / Math.max(span, 1e-4)))));

  // sample an elevation grid over the bbox (mercator-linear like the tiles)
  const x0 = lngToX(w, z);
  const x1 = lngToX(e, z);
  const y0 = latToY(n, z); // top
  const y1 = latToY(s, z); // bottom
  const cache = new Map<string, TilePixels>();
  const getTile = async (tx: number, ty: number) => {
    const k = `${tx},${ty}`;
    let t = cache.get(k);
    if (!t) {
      t = await fetchTile(z, tx, ty);
      cache.set(k, t);
    }
    return t;
  };

  const grid = new Float32Array(SAMPLES * SAMPLES);
  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) {
      const mx = x0 + ((x1 - x0) * i) / (SAMPLES - 1);
      const my = y0 + ((y1 - y0) * j) / (SAMPLES - 1);
      const tx = Math.floor(mx);
      const ty = Math.floor(my);
      const px = Math.min(TILE - 1, Math.floor((mx - tx) * TILE));
      const py = Math.min(TILE - 1, Math.floor((my - ty) * TILE));
      const tile = await getTile(tx, ty);
      const o = (py * TILE + px) * tile.channels;
      const r = tile.data[o];
      const g = tile.data[o + 1];
      const b = tile.data[o + 2];
      grid[j * SAMPLES + i] = r * 256 + g + b / 256 - 32768;
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of grid) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const toLatLng = (fi: number, fj: number): RoutePoint => ({
    lat: yToLat(y0 + ((y1 - y0) * fj) / (SAMPLES - 1), z),
    lng: xToLng(x0 + ((x1 - x0) * fi) / (SAMPLES - 1), z),
  });
  return { values: grid, size: SAMPLES, min, max, toLatLng };
}

// Pure contour extraction — recomputed live as the detail slider moves.
// levelCount ≈ how many contour lines cross the relief; steps snap to nice
// round intervals. Short chains (speckle noise) are dropped.
export function contoursFromGrid(g: ElevGrid, levelCount: number): RoutePoint[][] {
  const relief = g.max - g.min;
  if (relief < 4) return []; // pancake-flat — no meaningful contours
  const NICE = [2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  const rawStep = relief / Math.max(2, levelCount);
  const step = NICE.find((v) => v >= rawStep) ?? 2000;
  const levels: number[] = [];
  for (let v = Math.ceil(g.min / step) * step; v < g.max; v += step) levels.push(v);

  const out: RoutePoint[][] = [];
  for (const level of levels) {
    const segs = marchingSquares(g.values, g.size, g.size, level);
    for (const chain of chainSegments(segs)) {
      // minimum chain length kills the confetti fragments
      if (chain.length >= 6) out.push(chain.map(([fi, fj]) => g.toLatLng(fi, fj)));
    }
  }
  return out;
}

// browser tile fetcher: <img> + canvas pixel read (bucket serves CORS)
export function browserTileFetcher(): TileFetcher {
  return async (z, x, y) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`tile ${z}/${x}/${y} failed`));
      img.src = TILE_URL(z, x, y);
    });
    const canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, TILE, TILE).data, channels: 4 };
  };
}

// ---------- marching squares ----------

type Pt = [number, number]; // fractional grid coords
type Seg = [Pt, Pt];

function marchingSquares(grid: Float32Array, w: number, h: number, level: number): Seg[] {
  const segs: Seg[] = [];
  const v = (i: number, j: number) => grid[j * w + i];
  // edge interpolators: fraction along the edge where the level crosses
  const lerp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const tl = v(i, j);
      const tr = v(i + 1, j);
      const br = v(i + 1, j + 1);
      const bl = v(i, j + 1);
      let idx = 0;
      if (tl >= level) idx |= 8;
      if (tr >= level) idx |= 4;
      if (br >= level) idx |= 2;
      if (bl >= level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const top: Pt = [i + lerp(tl, tr), j];
      const right: Pt = [i + 1, j + lerp(tr, br)];
      const bottom: Pt = [i + lerp(bl, br), j + 1];
      const left: Pt = [i, j + lerp(tl, bl)];
      const add = (a: Pt, b: Pt) => segs.push([a, b]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 5: add(top, left); add(bottom, right); break; // saddle
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(top, left); break;
        case 10: add(top, right); add(left, bottom); break; // saddle
      }
    }
  }
  return segs;
}

// join segments end-to-end into polylines (greedy endpoint matching)
function chainSegments(segs: Seg[]): Pt[][] {
  const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const byStart = new Map<string, Seg[]>();
  for (const s of segs) {
    const k = key(s[0]);
    const arr = byStart.get(k) ?? [];
    arr.push(s);
    byStart.set(k, arr);
  }
  const used = new Set<Seg>();
  const chains: Pt[][] = [];
  for (const s of segs) {
    if (used.has(s)) continue;
    used.add(s);
    const chain: Pt[] = [s[0], s[1]];
    // extend forward
    for (;;) {
      const candidates = byStart.get(key(chain[chain.length - 1])) ?? [];
      const next = candidates.find((c) => !used.has(c));
      if (!next) break;
      used.add(next);
      chain.push(next[1]);
    }
    chains.push(chain);
  }
  return chains;
}
