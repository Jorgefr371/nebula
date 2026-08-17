/**
 * Comprobación de configuración con un error que se entiende.
 *
 * Sin esto, desplegar sin variables de entorno produce un 500 opaco en TODAS
 * las rutas: `createServerClient(undefined, undefined)` revienta dentro del SDK
 * de Supabase con un mensaje que no menciona ninguna variable. Es exactamente el
 * fallo que te hace perder media hora mirando logs de build que están bien.
 *
 * Ojo con las NEXT_PUBLIC_*: se incrustan en el bundle en tiempo de BUILD, no de
 * arranque. Añadirlas en Vercel no basta — hay que volver a desplegar.
 */
export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

export function readSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Comprobación explícita en vez de recolectar los que faltan en un array:
  // TypeScript no estrecha el tipo a través de un `filter`, y acabaríamos
  // devolviendo `string | undefined` con un `!` que anula el propósito.
  if (!url) throw missingEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) throw missingEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  return { url, publishableKey };
}

function missingEnv(name: string): Error {
  return new Error(
    `Falta la variable de entorno ${name}. ` +
      "En local va en .env.local; en Vercel, en Settings → Environment Variables. " +
      "Como es NEXT_PUBLIC_*, se incrusta al construir: después de añadirla hay que volver a desplegar.",
  );
}
