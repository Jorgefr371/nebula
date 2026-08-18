import { marked } from "marked";
import { ebookBlockExtension } from "@/lib/ebook/blocks";

// Se registra una sola vez a nivel de módulo. marked.use() acumula: llamarlo
// dentro de renderMarkdown añadiría la extensión otra vez en cada capítulo.
marked.use({ extensions: [ebookBlockExtension] });

/**
 * Markdown → HTML.
 *
 * El contenido lo escribe el modelo, no una persona de confianza, así que se
 * sanea antes de inyectarlo con dangerouslySetInnerHTML. Un prompt del usuario
 * puede hacer que el modelo emita HTML, y ese HTML acaba en el DOM del editor.
 */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return html as string;
}

/**
 * Saneado.
 *
 * `class` ya viene permitida en el perfil html, así que los bloques sobreviven
 * sin tocar nada. Lo que sí hay que quitar es `style`, que el perfil también
 * permite: un solo `<p style="color:red">` emitido por el modelo se salta el
 * tema del libro, y el tema existe precisamente para que eso no pase. El diseño
 * lo decide la hoja de estilos; el modelo elige qué bloque usa, no cómo se ve.
 */
const SANITIZE = {
  USE_PROFILES: { html: true },
  FORBID_ATTR: ["style"],
};

/** Versión saneada, solo para navegador (DOMPurify necesita DOM). */
export async function renderMarkdownSafe(markdown: string): Promise<string> {
  const html = renderMarkdown(markdown);
  const { default: DOMPurify } = await import("dompurify");
  return DOMPurify.sanitize(html, SANITIZE);
}

const VOID_ELEMENTS = ["br", "hr", "img", "input", "meta", "link"];

/**
 * HTML → XHTML bien formado.
 *
 * Los EPUB son XML: un `<br>` sin cerrar hace que el lector rechace el fichero
 * entero, no que lo maquete un poco peor. marked emite HTML5, así que hay que
 * cerrar los elementos vacíos y escapar las entidades que XML no conoce.
 */
export function toXhtml(html: string): string {
  let out = html;

  for (const tag of VOID_ELEMENTS) {
    // <br> y <br attr="…"> → <br/> y <br attr="…"/>, sin tocar los ya cerrados.
    out = out.replace(
      new RegExp(`<${tag}([^>]*?)\\s*/?>`, "gi"),
      (_match, attrs: string) => `<${tag}${attrs.trimEnd()}/>`,
    );
  }

  // XML solo conoce &amp; &lt; &gt; &quot; &apos;. El resto va como numérica.
  out = out.replace(/&nbsp;/g, "&#160;");
  out = out.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;");

  return out;
}

/** Escapa texto para insertarlo en XML (títulos, autor, etc.). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
