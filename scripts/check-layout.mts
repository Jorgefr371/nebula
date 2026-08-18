/**
 * Comprueba el sistema de maquetación: los bloques del libro y los temas.
 *
 * Lo que se prueba aquí es que lo que escribe el agente llegue maquetado a las
 * tres salidas. Un bloque que se pierde por el camino no da error: da un
 * capítulo que parece un documento de Word, y eso solo se descubre abriendo el
 * PDF ya exportado.
 *
 *   npm run check:layout
 */

import { renderMarkdown, toXhtml } from "@/lib/ebook/render";
import { splitMeta, BLOCK_VARIANTS } from "@/lib/ebook/blocks";
import { bookCss } from "@/lib/ebook/book-css";
import { getTheme, THEMES, DEFAULT_THEME } from "@/lib/ebook/themes";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------

console.log("\nsplitMeta");

const conMeta = splitMeta(
  "titulo: Pollo al limón\netiquetas: Congelable · 4 porciones\n\n## Ingredientes\n- 600 g de pollo",
);
check("separa las claves de la cabecera", conMeta.meta.titulo === "Pollo al limón");
check(
  "conserva el cuerpo entero",
  conMeta.body === "## Ingredientes\n- 600 g de pollo",
  JSON.stringify(conMeta.body),
);

// El caso que se lleva por delante el texto si la regla es ingenua: un párrafo
// del cuerpo que contiene dos puntos.
const sinMeta = splitMeta("Recuerda: enfría siempre antes de congelar.\n\nY etiqueta.");
check(
  "no confunde un párrafo con dos puntos con un metadato",
  Object.keys(sinMeta.meta).length === 0 &&
    sinMeta.body.startsWith("Recuerda: enfría"),
  `meta=${JSON.stringify(sinMeta.meta)} body=${JSON.stringify(sinMeta.body.slice(0, 40))}`,
);

// ---------------------------------------------------------------------------

console.log("\nBloques → HTML");

for (const variant of BLOCK_VARIANTS) {
  const html = renderMarkdown(`:::${variant}\nTexto de prueba del bloque.\n:::`);
  check(
    `:::${variant} produce su clase`,
    html.includes(`ebook-${variant}`) && html.includes("Texto de prueba"),
    html.slice(0, 140),
  );
}

const ficha = renderMarkdown(
  ":::ficha\ntitulo: Pollo al limón\netiquetas: Congelable · 4 porciones · 25 min\n\n## Ingredientes\n\n- 600 g de pechuga\n- 2 cdas de limón\n:::",
);
check("la ficha pinta su título", ficha.includes("Pollo al limón"));
// Se cuenta la clase exacta: `ebook-chips` (el contenedor) contiene la
// subcadena `ebook-chip`, y contar la subcadena daba siempre uno de más.
const chipCount = (ficha.match(/class="ebook-chip"/g) ?? []).length;
check(
  "la ficha convierte las etiquetas en chips",
  chipCount === 3,
  `${chipCount} chips`,
);
check(
  "el Markdown de dentro se procesa igual que fuera",
  ficha.includes("<h2") && ficha.includes("<li>"),
  ficha.slice(0, 200),
);

const dato = renderMarkdown(
  ":::dato\ncifra: 20-30%\nfuente: Nature Genetics\n\nSolo esa fracción es genética.\n:::",
);
check("el dato destaca la cifra", dato.includes("ebook-dato-cifra") && dato.includes("20-30%"));
check("el dato imprime la fuente", dato.includes("ebook-dato-fuente") && dato.includes("Nature Genetics"));

// ---------------------------------------------------------------------------

console.log("\nCasos límite");

const desconocido = renderMarkdown(":::loquesea\nHola\n:::");
check(
  "un bloque de tipo inexistente no se traga el texto",
  desconocido.includes("Hola"),
  desconocido.slice(0, 120),
);

const sinCerrar = renderMarkdown(":::tip\nMe olvidé de cerrar el bloque.");
check(
  "un bloque sin cerrar tampoco pierde el texto",
  sinCerrar.includes("Me olvidé de cerrar"),
  sinCerrar.slice(0, 120),
);

const dos = renderMarkdown(
  ":::tip\nPrimero.\n:::\n\nTexto entre medias.\n\n:::aviso\nSegundo.\n:::",
);
check(
  "dos bloques seguidos no se funden en uno",
  dos.includes("ebook-tip") &&
    dos.includes("ebook-aviso") &&
    dos.includes("Texto entre medias"),
  dos.slice(0, 200),
);

