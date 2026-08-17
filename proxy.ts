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

  // Si falta configuración, el proxy corre en TODAS las rutas y lanzar aquí
  // convierte la aplicación entera en un "Internal Server Error" mudo: Next.js
  // oculta el detalle en producción y el mensaje se queda en unos logs a los que
  // quizá no tengas acceso. Mejor devolver un 503 que diga exactamente qué
  // falta; no revela ningún secreto, solo nombres de variables.
  let env;
  try {
    env = readSupabaseEnv();
  } catch (error) {
    return new NextResponse(
      `Nébula no está configurada.\n\n${error instanceof Error ? error.message : String(error)}`,
      {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

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
  //
  // Se envuelve porque aquí se hace una llamada de red: una URL con una errata,
  // un proyecto pausado o una caída de Supabase lanzarían, y al correr el proxy
  // en todas las rutas eso tumba la aplicación entera con un 500 sin explicación.
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    return new NextResponse(
      "No se pudo contactar con Supabase.\n\n" +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        `URL configurada: ${env.url}\n` +
        "Revisa que sea correcta y que el proyecto no esté pausado.",
      {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

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
