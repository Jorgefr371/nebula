/**
 * Verificación del generador de EPUB. Comprueba las invariantes que, si se
 * incumplen, hacen que un lector rechace el fichero entero.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { buildEpub } from "@/lib/export/epub";
import type { Chapter, Ebook } from "@/lib/ebook/types";

/**
 * Servidor local que sirve un PNG mínimo.
 *
 * Antes esto apuntaba a una imagen de Wikimedia y el test fallaba porque
 * Wikimedia devuelve 400 a peticiones automatizadas — un fallo del test, no del
 * código. Un servidor propio hace la prueba determinista y sin red.
 */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const imageServer = createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": String(PNG_1PX.length),
  });
  response.end(PNG_1PX);
});

await new Promise<void>((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
const IMAGE_URL = `http://127.0.0.1:${(imageServer.address() as { port: number }).port}/grafico.png`;

const ebook: Ebook = {
  id: "3f1c2d4e-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
  owner_id: "owner",
  title: "Vender sin vender & otras “rarezas”",
  subtitle: "Un método para <consultores> impacientes",
  author: "Equipo Nébula",
  language: "es",
  description: "Cómo cerrar clientes sin sonar a comercial.",
  cover_path: null,
  theme: "culinario",
  image_style: "fotografía editorial, luz cálida, paleta tierra",
  status: "ready",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const chapters: Chapter[] = [
  {
    id: "c1",
    ebook_id: ebook.id,
    position: 1,
    title: "El problema de sonar a vendedor",
    // A propósito: entidades, comillas, imagen y salto de línea forzado —
    // justo lo que rompe el XML si no se convierte a XHTML.
    content:
      "La primera llamada **decide** el resto.\n\nAT&T lo aprendió tarde: <20% de sus comerciales cerraban.\n\n> Nadie compra a quien parece necesitarlo.\n\nUna línea forzada  \ny lo que sigue.\n\n![portada](https://ejemplo.com/x.png)\n\n---\n\n- Primero\n- Segundo",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "c2",
    ebook_id: ebook.id,
    position: 2,
    title: "Preguntar mejor",
    // Imagen remota real: debe acabar EMBEBIDA en el ZIP, no referenciada.
    content: `## Las tres preguntas\n\nTexto del capítulo dos.\n\n![Un gráfico de ejemplo](${IMAGE_URL})`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "c3",
    ebook_id: ebook.id,
    position: 3,
    title: "Capítulo vacío que no debe aparecer",
    content: "   ",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const failures: string[] = [];
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const blob = await buildEpub(ebook, chapters);
const buffer = Buffer.from(await blob.arrayBuffer());
writeFileSync("/tmp/nebula-test.epub", buffer);

const zip = await JSZip.loadAsync(buffer);
const names = Object.keys(zip.files);

console.log("\nEstructura del EPUB:");

// 1. mimetype primero y sin comprimir — así detectan el formato los lectores.
//
// Se comprueba sobre los BYTES CRUDOS del ZIP, no sobre lo que reporte JSZip:
// es exactamente lo que hace un lector de EPUB. En la cabecera local de fichero,
// los bytes 8-9 son el método de compresión (0 = almacenado, 8 = deflate) y a
// partir del 30 va el nombre de la entrada.
check("firma ZIP válida", buffer.readUInt32LE(0) === 0x04034b50);
check(
  "la primera entrada se llama mimetype",
  buffer.subarray(30, 30 + buffer.readUInt16LE(26)).toString() === "mimetype",
);
check("mimetype está sin comprimir (STORE)", buffer.readUInt16LE(8) === 0);
check(
  "mimetype tiene el contenido exacto",
  (await zip.file("mimetype")!.async("string")) === "application/epub+zip",
);

// 2. Ficheros obligatorios.
for (const required of [
  "META-INF/container.xml",
  "OEBPS/content.opf",
  "OEBPS/nav.xhtml",
  "OEBPS/toc.ncx",
  "OEBPS/title.xhtml",
]) {
  check(`existe ${required}`, names.includes(required));
}

// 3. Solo los capítulos escritos se incluyen.
const chapterFiles = names.filter((name) => /chapter-\d+\.xhtml$/.test(name));
check("2 capítulos con contenido (el vacío se omite)", chapterFiles.length === 2);

// 4. Todo el XML tiene que parsear. Es LA invariante del formato.
const { XMLParser, XMLValidator } = await import("fast-xml-parser");
void XMLParser;

console.log("\nValidez XML:");
for (const name of names.filter((n) => /\.(xhtml|opf|ncx|xml)$/.test(n))) {
  const xml = await zip.file(name)!.async("string");
  const result = XMLValidator.validate(xml);
  check(
    `${name} es XML bien formado`,
    result === true,
  );
  if (result !== true) {
    console.log(`        ${JSON.stringify(result.err)}`);
  }
}

// 5. Los caracteres conflictivos del título llegan escapados, no crudos.
const opf = await zip.file("OEBPS/content.opf")!.async("string");
console.log("\nEscapado:");
check("el & del título va escapado", opf.includes("&amp;"));
check("no queda ningún & crudo en el OPF", !/&(?!(amp|lt|gt|quot|apos|#)\w*;)/.test(opf));

const chapter1 = await zip.file(chapterFiles[0])!.async("string");
check("las imágenes se cierran (<img .../>)", !/<img[^>]*[^/]>/.test(chapter1));
check("los <br> se cierran", !/<br\s*>/.test(chapter1));

// --- Imágenes embebidas -----------------------------------------------------
// Un EPUB se lee sin conexión: una imagen dejada como URL remota sale en blanco
// en cualquier lector offline y los validadores la marcan como recurso no
// declarado en el manifiesto.
console.log("\nImágenes:");

// JSZip lista también las carpetas como entradas, de ahí el filtro por `dir`.
const imageFiles = names.filter(
  (name) => name.startsWith("OEBPS/images/") && !zip.files[name].dir,
);
check(
  "solo se descarga la imagen que responde (la rota se omite)",
  imageFiles.length === 1,
  `entradas bajo OEBPS/images/: ${imageFiles.join(", ") || "ninguna"}`,
);

const chapter2 = await zip.file(chapterFiles[1])!.async("string");
check(
  "el <img> apunta a la copia local, no a la URL remota",
  chapter2.includes('src="images/') && !chapter2.includes(IMAGE_URL),
  chapter2.match(/<img[^>]*>/)?.[0],
);
check(
  "la imagen está declarada en el manifiesto del OPF",
  opf.includes('href="images/'),
);
check(
  "el manifiesto declara su media-type",
  /href="images\/[^"]+"\s+media-type="image\//.test(opf),
);

if (imageFiles.length === 1) {
  const bytes = await zip.file(imageFiles[0])!.async("uint8array");
  check(
    "el fichero embebido es un PNG real",
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e,
    `${bytes.length} bytes`,
  );
}

imageServer.close();

console.log(
  failures.length === 0
    ? `\n✅ EPUB válido. ${buffer.length} bytes en /tmp/nebula-test.epub`
    : `\n❌ ${failures.length} fallo(s):\n${failures.map((f) => ` - ${f}`).join("\n")}`,
);

process.exit(failures.length === 0 ? 0 : 1);
