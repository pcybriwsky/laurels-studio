import type { StravaActivity } from "./strava";
import type { GlyphRecord } from "./glyph/types";

const DB_NAME = "apparel-brand";
const DB_VERSION = 3;
const RUNS_STORE = "runs";
const META_STORE = "meta";
const GLYPHS_STORE = "glyphs";
const LOCS_STORE = "locs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        db.createObjectStore(RUNS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      // v2: one accepted glyph per run (keyPath enforces the cadence)
      if (!db.objectStoreNames.contains(GLYPHS_STORE)) {
        db.createObjectStore(GLYPHS_STORE, { keyPath: "runId" });
      }
      // v3: per-run place labels ("NYC") — an input to glyph regeneration,
      // so like glyphs they mirror the physical short
      if (!db.objectStoreNames.contains(LOCS_STORE)) {
        db.createObjectStore(LOCS_STORE, { keyPath: "runId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function saveRuns(runs: StravaActivity[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([RUNS_STORE, META_STORE], "readwrite");
    const runsStore = t.objectStore(RUNS_STORE);
    runsStore.clear();
    for (const r of runs) runsStore.put(r);
    t.objectStore(META_STORE).put(Date.now(), "lastSync");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadRuns(): Promise<StravaActivity[]> {
  return tx<StravaActivity[]>(RUNS_STORE, "readonly", (s) => s.getAll());
}

export async function clearRuns(): Promise<void> {
  await tx(RUNS_STORE, "readwrite", (s) => s.clear());
  await tx(META_STORE, "readwrite", (s) => s.clear());
}

export async function getLastSync(): Promise<number | undefined> {
  return tx<number | undefined>(META_STORE, "readonly", (s) => s.get("lastSync"));
}

// Glyphs mirror the physical short (already-stitched history), so they are
// intentionally NOT cleared by clearRuns()/disconnect.
export async function saveGlyph(g: GlyphRecord): Promise<void> {
  await tx(GLYPHS_STORE, "readwrite", (s) => s.put(g));
}

export async function loadGlyphs(): Promise<GlyphRecord[]> {
  return tx<GlyphRecord[]>(GLYPHS_STORE, "readonly", (s) => s.getAll());
}

export async function deleteGlyph(runId: number): Promise<void> {
  await tx(GLYPHS_STORE, "readwrite", (s) => s.delete(runId));
}

// Locations are regeneration inputs like glyphs — intentionally NOT cleared
// by clearRuns()/disconnect.
export async function saveLoc(runId: number, loc: string): Promise<void> {
  if (loc.trim()) {
    await tx(LOCS_STORE, "readwrite", (s) => s.put({ runId, loc: loc.trim() }));
  } else {
    await tx(LOCS_STORE, "readwrite", (s) => s.delete(runId));
  }
}

export async function loadLocs(): Promise<Map<number, string>> {
  const list = await tx<{ runId: number; loc: string }[]>(LOCS_STORE, "readonly", (s) =>
    s.getAll()
  );
  return new Map(list.map((r) => [r.runId, r.loc]));
}

export async function saveStitchOpts(opts: unknown): Promise<void> {
  await tx(META_STORE, "readwrite", (s) => s.put(opts, "stitchOpts"));
}

export async function loadStitchOpts<T>(): Promise<T | undefined> {
  return tx<T | undefined>(META_STORE, "readonly", (s) => s.get("stitchOpts"));
}

export async function saveSelection(ids: number[]): Promise<void> {
  await tx(META_STORE, "readwrite", (s) => s.put(ids, "selection"));
}

export async function loadSelection(): Promise<number[]> {
  const v = await tx<number[] | undefined>(META_STORE, "readonly", (s) => s.get("selection"));
  return v ?? [];
}
