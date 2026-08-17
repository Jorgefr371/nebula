import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase en el servidor (Server Components y Route Handlers).
 *
 * `cookies()` es asíncrono desde Next.js 15 y el acceso síncrono se eliminó del
 * todo en 16, de ahí el await.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Los Server Components no pueden escribir cookies. No pasa nada:
            // el refresco de sesión lo hace proxy.ts, que sí puede.
          }
        },
      },
    },
  );
}
