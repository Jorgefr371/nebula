"use client";

import { auditBook, formatAudit } from "@/lib/ebook/audit";
import { composeCover } from "@/lib/cover/compose";
import {
  composeCreative,
  CREATIVE_LAYOUTS,
  type CreativeLayout,
} from "@/lib/cover/creative";
import { IMAGE_ROLES, isImageRole } from "@/lib/images/roles";
import { getTheme, THEMES } from "@/lib/ebook/themes";
import { downloadBlob, slugify } from "@/lib/export/epub";
import { countWords, type Chapter, type Ebook } from "@/lib/ebook/types";
import { useEbook } from "@/lib/store/ebook";
import { createClient } from "@/lib/supabase/client";

export type ToolOutcome = { output: string; isError?: boolean };

/**
 * Los errores vuelven al modelo como tool_result con is_error, no se lanzan. El
 * agente los lee y se corrige solo; tragárselos lo dejaría adivinando.
 */
function fail(message: string): ToolOutcome {
  return { output: message, isError: true };
}

function requireEbookId(): string | null {
  return useEbook.getState().ebook?.id ?? null;
}

/** Recarga capítulos desde Postgres: la fuente de verdad tras un reordenamiento. */
async function refreshChapters(ebookId: string): Promise<Chapter[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("ebook_id", ebookId)
    .order("position");

  const chapters = (data ?? []) as Chapter[];
  useEbook.getState().replaceChapters(chapters);
  return chapters;
}

function chapterAt(position: number): Chapter | undefined {
  return useEbook
    .getState()
    .chapters.find((chapter) => chapter.position === position);
}

function outlineSummary(chapters: Chapter[]): string {
  if (chapters.length === 0) return "El libro no tiene capítulos.";
  return chapters
    .map((chapter) => {
      const words = countWords(chapter.content);
      return `${chapter.position}. ${chapter.title} — ${words === 0 ? "vacío" : `${words} palabras`}`;
    })
    .join("\n");
}

