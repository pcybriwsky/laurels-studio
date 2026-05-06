import type { StravaActivity } from "./strava";

const DB_NAME = "apparel-brand";
const DB_VERSION = 1;
const RUNS_STORE = "runs";
const META_STORE = "meta";

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

export async function saveSelection(ids: number[]): Promise<void> {
  await tx(META_STORE, "readwrite", (s) => s.put(ids, "selection"));
}

export async function loadSelection(): Promise<number[]> {
  const v = await tx<number[] | undefined>(META_STORE, "readonly", (s) => s.get("selection"));
  return v ?? [];
}
