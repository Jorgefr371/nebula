import type { NextConfig } from "next";

/**
 * Nota histórica: esto llevaba cabeceras COOP/COEP para que WebContainer
 * pudiera usar SharedArrayBuffer. Al pivotar a generación de ebooks el runtime
 * de Node en el navegador dejó de tener sentido, y con él se fue el aislamiento
 * cross-origin — que bloqueaba cualquier recurso de terceros, incluidas las
 * portadas servidas desde Supabase Storage.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
