import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Punto de aterrizaje del enlace mágico: cambia el código de un solo uso por una
 * sesión y deja la cookie puesta.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // El caso habitual aquí es un correo fuera de la lista blanca: el trigger de
    // la base de datos rechaza el alta y Supabase devuelve el error tal cual.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // `next` viene de la URL, así que solo se aceptan rutas internas: un valor
  // como `//evil.com` sería una redirección abierta.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
