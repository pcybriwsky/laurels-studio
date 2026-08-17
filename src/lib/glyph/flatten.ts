// Flattens a projected GPS route into a single continuous stitch path that
// covers every street segment exactly once wherever possible — so out-and-back
// runs don't get stitched twice.
//
// How: resample the polyline at stitch-scale steps → cluster points to shared
// nodes within a ~1-unit radius (~0.9mm on a 90mm patch), which merges the out
// and back passes of the same street onto one centerline → build a graph of
// unique edges → make it Eulerian by duplicating the fewest connector segments
// (route inspection problem, greedy pairing of odd-degree nodes) → Hierholzer's
// algorithm walks every edge once in one unbroken line. `doubledEdges` counts
// the segments the walk was forced to repeat.

export interface XY {
  x: number;
  y: number;
}

export interface FlattenResult {
  walk: XY[];
  totalEdges: number;
  doubledEdges: number;
}

interface Edge {
  a: number;
  b: number;
  used: boolean;
}

export function flattenRoute(pts: XY[], step = 1.3, snap = 1.0): FlattenResult {
  if (pts.length < 2) return { walk: pts, totalEdges: 0, doubledEdges: 0 };
  const res = resample(pts, step);

  // Radius-based clustering via spatial hash (NOT plain grid-snapping, which
  // aliases at cell boundaries and fails to merge parallel passes). A node's
  // position is the running mean of the points that joined it, keeping the
  // drawn shape close to the real track.
  const sumX: number[] = [];
  const sumY: number[] = [];
  const cnt: number[] = [];
  const buckets = new Map<string, number[]>();
  const cellOf = (x: number, y: number) => `${Math.floor(x / snap)},${Math.floor(y / snap)}`;
  const meanOf = (ni: number): XY => ({ x: sumX[ni] / cnt[ni], y: sumY[ni] / cnt[ni] });

  const nodeFor = (p: XY): number => {
    const cx = Math.floor(p.x / snap);
    const cy = Math.floor(p.y / snap);
    let best = -1;
    let bestD = snap;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const ni of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          const m = meanOf(ni);
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = ni;
          }
        }
      }
    }
    if (best >= 0) {
      sumX[best] += p.x;
      sumY[best] += p.y;
      cnt[best]++;
      return best;
    }
    const ni = sumX.length;
    sumX.push(p.x);
    sumY.push(p.y);
    cnt.push(1);
    const k = cellOf(p.x, p.y);
    const b = buckets.get(k) ?? [];
    b.push(ni);
    buckets.set(k, b);
    return ni;
  };

  const seq: number[] = [];
  for (const p of res) {
    const id = nodeFor(p);
    if (seq[seq.length - 1] !== id) seq.push(id);
  }

  // Unique undirected edges from consecutive nodes
  const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeSet = new Set<string>();
  for (let i = 1; i < seq.length; i++) edgeSet.add(edgeKey(seq[i - 1], seq[i]));
  const edges: Edge[] = [...edgeSet].map((k) => {
    const [a, b] = k.split("|").map(Number);
    return { a, b, used: false };
  });
  const totalEdges = edges.length;
  if (totalEdges === 0) {
    return { walk: seq.length ? [meanOf(seq[0])] : [], totalEdges: 0, doubledEdges: 0 };
  }

  const adj = new Map<number, number[]>();
  const addAdj = (n: number, ei: number) => {
    const l = adj.get(n) ?? [];
    l.push(ei);
    adj.set(n, l);
  };
  edges.forEach((e, i) => {
    addAdj(e.a, i);
    addAdj(e.b, i);
  });

  // Eulerize: while more than 2 odd-degree nodes remain, duplicate the
  // shortest connecting path between the closest odd pair. The final <=2 odd
  // nodes become the walk's endpoints — no doubling needed for them.
  const degree = (n: number) => (adj.get(n) ?? []).length;
  const oddNodes = () => [...adj.keys()].filter((n) => degree(n) % 2 === 1);
  let odds = oddNodes();
  let doubledEdges = 0;
  while (odds.length > 2) {
    let best: { path: number[]; d: number } | null = null;
    for (const src of odds) {
      const { dist, prev } = bfs(src, adj, edges);
      for (const dst of odds) {
        if (dst === src) continue;
        const d = dist.get(dst);
        if (d !== undefined && (best === null || d < best.d)) {
          best = { path: reconstruct(src, dst, prev), d };
        }
      }
    }
    if (!best) break; // disconnected — cannot happen for a continuous track
    for (let i = 1; i < best.path.length; i++) {
      const ei = edges.length;
      edges.push({ a: best.path[i - 1], b: best.path[i], used: false });
      addAdj(best.path[i - 1], ei);
      addAdj(best.path[i], ei);
      doubledEdges++;
    }
    odds = oddNodes();
  }

  // Hierholzer's algorithm — start at an odd node (open walk) or, for a
  // circuit, at the node nearest the run's actual start
  const startNode =
    odds.length > 0 ? nearest(odds, res[0], meanOf) : nearest([...adj.keys()], res[0], meanOf);
  const stack: number[] = [startNode];
  const circuit: number[] = [];
  const iter = new Map<number, number>();
  while (stack.length > 0) {
    const v = stack[stack.length - 1];
    const list = adj.get(v) ?? [];
    let i = iter.get(v) ?? 0;
    while (i < list.length && edges[list[i]].used) i++;
    iter.set(v, i);
    if (i < list.length) {
      const e = edges[list[i]];
      e.used = true;
      stack.push(e.a === v ? e.b : e.a);
    } else {
      circuit.push(stack.pop()!);
    }
  }
  circuit.reverse();

  const walk = chaikin(circuit.map(meanOf));
  return { walk, totalEdges, doubledEdges };
}

export function resample(pts: XY[], step: number): XY[] {
  const out: XY[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      const next = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(next);
      a = next;
      seg = Math.hypot(b.x - a.x, b.y - a.y);
      carry = 0;
    }
    carry += seg;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function bfs(src: number, adj: Map<number, number[]>, edges: Edge[]) {
  const dist = new Map<number, number>([[src, 0]]);
  const prev = new Map<number, number>();
  const q: number[] = [src];
  for (let qi = 0; qi < q.length; qi++) {
    const v = q[qi];
    for (const ei of adj.get(v) ?? []) {
      const e = edges[ei];
      const u = e.a === v ? e.b : e.a;
      if (!dist.has(u)) {
        dist.set(u, dist.get(v)! + 1);
        prev.set(u, v);
        q.push(u);
      }
    }
  }
  return { dist, prev };
}

function reconstruct(from: number, to: number, prev: Map<number, number>): number[] {
  const path = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev.get(cur)!;
    path.push(cur);
  }
  return path.reverse();
}

function nearest(ids: number[], p: XY, meanOf: (ni: number) => XY): number {
  let best = ids[0];
  let bestD = Infinity;
  for (const id of ids) {
    const c = meanOf(id);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

// One corner-cutting pass — softens residual angularity by ~0.3 units, well
// below stitch resolution, without pulling doubled passes apart
function chaikin(pts: XY[]): XY[] {
  if (pts.length < 3) return pts;
  const out: XY[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
    out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}
