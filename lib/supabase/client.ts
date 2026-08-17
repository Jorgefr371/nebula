"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase para el navegador.
 *
 * La publishable key es pública por diseño: quien protege los datos es RLS, no
 * el secreto de la clave. Lo que cierra el producto al equipo está en el alta
 * (el trigger `enforce_allowed_email` en la base de datos), no aquí.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
