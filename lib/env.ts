/**
 * Lectura y validación de la configuración, con errores que se entienden.
 *
 * Dos cosas que parecen paranoia y no lo son:
 *
 *  1. Se recortan los espacios. Pegar un valor en el panel de Vercel arrastra
 *     con muchísima frecuencia un espacio o un salto de línea al final. La
 *     variable "existe", así que una comprobación de "está vacía" la da por
 *     buena, y después el SDK revienta al parsear la URL.
 *  2. Se valida que la URL parsea. Un fallo aquí, con un mensaje claro, es
 *     mucho más barato que el mismo fallo tres capas más abajo dentro de un SDK.
 */
export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

export function readSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url) throw missingEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) throw missingEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL no es una URL válida: ${JSON.stringify(url)}. ` +
        "Tiene que ser algo como https://xxxx.supabase.co, sin espacios ni comillas.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL debe empezar por https:// (recibido: ${parsed.protocol}//).`,
    );
  }

  return { url, publishableKey };
}

function missingEnv(name: string): Error {
  return new Error(
    `Falta la variable de entorno ${name}. ` +
      "En local va en .env.local; en Vercel, en Settings → Environment Variables. " +
      "Como es NEXT_PUBLIC_*, se incrusta al construir: después de añadirla hay que volver a desplegar.",
  );
}

/**
 * Qué variables ve el proceso, SIN revelar sus valores.
 *
 * Es lo que convierte "Internal Server Error" en un diagnóstico: dice si la
 * variable llegó, cuántos caracteres tiene y si arrastra espacios — suficiente
 * para detectar un nombre mal escrito o un valor mal pegado, y nada más.
 */
export function describeEnv(): string {
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ];

  const lines = names.map((name) => {
    const raw = process.env[name];
    if (raw === undefined) return `${name}: NO DEFINIDA`;
    const trimmed = raw.trim();
    const notes = [`${trimmed.length} caracteres`];
    if (raw !== trimmed) notes.push("⚠️ tiene espacios al principio o al final");
    if (!trimmed) notes.push("⚠️ está vacía");
    return `${name}: definida (${notes.join(", ")})`;
  });

  // Nombres parecidos que estén definidos: delata una errata al escribirlos.
  const similar = Object.keys(process.env)
    .filter(
      (key) =>
        /SUPA|SUPABASE|OPENAI|ANTHROPIC/i.test(key) && !names.includes(key),
    )
    .sort();

  if (similar.length > 0) {
    lines.push(
      "",
      "Otras variables con nombre parecido (¿alguna errata?):",
      ...similar.map((key) => `  ${key}`),
    );
  }

  return lines.join("\n");
}
