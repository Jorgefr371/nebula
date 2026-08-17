"use client";

import { createBrowserClient } from "@supabase/ssr";
import { readSupabaseEnv } from "@/lib/env";

/**
 * Supabase para el navegador.
 *
 * La publishable key es pública por diseño: quien protege los datos es RLS, no
 * el secreto de la clave. Lo que cierra el producto al equipo está en el alta
 * (el trigger `enforce_allowed_email` en la base de datos), no aquí.
 */
export function createClient() {
  const env = readSupabaseEnv();
  return createBrowserClient(env.url, env.publishableKey);
}
