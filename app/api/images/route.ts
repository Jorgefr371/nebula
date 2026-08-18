import { buildImagePrompt, isImageRole } from "@/lib/images/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * Generación de imágenes para el ebook.
 *
 * Vive en el servidor por dos motivos, no solo uno: la clave de OpenAI no puede
 * llegar al navegador, y una imagen de 1024px pesa más de un mega en base64 —
 * pasarla al cliente para que él la suba sería mover ese peso dos veces sin
 * ninguna ganancia. Aquí se genera, se sube a Storage y solo vuelve la URL.
 */

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1-mini";

export const maxDuration = 300;

type Body = {
  ebookId?: string;
  prompt?: string;
  /** "cover" usa formato vertical de portada; "illustration" lo decide el papel. */
  kind?: "cover" | "illustration";
  /** Papel de la ilustración: qué trabajo tiene que hacer. Ver lib/images/roles.ts. */
  role?: string;
};

/** La portada siempre es vertical. El resto de tamaños los fija el papel. */
const COVER_SIZE = "1024x1536";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Falta OPENAI_API_KEY: no se pueden generar imágenes." },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const ebookId = body.ebookId?.trim();
  const kind = body.kind === "cover" ? "cover" : "illustration";

  if (!prompt) return Response.json({ error: "Falta prompt" }, { status: 400 });
  if (!ebookId) return Response.json({ error: "Falta ebookId" }, { status: 400 });

  // La sesión del usuario manda: si RLS no le deja ver este libro, tampoco puede
  // generarle imágenes. Nunca se confía en el ebookId que llega del cliente.
  const supabase = await createClient();
  const { data: ebook, error: ebookError } = await supabase
    .from("ebooks")
    .select("id, image_style, theme")
    .eq("id", ebookId)
    .single();

  if (ebookError || !ebook) {
    return Response.json(
      { error: "No se encontró el libro o no tienes acceso." },
      { status: 404 },
    );
  }

  // El prompt se monta AQUÍ, no se le pide al agente que lo recuerde. Cada
  // imagen es una llamada independiente: confiar en que se acuerde del estilo
  // veinte turnos después es cómo un libro acaba con nueve registros distintos.
  //
  // Para las ilustraciones, el papel decide la técnica y la paleta sale del
  // tema del libro. Sin eso, "ilustra el capítulo" devuelve siempre una foto de
  // archivo: bonita, intercambiable y que no explica nada.
  let fullPrompt: string;
  let size: string;

  if (kind === "cover") {
    const style = ebook.image_style?.trim();
    fullPrompt = [
      style && `Estilo visual (aplícalo estrictamente): ${style}.`,
      prompt,
      // El texto de la portada se compone después con tipografía real, en
      // compose_cover. Aquí solo hace falta el fondo.
      "Composición pensada como FONDO de portada: el tercio superior y la franja " +
        "inferior deben quedar despejados, porque encima irá el título y una " +
        "banda de beneficios.",
      "Sin texto, letras, números ni marcas de agua en la imagen.",
    ]
      .filter(Boolean)
      .join("\n\n");
    size = COVER_SIZE;
  } else {
    const role = isImageRole(body.role) ? body.role : "escena";
    const built = buildImagePrompt({
      role,
      prompt,
      themeId: ebook.theme,
      imageStyle: ebook.image_style,
    });
    fullPrompt = built.prompt;
    size = built.size;
  }

  // 1. Generar.
  let base64: string;
  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: fullPrompt,
        size,
        n: 1,
      }),
      signal: request.signal,
    });

    const payload = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: payload?.error?.message ?? `OpenAI devolvió ${response.status}` },
        { status: 502 },
      );
    }

    // Los modelos gpt-image devuelven base64, nunca una URL.
    base64 = payload?.data?.[0]?.b64_json;
    if (!base64) {
      return Response.json(
        { error: "OpenAI no devolvió ninguna imagen." },
        { status: 502 },
      );
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Error generando la imagen",
      },
      { status: 502 },
    );
  }

  // 2. Subir a Storage.
  const bytes = Buffer.from(base64, "base64");
  const path = `${ebookId}/${kind}-${crypto.randomUUID()}.png`;

  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(path, bytes, { contentType: "image/png", upsert: false });

  if (uploadError) {
    return Response.json(
      { error: `No se pudo guardar la imagen: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("images").getPublicUrl(path);

  // 3. Si es portada, apuntarla en el libro.
  if (kind === "cover") {
    await supabase.from("ebooks").update({ cover_path: path }).eq("id", ebookId);
  }

  return Response.json({ url: publicUrl, path, kind, bytes: bytes.length });
}