const inyeccion = renderMarkdown(':::tip\ntitulo: <img src=x onerror="alert(1)">\n\nHola\n:::');
check(
  "el metadato se escapa: no puede inyectar HTML",
  !inyeccion.includes("<img src=x") && inyeccion.includes("&lt;img"),
  inyeccion.slice(0, 160),
);

// ---------------------------------------------------------------------------

console.log("\nEPUB: los bloques tienen que sobrevivir al XHTML");

const xhtml = toXhtml(
  renderMarkdown(":::ficha\ntitulo: Prueba\netiquetas: A · B\n\nTexto con <br> y &nbsp; dentro.\n:::"),
);
check("no quedan etiquetas vacías sin cerrar", !/<br(?!\/)[^>]*>/.test(xhtml), xhtml.slice(0, 200));
check("las entidades no numéricas desaparecen", !xhtml.includes("&nbsp;"));
check(
  "las etiquetas de bloque se conservan",
  xhtml.includes("ebook-ficha") && xhtml.includes("ebook-chip"),
);

// Comprobación de buena formación real: si esto no parsea, el lector de EPUB
// rechaza el fichero entero, no solo maqueta peor este capítulo.
const wrapped = `<?xml version="1.0" encoding="UTF-8"?><root xmlns="http://www.w3.org/1999/xhtml">${xhtml}</root>`;
let xmlOk = true;
let xmlError = "";
try {
  const { XMLValidator } = await import("fast-xml-parser");
  const result = XMLValidator.validate(wrapped);
  if (result !== true) {
    xmlOk = false;
    xmlError = JSON.stringify(result.err);
  }
} catch (error) {
  xmlOk = false;
  xmlError = String(error);
}
check("el XHTML resultante es XML bien formado", xmlOk, xmlError);

// ---------------------------------------------------------------------------

console.log("\nTemas");

check("hay un tema por cada nicho medido", THEMES.length === 6, `${THEMES.length} temas`);
check(
  "todos los ids son únicos",
  new Set(THEMES.map((t) => t.id)).size === THEMES.length,
);
check(
  "todos definen la paleta completa",
  THEMES.every(
    (t) =>
      /^#[0-9A-Fa-f]{6}$/.test(t.colors.ink) &&
      /^#[0-9A-Fa-f]{6}$/.test(t.colors.paper) &&
      /^#[0-9A-Fa-f]{6}$/.test(t.colors.soft) &&
      /^#[0-9A-Fa-f]{6}$/.test(t.colors.accent) &&
      /^#[0-9A-Fa-f]{6}$/.test(t.colors.rule),
  ),
);
check(
  "un tema inexistente cae en el neutro en vez de romper",
  getTheme("no-existe").id === DEFAULT_THEME && getTheme(null).id === DEFAULT_THEME,
);

const culinario = bookCss("culinario", ".ebook-page");
check(
  "el CSS lleva el acento del tema elegido",
  culinario.includes(getTheme("culinario").colors.accent),
);
check(
  "todas las reglas quedan dentro del ámbito del libro",
  culinario
    .split("\n")
    .filter((line) => line.includes("{") && !line.trim().startsWith("/*"))
    .every((line) => line.trim().startsWith(".ebook-page")),
  culinario
    .split("\n")
    .filter((l) => l.includes("{") && !l.trim().startsWith(".ebook-page") && !l.trim().startsWith("/*"))
    .slice(0, 3)
    .join(" | "),
);

const paraEpub = bookCss("culinario");
check(
  "sin ámbito, el CSS del EPUB usa :root para las variables",
  paraEpub.includes(":root {") && paraEpub.includes("--book-accent"),
);
check(
  "cada bloque tiene estilos propios en el CSS",
  BLOCK_VARIANTS.every((variant) => paraEpub.includes(`.ebook-${variant}`)),
  BLOCK_VARIANTS.filter((v) => !paraEpub.includes(`.ebook-${v}`)).join(", "),
);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? "\nMaquetación correcta: los bloques llegan enteros a pantalla, PDF y EPUB.\n"
    : `\n${failures} comprobaciones fallidas.\n`,
);
process.exit(failures === 0 ? 0 : 1);