const executors: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  async set_metadata(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    // Cadena vacía significa "no tocar", tal y como promete la descripción de
    // la herramienta. Sin esto, el agente borraría campos sin querer al enviar
    // solo los que quiere cambiar.
    const patch: Record<string, string> = {};
    for (const key of [
      "title",
      "subtitle",
      "author",
      "language",
      "description",
      "theme",
      "image_style",
    ] as const) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) {
        patch[key] = value.trim();
      }
    }

    // Un tema inexistente caería en silencio al neutro, y el agente creería
    // haber elegido culinario mientras el libro sale editorial. Mejor fallar y
    // que vea la lista.
    if (patch.theme && !THEMES.some((theme) => theme.id === patch.theme)) {
      return fail(
        `El tema "${patch.theme}" no existe. Los disponibles son: ` +
          THEMES.map((theme) => `${theme.id} (${theme.para})`).join("; "),
      );
    }

    if (Object.keys(patch).length === 0) {
      return fail("No has enviado ningún campo con contenido.");
    }

    await useEbook.getState().applyEbookPatch(patch);
    return {
      output: `Metadatos actualizados: ${Object.keys(patch).join(", ")}.`,
    };
  },

  async create_outline(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    const raw = input.chapters;
    if (!Array.isArray(raw) || raw.length === 0) {
      return fail("chapters debe ser una lista de títulos no vacía.");
    }

    const titles = raw
      .filter((title): title is string => typeof title === "string")
      .map((title) => title.trim())
      .filter(Boolean);

    if (titles.length === 0) return fail("Ningún título válido en la lista.");

    const supabase = createClient();
    const { error } = await supabase.rpc("replace_outline", {
      p_ebook_id: ebookId,
      p_titles: titles,
    });

    if (error) return fail(error.message);

    const chapters = await refreshChapters(ebookId);
    await useEbook.getState().applyEbookPatch({ status: "writing" });

    return {
      output: `Índice creado con ${chapters.length} capítulos:\n${outlineSummary(chapters)}`,
    };
  },

  async list_chapters() {
    return { output: outlineSummary(useEbook.getState().chapters) };
  },

  async read_chapter(input) {
    const position = Number(input.position);
    const chapter = chapterAt(position);
    if (!chapter) {
      return fail(
        `No existe el capítulo ${position}. Índice actual:\n${outlineSummary(useEbook.getState().chapters)}`,
      );
    }
    if (!chapter.content.trim()) {
      return { output: `El capítulo ${position} ("${chapter.title}") está vacío.` };
    }
    return { output: chapter.content };
  },

  async write_chapter(input) {
    const position = Number(input.position);
    const content = input.content;
    if (typeof content !== "string") {
      return fail("content debe ser una cadena.");
    }

    const chapter = chapterAt(position);
    if (!chapter) {
      return fail(
        `No existe el capítulo ${position}. Créalo con add_chapter o revisa el índice:\n${outlineSummary(useEbook.getState().chapters)}`,
      );
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("chapters")
      .update({ content })
      .eq("id", chapter.id)
      .select()
      .single();

    if (error) return fail(error.message);

    useEbook.getState().upsertChapter(data as Chapter);
    return {
      output: `Capítulo ${position} ("${chapter.title}") escrito: ${countWords(content)} palabras.`,
    };
  },

  async edit_chapter(input) {
    const position = Number(input.position);
    const oldString = input.old_string;
    const newString = input.new_string;

    if (typeof oldString !== "string" || typeof newString !== "string") {
      return fail("old_string y new_string deben ser cadenas.");
    }
    if (oldString === newString) {
      return fail("old_string y new_string son idénticos; no hay nada que cambiar.");
    }

    const chapter = chapterAt(position);
    if (!chapter) return fail(`No existe el capítulo ${position}.`);

    const occurrences = chapter.content.split(oldString).length - 1;
    if (occurrences === 0) {
      return fail(
        `old_string no aparece en el capítulo ${position}. Léelo de nuevo y copia el fragmento exacto.`,
      );
    }
    if (occurrences > 1) {
      return fail(
        `old_string aparece ${occurrences} veces en el capítulo ${position}. Añade contexto alrededor para que sea único.`,
      );
    }

    const updated = chapter.content.replace(oldString, newString);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("chapters")
      .update({ content: updated })
      .eq("id", chapter.id)
      .select()
      .single();

    if (error) return fail(error.message);

    useEbook.getState().upsertChapter(data as Chapter);
    return { output: `Capítulo ${position} editado.` };
  },

  async add_chapter(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) return fail("title no puede estar vacío.");

    const supabase = createClient();
    const { error } = await supabase.rpc("insert_chapter", {
      p_ebook_id: ebookId,
      p_position: Number(input.position),
      p_title: title,
      p_content: typeof input.content === "string" ? input.content : "",
    });

    if (error) return fail(error.message);

    const chapters = await refreshChapters(ebookId);
    return {
      output: `Capítulo añadido. Índice ahora:\n${outlineSummary(chapters)}`,
    };
  },

  async rename_chapter(input) {
    const position = Number(input.position);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) return fail("title no puede estar vacío.");

    const chapter = chapterAt(position);
    if (!chapter) return fail(`No existe el capítulo ${position}.`);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("chapters")
      .update({ title })
      .eq("id", chapter.id)
      .select()
      .single();

    if (error) return fail(error.message);

    useEbook.getState().upsertChapter(data as Chapter);
    return { output: `Capítulo ${position} retitulado a "${title}".` };
  },

  async delete_chapter(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    const position = Number(input.position);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_chapter_at", {
      p_ebook_id: ebookId,
      p_position: position,
    });

    if (error) return fail(error.message);
    if (data === false) return fail(`No existe el capítulo ${position}.`);

    const chapters = await refreshChapters(ebookId);
    return {
      output: `Capítulo ${position} borrado. Índice ahora:\n${outlineSummary(chapters)}`,
    };
  },

  async move_chapter(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    const supabase = createClient();
    const { data, error } = await supabase.rpc("move_chapter", {
      p_ebook_id: ebookId,
      p_from: Number(input.from),
      p_to: Number(input.to),
    });

    if (error) return fail(error.message);
    if (data === false) return fail(`No existe el capítulo ${Number(input.from)}.`);

    const chapters = await refreshChapters(ebookId);
    return { output: `Reordenado. Índice ahora:\n${outlineSummary(chapters)}` };
  },

  async generate_image(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    const alt = typeof input.alt === "string" ? input.alt.trim() : "";
    if (!prompt) return fail("prompt no puede estar vacío.");
    if (!alt) return fail("alt no puede estar vacío: hace falta para accesibilidad.");

    const rol = typeof input.rol === "string" ? input.rol.trim() : "";
    if (!isImageRole(rol)) {
      return fail(
        `rol tiene que ser uno de: ${IMAGE_ROLES.join(", ")}. Llegó "${rol}".`,
      );
    }

    const titular = typeof input.titular === "string" ? input.titular.trim() : "";

    // Los roles que abren una sección NO pueden salir mudos. Antes se podía, y
    // el resultado medido fue un ebook de 67 páginas con cinco fotos sin una
    // sola palabra encima: un perro, y ya. Se falla aquí en vez de dejar pasar
    // la imagen vacía, porque el fallo silencioso solo se descubre al abrir el
    // PDF terminado.
    const EXIGEN_TITULAR = ["escena", "seccion", "comparacion"];
    if (EXIGEN_TITULAR.includes(rol) && !titular) {
      return fail(
        `El rol "${rol}" abre una sección y necesita titular: una imagen sin ` +
          "texto encima comunica un tema, no una intención. Escribe el dolor o " +
          "la promesa con las palabras del lector. Si lo que quieres es una " +
          "figura explicativa dentro del texto, usa el rol diagrama o anatomia, " +
          "que sí admiten titular vacío.",
      );
    }

    const result = await generateImage({
      ebookId,
      prompt,
      kind: "illustration",
      role: rol,
    });
    if ("error" in result) return fail(result.error);

    // Con titular, la imagen pasa por el compositor y sale ya con el mensaje
    // dibujado en tipografía real. Componer dejó de ser un paso opcional que
    // el agente recordaba a veces.
    if (!titular) {
      return {
        output:
          `Figura generada. Insértala donde corresponda con este Markdown:\n\n` +
          `![${alt}](${result.url})`,
      };
    }

    const theme = getTheme(useEbook.getState().ebook?.theme);
    const layout: CreativeLayout = rol === "comparacion" ? "antes-despues" : "gancho";

    const blob = await composeCreative(
      {
        layout,
        kicker: "",
        headline: titular,
        subheadline: typeof input.gancho === "string" ? input.gancho.trim() : "",
        beforeLabel: layout === "antes-despues" ? "Antes" : "",
        beforeCaption: "",
        afterLabel: layout === "antes-despues" ? "Después" : "",
        afterCaption: "",
        benefits: [],
        accent: theme.colors.accent,
      },
      result.url,
    );

    const supabase = createClient();
    const path = `${ebookId}/creativo-${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage
      .from("images")
      .upload(path, blob, { contentType: "image/png", upsert: false });

    if (error) return fail(`No se pudo guardar el creativo: ${error.message}`);

    const {
      data: { publicUrl },
    } = supabase.storage.from("images").getPublicUrl(path);

    return {
      output:
        `Imagen generada y montada con el titular. Insértala con:\n\n` +
        `![${alt}](${publicUrl})\n\n` +
        "Si necesitas rótulos por mitad o una lista de beneficios encima, " +
        "vuelve a montarla con compose_creative sobre esta misma URL.",
    };
  },

  async generate_cover(input) {
    const ebookId = requireEbookId();
    if (!ebookId) return fail("No hay ningún libro cargado.");

    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt) return fail("prompt no puede estar vacío.");

    const result = await generateImage({ ebookId, prompt, kind: "cover" });
    if ("error" in result) return fail(result.error);

    // La ruta la guarda el servidor en cover_path; aquí solo se refresca el
    // estado local para que el preview la pinte al instante.
    const supabase = createClient();
    const { data } = await supabase
      .from("ebooks")
      .select("*")
      .eq("id", ebookId)
      .single();
    if (data) useEbook.getState().applyRemoteEbook(data as Ebook);

    return { output: "Portada generada y asignada al libro." };
  },

  async compose_cover(input) {
    const ebook = useEbook.getState().ebook;
    if (!ebook) return fail("No hay ningún libro cargado.");
    if (!ebook.cover_path) {
      return fail(
        "El libro todavía no tiene portada de fondo. Ejecuta generate_cover " +
          "antes de componerla.",
      );
    }

    const accent = String(input.accent ?? "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
      return fail(
        `accent tiene que ser un hexadecimal de seis dígitos como "#7FB539"; llegó "${accent}".`,
      );
    }

    const strings = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

    const supabase = createClient();
    const {
      data: { publicUrl },
    } = supabase.storage.from("images").getPublicUrl(ebook.cover_path);

    const blob = await composeCover(
      {
        kicker: String(input.kicker ?? ""),
        title: String(input.title ?? ""),
        highlight: String(input.highlight ?? ""),
        script: String(input.script ?? ""),
        promise: String(input.promise ?? ""),
        ribbon: strings(input.ribbon),
        benefits: strings(input.benefits),
        badgeNumber: String(input.badge_number ?? ""),
        badgeLabel: String(input.badge_label ?? ""),
        accent,
      },
      publicUrl,
    );

    // Se sube Y se descarga. Subirla la deja disponible para el equipo desde el
    // otro ordenador; descargarla la pone en las manos de quien montará el
    // anuncio, que es quien la necesita ahora mismo.
    const path = `${ebook.id}/portada-compuesta-${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage
      .from("images")
      .upload(path, blob, { contentType: "image/png", upsert: false });

    if (error) return fail(`No se pudo guardar la portada: ${error.message}`);

    downloadBlob(blob, `${slugify(ebook.title)}-portada.png`);

    const {
      data: { publicUrl: composedUrl },
    } = supabase.storage.from("images").getPublicUrl(path);

    return {
      output:
        `Portada montada y descargada (${Math.round(blob.size / 1024)} KB). ` +
        `URL: ${composedUrl}\n\n` +
        "Compruébala en miniatura antes de darla por buena: es el tamaño al " +
        "que se ve en el anuncio.",
    };
  },

  async compose_creative(input) {
    const ebook = useEbook.getState().ebook;
    if (!ebook) return fail("No hay ningún libro cargado.");

    const imageUrl = String(input.image_url ?? "").trim();
    if (!imageUrl) {
      return fail("Falta image_url. Genera antes la imagen con generate_image.");
    }

    const layout = String(input.layout ?? "").trim() as CreativeLayout;
    if (!CREATIVE_LAYOUTS.includes(layout)) {
      return fail(
        `layout tiene que ser uno de: ${CREATIVE_LAYOUTS.join(", ")}. Llegó "${layout}".`,
      );
    }

    const accent = String(input.accent ?? "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
      return fail(`accent tiene que ser un hexadecimal como "#D2703A"; llegó "${accent}".`);
    }

    const blob = await composeCreative(
      {
        layout,
        kicker: String(input.kicker ?? ""),
        headline: String(input.headline ?? ""),
        subheadline: String(input.subheadline ?? ""),
        beforeLabel: String(input.before_label ?? ""),
        beforeCaption: String(input.before_caption ?? ""),
        afterLabel: String(input.after_label ?? ""),
        afterCaption: String(input.after_caption ?? ""),
        benefits: Array.isArray(input.benefits)
          ? input.benefits.filter((item): item is string => typeof item === "string")
          : [],
        accent,
      },
      imageUrl,
    );

    const supabase = createClient();
    const path = `${ebook.id}/creativo-${layout}-${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage
      .from("images")
      .upload(path, blob, { contentType: "image/png", upsert: false });

    if (error) return fail(`No se pudo guardar el creativo: ${error.message}`);

    const {
      data: { publicUrl },
    } = supabase.storage.from("images").getPublicUrl(path);

    return {
      output:
        `Creativo "${layout}" montado (${Math.round(blob.size / 1024)} KB).\n\n` +
        `Insértalo donde corresponda con:\n![${String(input.headline ?? "Creativo")}](${publicUrl})`,
    };
  },

  async audit_book() {
    // Se lee del store y no de Postgres: el store ya va sincronizado por
    // Realtime, y auditar lo que el usuario tiene delante evita informar sobre
    // una versión que ya no existe.
    return { output: formatAudit(auditBook(useEbook.getState().chapters)) };
  },
};

/** Llama a la ruta de servidor que genera la imagen y la sube a Storage. */
async function generateImage(options: {
  ebookId: string;
  prompt: string;
  kind: "cover" | "illustration";
  role?: string;
}): Promise<{ url: string } | { error: string }> {
  const response = await fetch("/api/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      error:
        payload?.error ??
        `La generación de imagen falló con HTTP ${response.status}.`,
    };
  }

  return { url: payload.url as string };
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const executor = executors[name];
  if (!executor) {
    // Listar las que sí hay no es adorno. El servidor manda al modelo la lista
    // de herramientas, pero quien las ejecuta es este bundle en el navegador:
    // si la pestaña lleva abierta desde antes de un despliegue, el modelo pide
    // una herramienta nueva que este código todavía no conoce. Ver la lista
    // real distingue ese caso —recargar y listo— de un fallo de verdad.
    return fail(
      `Herramienta desconocida: ${name}. ` +
        `Las disponibles en esta versión son: ${Object.keys(executors).join(", ")}. ` +
        "Si falta alguna que el modelo esperaba, la pestaña está ejecutando una versión antigua: recarga la página.",
    );
  }

  try {
    return await executor(input);
  } catch (error) {
    return fail(
      `${name} falló: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
