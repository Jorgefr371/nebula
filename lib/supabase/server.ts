import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabaseEnv } from "@/lib/env";

/**
 * Supabase en el servidor (Server Components y Route Handlers).
 *
 * `cookies()` es asíncrono desde Next.js 15 y el acceso síncrono se eliminó del
 * todo en 16, de ahí el await.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const env = readSupabaseEnv();

  return createServerClient(
    env.url,
    env.publishableKey,
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
