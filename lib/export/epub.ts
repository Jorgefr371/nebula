"use client";

import JSZip from "jszip";
import type { Chapter, Ebook } from "@/lib/ebook/types";
import { bookCss } from "@/lib/ebook/book-css";
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

  // El tema y los bloques salen de la misma función que usa el preview, así
  // que lo que se ve en pantalla es lo que llega al lector de ebooks.
  zip.file("OEBPS/style.css", EPUB_STYLESHEET + "\n" + bookCss(ebook.theme));

  const written = chapters.filter((chapter) => chapter.content.trim());

  // Las imágenes hay que EMBEBERLAS. Un EPUB es un paquete cerrado que se lee
  // sin conexión: dejar <img src="https://…"> produce huecos en blanco en
  // cualquier lector offline, y los validadores lo marcan como recurso remoto
  // no declarado en el manifiesto.
  const images = await embedImages(zip, written);

  // 3. Un XHTML por capítulo.
  const entries = written.map((chapter, index) => {
    const fileName = `chapter-${String(index + 1).padStart(3, "0")}.xhtml`;
    let html = renderMarkdown(chapter.content);
    for (const [remoteUrl, local] of images) {
      html = html.split(remoteUrl).join(local.href);
    }
    const body = toXhtml(html);

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
${[...images.values()].map((image) => `    <item id="${image.id}" href="${image.href}" media-type="${image.mediaType}"/>`).join("\n")}
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

type EmbeddedImage = {
  id: string;
  /** Ruta relativa dentro de OEBPS, que es lo que va en el <img src>. */
  href: string;
  mediaType: string;
};

/**
 * Descarga las imágenes referenciadas en los capítulos y las mete en el ZIP.
 *
 * Se descargan en paralelo pero los fallos NO tumban la exportación: si una
 * imagen no responde, se deja su URL original en el HTML. Un EPUB con una
 * imagen rota es infinitamente mejor que ningún EPUB, y el usuario está
 * pulsando "Exportar" porque quiere su libro ahora.
 */
async function embedImages(
  zip: JSZip,
  chapters: Chapter[],
): Promise<Map<string, EmbeddedImage>> {
  const urls = new Set<string>();
  for (const chapter of chapters) {
    for (const match of chapter.content.matchAll(
      /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g,
    )) {
      urls.add(match[1]);
    }
  }

  const embedded = new Map<string, EmbeddedImage>();

  await Promise.all(
    [...urls].map(async (url, index) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;

        const blob = await response.blob();

        // Comprobar que es DE VERDAD una imagen, no solo que la petición fue
        // bien. Una URL rota que apunta a un dominio vivo devuelve 200 con una
        // página HTML, y sin esto acabaría incrustada como si fuera un PNG:
        // el EPUB queda con un recurso corrupto y un media-type inválido en el
        // manifiesto, que es justo lo que rechaza un validador.
        const extension = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
        }[blob.type.split(";")[0].trim()];

        if (!extension) return;
        const mediaType = blob.type.split(";")[0].trim();

        const href = `images/img-${String(index + 1).padStart(3, "0")}.${extension}`;
        zip.file(`OEBPS/${href}`, await blob.arrayBuffer());

        embedded.set(url, { id: `img${index + 1}`, href, mediaType });
      } catch {
        // Se deja la URL remota en el HTML; el resto del libro sale igual.
      }
    }),
  );

  return embedded;
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

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1.6em auto;
  /* Evita que una imagen quede partida entre dos páginas. */
  page-break-inside: avoid;
  break-inside: avoid;
}

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
