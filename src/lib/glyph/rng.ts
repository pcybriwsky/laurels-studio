export type Rng = () => number;

// Mulberry32 — small deterministic PRNG so a given seed renders identically across sessions.
export function rng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over "runId:salt" — stable seed for a run's glyph; reroll bumps the salt.
export function hashSeed(runId: number, salt: number): number {
  const str = `${runId}:${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(rand: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function range(rand: Rng, min: number, max: number): number {
  return min + rand() * (max - min);
}

export function int(rand: Rng, min: number, max: number): number {
  return Math.floor(range(rand, min, max + 1));
}

export function chance(rand: Rng, p: number): boolean {
  return rand() < p;
}
