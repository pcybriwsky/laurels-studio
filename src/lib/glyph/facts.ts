import { StravaActivity, RoutePoint, decodePolyline, metersToMiles } from "@/lib/strava";

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

// Everything a glyph generator needs, precomputed and preformatted, so
// generators stay dumb and deterministic.
export interface RunFacts {
  runId: number;
  name: string;
  ordinal: number; // 1-based position among GPS runs, oldest first
  ordinalStr: string; // "012"
  serial: string; // "012-0705"
  dateStr: string; // "2026.07.05"
  distStr: string; // "6.24 MI"
  timeStr: string; // "48:32" or "1:12:08"
  locStr: string | null; // "NYC" — optional place label stitched at the badge top
  miles: number; // drives the mile ruler
  timeOfDay: TimeOfDay; // drives the corner mark
  route: RoutePoint[];
}

// "48:32", "1:12:08" — total running time as a clock readout.
export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function buildFacts(run: StravaActivity, ordinal: number, loc?: string | null): RunFacts {
  const route = run.map?.summary_polyline ? decodePolyline(run.map.summary_polyline) : [];
  // Parse the date portion directly — Strava's start_date_local carries a fake Z
  // suffix, so new Date() would shift it by the viewer's timezone.
  const local = run.start_date_local ?? run.start_date;
  const [y, m, d] = local.slice(0, 10).split("-");
  const hour = Number(local.slice(11, 13));
  const ordinalStr = String(ordinal).padStart(3, "0");
  const miles = metersToMiles(run.distance);
  return {
    runId: run.id,
    name: run.name,
    ordinal,
    ordinalStr,
    serial: `${ordinalStr}-${m}${d}`,
    dateStr: `${y}.${m}.${d}`,
    distStr: `${miles.toFixed(2)} MI`,
    timeStr: formatClock(run.moving_time),
    locStr: loc?.trim() ? loc.trim().toUpperCase() : null,
    miles,
    timeOfDay: hour < 4 ? "night" : hour < 9 ? "dawn" : hour < 17 ? "day" : hour < 21 ? "dusk" : "night",
    route,
  };
}
