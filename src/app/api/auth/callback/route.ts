import { NextRequest, NextResponse } from "next/server";

const STRAVA_OAUTH_BASE = "https://www.strava.com/oauth";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  try {
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

    const response = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID!,
        client_secret: process.env.STRAVA_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("Token exchange failed:", txt);
      return NextResponse.redirect(new URL("/?error=token_exchange_failed", request.url));
    }

    const tokenData = await response.json();
    const redirectUrl = new URL("/", request.url);
    redirectUrl.hash = `access_token=${tokenData.access_token}&refresh_token=${tokenData.refresh_token}&expires_at=${tokenData.expires_at}`;
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=server_error", request.url));
  }
}
