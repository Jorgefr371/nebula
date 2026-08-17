"use client";

import JSZip from "jszip";
import type { Chapter, Ebook } from "@/lib/ebook/types";
import { escapeXml, renderMarkdown, toXhtml } from "@/lib/ebook/render";

/**
 * Genera un EPUB 3 válido.
 *
 * Un EPUB es un ZIP con una estructura muy concreta. Dos reglas que, si se
 * incumplen, hacen que los lectores rechacen el fichero entero:
 *
 *  1. `mimetype` tiene que ser la PRIMERA entrada del ZIP y estar SIN COMPRIMIR.
 *     Es como los lectores identifican el formato sin descomprimir nada.
 *  2. Todo el contenido es XHTML, no HTML: los elementos vacíos van cerrados y
 *     las entidades tienen que ser válidas en XML.
 */
export async function buildEpub(
  ebook: Ebook,
  chapters: Chapter[],
): Promise<Blob> {
  const zip = new JSZip();

  const uid = `urn:uuid:${ebook.id}`;
  const title = escapeXml(ebook.title);
  const author = escapeXml(ebook.author || "Anónimo");
  const language = escapeXml(ebook.language || "es");
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // 1. mimetype — primero y sin comprimir.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. Dónde encontrar el paquete.
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  zip.file("OEBPS/style.css", EPUB_STYLESHEET);

  const written = chapters.filter((chapter) => chapter.content.trim());

  // 3. Un XHTML por capítulo.
  const entries = written.map((chapter, index) => {
    const fileName = `chapter-${String(index + 1).padStart(3, "0")}.xhtml`;
    const body = toXhtml(renderMarkdown(chapter.content));

    zip.file(
      `OEBPS/${fileName}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}" lang="${language}">
  <head>
    <title>${escapeXml(chapter.title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeXml(chapter.title)}</h1>
      ${body}
    </section>
  </body>
</html>`,
    );

    return { id: `ch${index + 1}`, fileName, title: chapter.title };
  });

  // 4. Portadilla.
  zip.file(
    "OEBPS/title.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}" lang="${language}">
  <head>
    <title>${title}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <section class="titlepage">
      <h1 class="book-title">${title}</h1>
      ${ebook.subtitle ? `<p class="book-subtitle">${escapeXml(ebook.subtitle)}</p>` : ""}
      <p class="book-author">${author}</p>
    </section>
  </body>
</html>`,
  );

  // 5. Índice navegable (EPUB 3 usa nav.xhtml; toc.ncx es el fallback de EPUB 2).
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
  <head>
    <title>Índice</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Índice</h1>
      <ol>
${entries.map((entry) => `        <li><a href="${entry.fileName}">${escapeXml(entry.title)}</a></li>`).join("\n")}
      </ol>
    </nav>
  </body>
</html>`,
  );

  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${entries
  .map(
    (entry, index) => `    <navPoint id="nav${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(entry.title)}</text></navLabel>
      <content src="${entry.fileName}"/>
    </navPoint>`,
  )
  .join("\n")}
  </navMap>
</ncx>`,
  );

  // 6. El manifiesto: qué ficheros hay y en qué orden se leen.
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${language}</dc:language>
${ebook.description ? `    <dc:description>${escapeXml(ebook.description)}</dc:description>` : ""}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
${entries.map((entry) => `    <item id="${entry.id}" href="${entry.fileName}" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine toc="ncx">
    <itemref idref="titlepage"/>
    <itemref idref="nav"/>
${entries.map((entry) => `    <itemref idref="${entry.id}"/>`).join("\n")}
  </spine>
</package>`,
  );

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  });
}

/**
 * Estilos deliberadamente sobrios: los lectores de EPUB reflowan el texto y
 * anulan buena parte del CSS, así que pelear por la maquetación es perder. Se
 * fija lo que sí respetan — jerarquía, ritmo vertical y sangrías.
 */
const EPUB_STYLESHEET = `body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 0 5%;
  text-align: justify;
  hyphens: auto;
}

h1 {
  font-size: 1.6em;
  line-height: 1.25;
  margin: 2em 0 1em;
  text-align: left;
  page-break-before: always;
}

h2 { font-size: 1.25em; margin: 1.8em 0 0.6em; text-align: left; }
h3 { font-size: 1.1em; margin: 1.5em 0 0.5em; text-align: left; }

p { margin: 0; text-indent: 1.4em; }
/* Primer párrafo tras un encabezado: sin sangría, como en tipografía impresa. */
h1 + p, h2 + p, h3 + p, blockquote + p { text-indent: 0; }

blockquote {
  margin: 1.4em 1.6em;
  font-style: italic;
  text-indent: 0;
}

ul, ol { margin: 1em 0 1em 1.4em; text-align: left; }
li { margin-bottom: 0.4em; }

hr { border: 0; border-top: 1px solid currentColor; margin: 2em auto; width: 25%; opacity: 0.4; }

.titlepage { text-align: center; margin-top: 25%; }
.book-title { font-size: 2.1em; margin-bottom: 0.3em; text-align: center; page-break-before: avoid; }
.book-subtitle { font-style: italic; font-size: 1.15em; text-indent: 0; margin-bottom: 2.5em; }
.book-author { text-indent: 0; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.9em; }
`;

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ebook"
  );
}
