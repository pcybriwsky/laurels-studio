"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  STRAVA_API_BASE,
  StravaActivity,
  RoutePoint,
  decodePolyline,
  metersToMiles,
  formatDuration,
  formatPace,
  isRun,
} from "@/lib/strava";
import { saveRuns, loadRuns, clearRuns, getLastSync, saveSelection, loadSelection } from "@/lib/db";
import { LayoutView } from "@/components/LayoutView";

const TOKEN_KEY = "apparel_brand_strava_token";

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export default function Home() {
  const [token, setToken] = useState<TokenData | null>(null);
  const [runs, setRuns] = useState<StravaActivity[]>([]);
  const [lastSync, setLastSync] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"data" | "layout">("data");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSelection(Array.from(next)).catch(() => {});
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(() => {
      const next = new Set(ids);
      saveSelection(Array.from(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    saveSelection([]).catch(() => {});
  }, []);

  // Load token from URL hash (after OAuth) or localStorage; load cached runs from IDB
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.location.hash) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const expires_at = params.get("expires_at");
      if (access_token && refresh_token && expires_at) {
        const t: TokenData = {
          access_token,
          refresh_token,
          expires_at: Number(expires_at),
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
        setToken(t);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } else {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        try {
          setToken(JSON.parse(stored));
        } catch {}
      }
    }

    loadRuns()
      .then((cached) => {
        if (cached.length > 0) {
          setRuns(cached.sort((a, b) => +new Date(b.start_date) - +new Date(a.start_date)));
        }
      })
      .catch((e) => console.warn("IDB load failed:", e));
    getLastSync().then(setLastSync);
    loadSelection().then((ids) => setSelectedIds(new Set(ids)));
  }, []);

  const refreshAccessToken = useCallback(async (refresh_token: string): Promise<TokenData | null> => {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const t: TokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    setToken(t);
    return t;
  }, []);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    if (token.expires_at - 60 > now) return token.access_token;
    const fresh = await refreshAccessToken(token.refresh_token);
    return fresh?.access_token ?? null;
  }, [token, refreshAccessToken]);

  const connectStrava = () => {
    const clientId = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;
    if (!clientId) {
      setError("Missing NEXT_PUBLIC_STRAVA_CLIENT_ID in .env.local");
      return;
    }
    const redirectUri = `${window.location.origin}/api/auth/callback`;
    const url =
      `https://www.strava.com/oauth/authorize?client_id=${clientId}` +
      `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&approval_prompt=auto&scope=read,activity:read_all`;
    window.location.href = url;
  };

  const disconnect = async () => {
    localStorage.removeItem(TOKEN_KEY);
    await clearRuns().catch(() => {});
    setToken(null);
    setRuns([]);
    setSelectedId(null);
    setSelectedIds(new Set());
    setLastSync(undefined);
  };

  const fetchAllRuns = async () => {
    const accessToken = await getValidToken();
    if (!accessToken) {
      setError("No valid token — reconnect");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress("Fetching activities...");

    try {
      const all: StravaActivity[] = [];
      let page = 1;
      while (true) {
        const res = await fetch(
          `${STRAVA_API_BASE}/athlete/activities?per_page=100&page=${page}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (res.status === 429) {
          setError("Rate limited by Strava. Wait 15 minutes.");
          break;
        }
        if (!res.ok) {
          setError(`Fetch failed: ${res.status}`);
          break;
        }
        const data: StravaActivity[] = await res.json();
        if (data.length === 0) break;
        all.push(...data);
        setProgress(`Fetched ${all.length} activities (page ${page})...`);
        if (data.length < 100) break;
        page++;
      }

      const onlyRuns = all
        .filter(isRun)
        .sort((a, b) => +new Date(b.start_date) - +new Date(a.start_date));

      setProgress(`Saving ${onlyRuns.length} runs...`);
      await saveRuns(onlyRuns);
      setRuns(onlyRuns);
      setLastSync(Date.now());
      setProgress(`Done — ${onlyRuns.length} runs cached`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const selected = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId]
  );

  if (!token) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
        <h1 className="text-3xl font-bold">Apparel Brand</h1>
        <p className="text-gray-600">Connect Strava to pull your run data.</p>
        <button
          onClick={connectStrava}
          className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700"
        >
          Connect with Strava
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Runs</h1>
          {lastSync && (
            <p className="text-xs text-gray-500">
              {runs.length} cached · synced {new Date(lastSync).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex rounded border overflow-hidden mr-2">
            <button
              onClick={() => setView("data")}
              className={`px-3 py-1.5 text-sm ${view === "data" ? "bg-gray-900 text-white" : "bg-white"}`}
            >
              Data
            </button>
            <button
              onClick={() => setView("layout")}
              className={`px-3 py-1.5 text-sm ${view === "layout" ? "bg-gray-900 text-white" : "bg-white"}`}
            >
              Layout
            </button>
          </div>
          <button
            onClick={fetchAllRuns}
            disabled={loading}
            className="px-4 py-2 bg-orange-600 text-white rounded font-medium disabled:opacity-50"
          >
            {loading ? "Loading..." : runs.length ? "Refresh" : "Fetch all runs"}
          </button>
          <button onClick={disconnect} className="px-4 py-2 bg-gray-200 rounded font-medium">
            Disconnect
          </button>
        </div>
      </header>

      {progress && <p className="text-sm text-gray-600 mb-2">{progress}</p>}
      {error && <p className="text-red-600 mb-2">{error}</p>}

      {runs.length > 0 && view === "layout" && (
        <LayoutView runs={runs} selectedIds={selectedIds} />
      )}

      {runs.length > 0 && view === "data" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-lg overflow-hidden max-h-[70vh] flex flex-col">
            <div className="flex items-center gap-2 p-2 border-b bg-gray-50 text-sm">
              <span className="font-medium">{selectedIds.size}</span>
              <span className="text-gray-500">selected for design</span>
              <div className="flex-1" />
              <select
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const gps = runs.filter((r) => r.map?.summary_polyline);
                  if (v === "all") {
                    selectAll(gps.map((r) => r.id));
                  } else {
                    const n = Number(v);
                    selectAll(gps.slice(0, n).map((r) => r.id));
                  }
                  e.target.value = "";
                }}
                defaultValue=""
                className="px-2 py-1 text-xs border rounded bg-white"
              >
                <option value="" disabled>
                  Last X runs…
                </option>
                <option value="5">Last 5</option>
                <option value="10">Last 10</option>
                <option value="25">Last 25</option>
                <option value="50">Last 50</option>
                <option value="100">Last 100</option>
                <option value="200">Last 200</option>
                <option value="all">All GPS</option>
              </select>
              <button
                onClick={clearSelection}
                className="px-2 py-1 text-xs border rounded hover:bg-white"
              >
                Clear
              </button>
            </div>
            <div className="overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-right p-2">Mi</th>
                  <th className="text-right p-2">Pace</th>
                  <th className="text-right p-2">GPS</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const checked = selectedIds.has(r.id);
                  return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`cursor-pointer border-t hover:bg-orange-50 ${
                      selectedId === r.id ? "bg-orange-100" : checked ? "bg-orange-50/40" : ""
                    }`}
                  >
                    <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(r.id)}
                        disabled={!r.map?.summary_polyline}
                        title={r.map?.summary_polyline ? "Include in design" : "No GPS data"}
                      />
                    </td>
                    <td className="p-2">{new Date(r.start_date_local).toLocaleDateString()}</td>
                    <td className="p-2 truncate max-w-[200px]">{r.name}</td>
                    <td className="p-2 text-right">{metersToMiles(r.distance).toFixed(2)}</td>
                    <td className="p-2 text-right">{formatPace(r.distance, r.moving_time)}</td>
                    <td className="p-2 text-right text-gray-400">
                      {r.map?.summary_polyline ? "•" : ""}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="border rounded-lg p-4">
            {selected ? (
              <RunDetail run={selected} />
            ) : (
              <p className="text-gray-500">Select a run to see details and decoded route.</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function RunDetail({ run }: { run: StravaActivity }) {
  const route = useMemo<RoutePoint[]>(
    () => (run.map?.summary_polyline ? decodePolyline(run.map.summary_polyline) : []),
    [run]
  );

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">{run.name}</h2>
      <div className="text-sm text-gray-600">
        {new Date(run.start_date_local).toLocaleString()}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Distance</dt>
        <dd>{metersToMiles(run.distance).toFixed(2)} mi</dd>
        <dt className="text-gray-500">Time</dt>
        <dd>{formatDuration(run.moving_time)}</dd>
        <dt className="text-gray-500">Pace</dt>
        <dd>{formatPace(run.distance, run.moving_time)}</dd>
        <dt className="text-gray-500">Elev gain</dt>
        <dd>{Math.round(run.total_elevation_gain)} m</dd>
        <dt className="text-gray-500">Avg HR</dt>
        <dd>{run.average_heartrate ? Math.round(run.average_heartrate) : "—"}</dd>
        <dt className="text-gray-500">Type</dt>
        <dd>{run.sport_type ?? run.type}</dd>
      </dl>

      {route.length > 0 ? (
        <div>
          <div className="text-sm font-medium mb-1">Route ({route.length} points)</div>
          <RoutePreview route={route} />
          <details className="mt-2">
            <summary className="text-xs text-gray-500 cursor-pointer">Show decoded coords</summary>
            <pre className="text-xs bg-gray-50 p-2 mt-1 max-h-48 overflow-auto">
              {JSON.stringify(route.slice(0, 50), null, 2)}
              {route.length > 50 && `\n... ${route.length - 50} more points`}
            </pre>
          </details>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No GPS data for this run.</p>
      )}
    </div>
  );
}

function RoutePreview({ route }: { route: RoutePoint[] }) {
  if (route.length < 2) return null;
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const w = 400;
  const h = 300;
  const pad = 10;
  const sx = (lng: number) =>
    pad + ((lng - minLng) / (maxLng - minLng || 1)) * (w - 2 * pad);
  const sy = (lat: number) =>
    h - pad - ((lat - minLat) / (maxLat - minLat || 1)) * (h - 2 * pad);
  const d = route.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.lng)} ${sy(p.lat)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full border rounded bg-gray-50">
      <path d={d} fill="none" stroke="#ea580c" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
