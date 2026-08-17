import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { describeEnv, readSupabaseEnv } from "@/lib/env";

/**
 * En Next.js 16 `middleware` se renombró a `proxy` (runtime nodejs, no
 * configurable). Aquí se hacen dos cosas:
 *
 *  1. Refrescar el token de sesión de Supabase y reescribir la cookie. Los
 *     Server Components no pueden escribir cookies, así que sin esto la sesión
 *     caduca y el usuario acaba deslogueado sin motivo aparente.
 *  2. Cerrar la aplicación: cualquier ruta que no sea el login redirige a él si
 *     no hay usuario. Es una herramienta interna, no hay nada público.
 *
 * TODO el cuerpo va dentro de un try/catch. El proxy corre en cada ruta, así que
 * cualquier excepción aquí convierte la aplicación entera en un "Internal Server
 * Error" mudo — Next.js oculta el detalle en producción y el mensaje se queda en
 * unos logs a los que quizá no tengas acceso. Envolver solo los sitios donde
 * "creo que" puede fallar no sirve: la primera vez fallaba justo en el punto que
 * había dejado fuera.
 */
// /api/version es público a propósito: sirve para comprobar QUÉ hay desplegado,
// y si exigiera sesión no se podría usar justo cuando más falta hace —cuando algo
// no funciona. No expone nada sensible.
const PUBLIC_PATHS = ["/login", "/auth", "/api/version"];

export async function proxy(request: NextRequest) {
  try {
    return await handle(request);
  } catch (error) {
    return configError(error);
  }
}

async function handle(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();

  const supabase = createServerClient(env.url, env.publishableKey, {
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
  });

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

/**
 * Página de diagnóstico. Dice qué variables ve el servidor y en qué estado,
 * nunca sus valores: los nombres y las longitudes bastan para encontrar una
 * errata o un valor mal pegado, y no filtran ningún secreto.
 */
function configError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return new NextResponse(
    [
      "Nébula no está configurada correctamente.",
      "",
      message,
      "",
      "─".repeat(60),
      "Variables que ve el servidor:",
      "",
      describeEnv(),
      "",
      "─".repeat(60),
      "Recuerda: las NEXT_PUBLIC_* se incrustan al CONSTRUIR.",
      "Añadirlas en Vercel no basta — hay que volver a desplegar.",
    ].join("\n"),
    {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export const config = {
  matcher: [
    // Todo menos estáticos e imágenes. Importante NO excluir /api: las rutas de
    // API también necesitan el refresco de sesión.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
