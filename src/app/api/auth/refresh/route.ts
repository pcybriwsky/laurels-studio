import { NextRequest, NextResponse } from "next/server";

const STRAVA_OAUTH_BASE = "https://www.strava.com/oauth";

export async function POST(request: NextRequest) {
  try {
    const { refresh_token } = await request.json();
    if (!refresh_token) {
      return NextResponse.json({ error: "Missing refresh token" }, { status: 400 });
    }

    const response = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID!,
        client_secret: process.env.STRAVA_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Refresh failed" }, { status: response.status });
    }
    const tokenData = await response.json();
    return NextResponse.json(tokenData);
  } catch (err) {
    console.error("Refresh error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
