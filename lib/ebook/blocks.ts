import type { TokenizerAndRendererExtension, Tokens } from "marked";

/**
 * Vocabulario de bloques del libro.
 *
 * Markdown plano da párrafos, listas y citas. Los ebooks que venden no están
 * hechos de eso: están hechos de fichas repetidas con su cabecera de etiquetas,
 * recuadros de consejo, cifras destacadas, listas de pasos numeradas en grande,
 * checklists y plantillas en blanco. Medido sobre cuatro libros con venta
 * probada, esos seis elementos aparecen en todos, y son justo los que un
 * generador que solo emite Markdown no puede producir.
 *
 * La alternativa sería dejar que el agente escriba HTML y CSS a mano. Es peor:
 * cada capítulo saldría con su propia idea de cómo es un recuadro, que es
 * exactamente la incoherencia visual que esto viene a eliminar. Aquí el agente
 * elige el TIPO de bloque y la maquetación es siempre la misma.
 *
 * Sintaxis, deliberadamente parecida a la de las directivas de Markdown:
 *
 *   :::tip
 *   Enfría siempre antes de congelar.
 *   :::
 *
 *   :::ficha
 *   titulo: Pollo al limón y hierbas
 *   etiquetas: Congelable · 4 porciones · 25 min
 *
 *   ## Ingredientes
 *   - 600 g de pechuga
 *   :::
 *
 * Las líneas `clave: valor` del principio son metadatos; lo que va después del
 * primer renglón en blanco es Markdown normal y se procesa como tal.
 */

/** Los seis bloques, con la etiqueta que se imprime en su cabecera. */
const VARIANTS = {
  ficha: { tag: "section", label: null },
  tip: { tag: "aside", label: "Consejo" },
  nota: { tag: "aside", label: "Nota" },
  aviso: { tag: "aside", label: "Atención" },
  dato: { tag: "aside", label: "El dato" },
  pasos: { tag: "section", label: null },
  checklist: { tag: "section", label: null },
  plantilla: { tag: "section", label: null },
} as const;

export type BlockVariant = keyof typeof VARIANTS;

export const BLOCK_VARIANTS = Object.keys(VARIANTS) as BlockVariant[];

type ContainerToken = Tokens.Generic & {
  type: "ebookBlock";
  variant: BlockVariant;
  meta: Record<string, string>;
  tokens: Tokens.Generic[];
};

/** Escapa para insertar en HTML. El contenido lo escribe un modelo. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Claves de cabecera reconocidas. Es una lista cerrada a propósito.
 *
 * Aceptar cualquier `palabra: valor` parecía razonable y era un fallo: una
 * primera línea como "Recuerda: enfría siempre antes de congelar" encaja con
 * ese patrón, así que se convertía en metadato y desaparecía del texto del
 * libro sin dar ningún error. Con una lista cerrada, todo lo que no sea una de
 * estas seis claves es cuerpo.
 */
const META_KEYS = new Set([
  "titulo",
  "título",
  "etiquetas",
  "cifra",
  "fuente",
  "nota",
]);

/**
 * Separa las líneas `clave: valor` de cabecera del cuerpo en Markdown.
 *
 * Solo cuentan las claves de META_KEYS, y solo antes de la primera línea que no
 * lo sea.
 */
export function splitMeta(source: string): {
  meta: Record<string, string>;
  body: string;
} {
  const lines = source.split("\n");
  const meta: Record<string, string> = {};
  let index = 0;

  for (; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      if (Object.keys(meta).length > 0) {
        index++;
        break;
      }
      continue;
    }
    const match = /^([a-záéíóúñ]+):\s+(.*)$/i.exec(line.trim());
    if (!match) break;
    const key = match[1].toLowerCase();
    if (!META_KEYS.has(key)) break;
    meta[key] = match[2].trim();
  }

  return { meta, body: lines.slice(index).join("\n").trim() };
}

/** Las etiquetas de una ficha, separadas por · o por coma. */
function chips(value: string): string {
  return value
    .split(/\s*[·,|]\s*/)
    .map((chip) => chip.trim())
    .filter(Boolean)
    .map((chip) => `<span class="ebook-chip">${escapeHtml(chip)}</span>`)
    .join("");
}

function renderHead(variant: BlockVariant, meta: Record<string, string>): string {
  const preset = VARIANTS[variant];
  const title = meta.titulo ?? meta.título ?? "";

  if (variant === "dato") {
    // La cifra manda: es lo que distingue "la genética influye" de "solo el
    // 20-30% de la longevidad es genética". Se pinta en grande y aparte.
    const figure = meta.cifra ?? "";
    return figure
      ? `<p class="ebook-dato-cifra">${escapeHtml(figure)}</p>`
      : `<p class="ebook-block-label">${preset.label}</p>`;
  }

  const parts: string[] = [];

  if (preset.label && !title) {
    parts.push(`<p class="ebook-block-label">${preset.label}</p>`);
  }
  if (title) {
    parts.push(`<p class="ebook-block-title">${escapeHtml(title)}</p>`);
  }
  if (meta.etiquetas) {
    parts.push(`<p class="ebook-chips">${chips(meta.etiquetas)}</p>`);
  }

  return parts.join("");
}

function renderFoot(variant: BlockVariant, meta: Record<string, string>): string {
  if (variant === "dato" && meta.fuente) {
    // Sin fuente, una cifra concreta es solo una cifra inventada con más
    // aplomo. El pie la obliga a estar visible.
    return `<p class="ebook-dato-fuente">${escapeHtml(meta.fuente)}</p>`;
  }
  if (meta.nota) {
    return `<p class="ebook-block-note">${escapeHtml(meta.nota)}</p>`;
  }
  return "";
}

/**
 * Extensión de marked que reconoce los bloques `:::`.
 *
 * El cuerpo se tokeniza con el lexer del propio marked en vez de con una
 * segunda pasada de `parse`: así una lista dentro de una ficha es la misma
 * lista que fuera, y no una reimplementación que se desincroniza.
 */
export const ebookBlockExtension: TokenizerAndRendererExtension = {
  name: "ebookBlock",
  level: "block",

  start(src: string) {
    return src.match(/^:::/m)?.index;
  },

  tokenizer(src: string) {
    const match = /^:::[ \t]*([a-z]+)[ \t]*\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/.exec(src);
    if (!match) return undefined;

    const variant = match[1].toLowerCase();
    // Un tipo desconocido no se captura: así el texto pasa tal cual y el autor
    // ve el `:::loquesea` en el preview, en vez de que el bloque desaparezca.
    if (!(variant in VARIANTS)) return undefined;

    const { meta, body } = splitMeta(match[2]);

    return {
      type: "ebookBlock",
      raw: match[0],
      variant: variant as BlockVariant,
      meta,
      tokens: this.lexer.blockTokens(body ? `${body}\n` : ""),
    } satisfies ContainerToken;
  },

  renderer(token) {
    const block = token as ContainerToken;
    const preset = VARIANTS[block.variant];
    const inner = this.parser.parse(block.tokens);

    return (
      `<${preset.tag} class="ebook-block ebook-${block.variant}">` +
      renderHead(block.variant, block.meta) +
      `<div class="ebook-block-body">${inner}</div>` +
      renderFoot(block.variant, block.meta) +
      `</${preset.tag}>`
    );
  },
};
