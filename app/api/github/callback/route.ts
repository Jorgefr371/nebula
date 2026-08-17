import { NextResponse } from "next/server";

/**
 * Vuelta del OAuth de GitHub: cambia el código por un token y lo guarda en una
 * cookie httpOnly.
 *
 * httpOnly a propósito: un token de GitHub con permiso de escritura en repos no
 * puede quedar al alcance de JavaScript del cliente. Solo lo lee el servidor,
 * en la ruta de export.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnTo = searchParams.get("state") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/?github_error=missing_code`);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/?github_error=not_configured`);
  }

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    },
  );

  const payload = await tokenResponse.json();

  if (!payload.access_token) {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent(payload.error ?? "token_exchange_failed")}`,
    );
  }

  const safeReturn =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";

  const response = NextResponse.redirect(`${origin}${safeReturn}`);
  response.cookies.set("gh_token", payload.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
