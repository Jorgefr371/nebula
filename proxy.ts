import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "@/lib/env";

/**
 * En Next.js 16 `middleware` se renombró a `proxy` (runtime nodejs, no
 * configurable). Aquí se hacen dos cosas:
 *
 *  1. Refrescar el token de sesión de Supabase y reescribir la cookie. Los
 *     Server Components no pueden escribir cookies, así que sin esto la sesión
 *     caduca y el usuario acaba deslogueado sin motivo aparente.
 *  2. Cerrar la aplicación: cualquier ruta que no sea el login redirige a él si
 *     no hay usuario. Es una herramienta interna, no hay nada público.
 */
const PUBLIC_PATHS = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();

  const supabase = createServerClient(
    env.url,
    env.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalida el token contra el servidor de Supabase. getSession() no
  // lo hace: se fía de la cookie, que el cliente puede manipular.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Todo menos estáticos e imágenes. Importante NO excluir /api: las rutas de
    // API también necesitan el refresco de sesión.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
