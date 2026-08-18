import { getTheme, themeCss, type Theme } from "@/lib/ebook/themes";

/**
 * La maquetación del libro, en un solo sitio.
 *
 * Preview, PDF y EPUB salen de aquí. Antes los estilos del libro vivían en
 * globals.css para el preview y en una plantilla aparte para el EPUB; con dos
 * copias, arreglar una ficha en pantalla no arreglaba la del EPUB y nadie se
 * enteraba hasta abrir el fichero en un Kindle. Una copia, tres salidas.
 *
 * `scope` permite el mismo CSS en los dos mundos: en el preview cuelga de
 * `.ebook-page`, y en el EPUB —donde el documento ES el libro— va sin prefijo.
 */
export function bookCss(themeId: string | null | undefined, scope = ""): string {
  const theme = getTheme(themeId);
  const s = scope ? `${scope} ` : "";

  return `${themeCss(theme, scope || ":root")}

/* --- Bloques ----------------------------------------------------------- */

${s}.ebook-block {
  margin: 1.8em 0;
  padding: 1.1em 1.25em;
  background: var(--book-soft);
  border-radius: 4px;
  /* Una ficha partida entre dos páginas deja los ingredientes en una y los
     pasos en otra, que es justo cuando el lector abandona. */
  page-break-inside: avoid;
  break-inside: avoid;
}

${s}.ebook-block-body > *:first-child { margin-top: 0; }
${s}.ebook-block-body > *:last-child { margin-bottom: 0; }
${s}.ebook-block p { text-indent: 0; }

${s}.ebook-block-label {
  margin: 0 0 0.5em;
  font-family: var(--book-display);
  font-size: 0.68em;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--book-accent);
}

${s}.ebook-block-title {
  margin: 0 0 0.35em;
  font-family: var(--book-display);
  font-size: 1.1em;
  font-weight: 700;
  line-height: 1.25;
}

${s}.ebook-block-note {
  margin: 0.8em 0 0;
  font-size: 0.85em;
  font-style: italic;
  opacity: 0.75;
}

/* --- Ficha: la unidad que se repite en una colección -------------------- */

${s}.ebook-ficha {
  padding-top: 1em;
  background: transparent;
  border-top: 3px solid var(--book-accent);
  border-bottom: 1px solid var(--book-rule);
  border-radius: 0;
}

${s}.ebook-chips {
  margin: 0 0 0.9em;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
}

${s}.ebook-chip {
  display: inline-block;
  padding: 0.18em 0.6em;
  margin-right: 0.3em;
  background: var(--book-soft);
  border-radius: 999px;
  font-family: var(--book-display);
  font-size: 0.72em;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* --- Avisos ------------------------------------------------------------- */

${s}.ebook-tip,
${s}.ebook-nota,
${s}.ebook-aviso {
  border-left: 3px solid var(--book-accent);
  border-radius: 0 4px 4px 0;
}

${s}.ebook-aviso { border-left-color: #B4531A; }
${s}.ebook-aviso .ebook-block-label { color: #B4531A; }

/* --- Dato: la cifra concreta con su fuente ------------------------------ */

${s}.ebook-dato {
  text-align: center;
  background: transparent;
  border-top: 1px solid var(--book-rule);
  border-bottom: 1px solid var(--book-rule);
  border-radius: 0;
}

${s}.ebook-dato-cifra {
  margin: 0 0 0.15em;
  font-family: var(--book-display);
  font-size: 2.1em;
  font-weight: 800;
  line-height: 1.05;
  color: var(--book-accent);
}

${s}.ebook-dato-fuente {
  margin: 0.7em 0 0;
  font-size: 0.75em;
  letter-spacing: 0.04em;
  opacity: 0.7;
}

/* --- Pasos: numeral grande, como en los bonus que funcionan ------------- */

${s}.ebook-pasos { background: transparent; padding-left: 0; padding-right: 0; }

${s}.ebook-pasos ol {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: paso;
}

${s}.ebook-pasos li {
  position: relative;
  margin: 0 0 0.85em;
  padding-left: 2.6em;
  counter-increment: paso;
}

${s}.ebook-pasos li::before {
  content: counter(paso);
  position: absolute;
  left: 0;
  top: -0.1em;
  font-family: var(--book-display);
  font-size: 1.5em;
  font-weight: 800;
  line-height: 1;
  color: var(--book-accent);
}

/* --- Checklist ---------------------------------------------------------- */

${s}.ebook-checklist ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

${s}.ebook-checklist li {
  position: relative;
  margin: 0 0 0.6em;
  padding-left: 1.9em;
}

${s}.ebook-checklist li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.25em;
  width: 0.85em;
  height: 0.85em;
  border: 1.5px solid var(--book-accent);
  border-radius: 2px;
}

/* --- Plantilla: la tabla en blanco que el lector rellena ---------------- */

${s}.ebook-plantilla { background: transparent; padding: 0; }

${s}.ebook-plantilla table { margin: 0; }

${s}.ebook-plantilla td {
  /* Alto de renglón para escribir a mano. Es lo que convierte una tabla en
     una plantilla imprimible, que es lo que más se percibe como regalo. */
  height: 2.4em;
}

/* --- Tablas ------------------------------------------------------------- */

${s}table {
  width: 100%;
  margin: 1.8em 0;
  border-collapse: collapse;
  font-family: var(--book-display);
  font-size: 0.86em;
  page-break-inside: avoid;
  break-inside: avoid;
}

${s}th, ${s}td {
  padding: 0.5em 0.65em;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--book-rule);
}

${s}thead th {
  font-size: 0.85em;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--book-accent);
  border-bottom: 2px solid var(--book-accent);
}
`;
}

/** El tema resuelto, para quien necesite los colores sueltos. */
export function resolveTheme(themeId: string | null | undefined): Theme {
  return getTheme(themeId);
}
