import { TOOL_NAMES } from "@/lib/agent/tools";

/**
 * Qué versión está corriendo de verdad.
 *
 * Existe porque hemos perdido varias vueltas preguntándonos si un despliegue
 * tenía o no un cambio. Una URL que responde el commit exacto y la lista de
 * herramientas activas convierte esa pregunta en una comprobación de un segundo.
 *
 * No expone nada sensible: SHA de commit, rama y nombres de herramientas.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    mensaje: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    rama: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    entorno: process.env.VERCEL_ENV ?? "development",
    desplegadoEn: process.env.VERCEL_URL ?? null,
    herramientas: TOOL_NAMES,
    proveedor: process.env.OPENAI_API_KEY
      ? "openai"
      : process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : "sin configurar",
    modeloImagen: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1-mini",
  });
}
