"use client";

import { useEffect, useState, useCallback } from "react";
import { STRAVA_API_BASE, StravaActivity, isRun } from "@/lib/strava";
import { saveRuns, loadRuns, clearRuns, getLastSync } from "@/lib/db";
import { Studio } from "@/components/Studio";

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

  // Load token from URL hash (after OAuth) or localStorage; load cached runs from IDB
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.location.hash) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const expires_at = params.get("expires_at");
      const scope = params.get("scope");
      if (access_token && refresh_token && expires_at) {
        const t: TokenData = {
          access_token,
          refresh_token,
          expires_at: Number(expires_at),
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
        setToken(t);
        window.history.replaceState(null, "", window.location.pathname);
        // Without activity:read the activities endpoint 403s — catch it at
        // connect time instead of at first fetch
        if (scope && !scope.includes("activity:read")) {
          setError(
            "Strava didn't grant activity access — click Disconnect, reconnect, and keep all permission boxes checked."
          );
        }
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
    // force: always re-show the consent screen so a reauth can pick up scopes
    // a previous grant was missing (auto silently reuses the old grant)
    const url =
      `https://www.strava.com/oauth/authorize?client_id=${clientId}` +
      `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&approval_prompt=force&scope=read,activity:read_all`;
    window.location.href = url;
  };

  const disconnect = async () => {
    localStorage.removeItem(TOKEN_KEY);
    await clearRuns().catch(() => {});
    setToken(null);
    setRuns([]);
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
    setProgress("Checking for new activities...");

    try {
      // Incremental sync: only pull activities newer than the latest cached
      // run (Strava's `after` is epoch seconds, exclusive) — a refresh is
      // usually a single API call. An empty cache still fetches everything;
      // a future "force full sync" can just clear the cache first.
      const newest = runs[0]?.start_date;
      const after = newest ? Math.floor(new Date(newest).getTime() / 1000) : undefined;

      const fetched: StravaActivity[] = [];
      let page = 1;
      while (true) {
        const params = new URLSearchParams({ per_page: "100", page: String(page) });
        if (after) params.set("after", String(after));
        const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
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
        fetched.push(...data);
        setProgress(`Fetched ${fetched.length} activities (page ${page})...`);
        if (data.length < 100) break;
        page++;
      }

      const newRuns = fetched.filter(isRun);
      // merge with cache, dedupe by id, newest first
      const byId = new Map<number, StravaActivity>();
      for (const r of [...newRuns, ...runs]) byId.set(r.id, r);
      const merged = [...byId.values()].sort(
        (a, b) => +new Date(b.start_date) - +new Date(a.start_date)
      );

      setProgress(newRuns.length ? `Saving ${newRuns.length} new run(s)...` : "");
      await saveRuns(merged);
      setRuns(merged);
      setLastSync(Date.now());
      setProgress("");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
        <h1 className="font-mono text-sm tracking-[0.3em] uppercase">⌐ Laurels Studio ⌙</h1>
        <p className="text-gray-500 text-sm">Connect Strava to pull your run data.</p>
        <button
          onClick={connectStrava}
          className="px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700"
        >
          Connect with Strava
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-xs tracking-[0.3em] uppercase">⌐ Laurels Studio ⌙</h1>
          {lastSync && (
            <span className="text-xs text-gray-400 font-mono">
              {runs.length} runs · {new Date(lastSync).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center text-sm">
          <button
            onClick={fetchAllRuns}
            disabled={loading}
            className="px-3 py-1.5 bg-orange-600 text-white rounded-lg font-medium disabled:opacity-50 hover:bg-orange-700"
          >
            {loading ? "Syncing…" : runs.length ? "Refresh" : "Fetch runs"}
          </button>
          <button
            onClick={disconnect}
            className="px-3 py-1.5 text-gray-400 hover:text-gray-700"
          >
            Disconnect
          </button>
        </div>
      </header>

      {progress && <p className="text-xs text-gray-400 font-mono mb-2">{progress}</p>}
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

      {runs.length > 0 ? (
        <Studio runs={runs} />
      ) : (
        !loading && (
          <p className="text-gray-400 text-sm">No runs cached yet — hit Fetch runs.</p>
        )
      )}
    </main>
  );
}
