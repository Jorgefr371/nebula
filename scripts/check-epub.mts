/**
 * Verificación del generador de EPUB. Comprueba las invariantes que, si se
 * incumplen, hacen que un lector rechace el fichero entero.
 */
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { buildEpub } from "@/lib/export/epub";
import type { Chapter, Ebook } from "@/lib/ebook/types";

const ebook: Ebook = {
  id: "3f1c2d4e-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
  owner_id: "owner",
  title: "Vender sin vender & otras “rarezas”",
  subtitle: "Un método para <consultores> impacientes",
  author: "Equipo Nébula",
  language: "es",
  description: "Cómo cerrar clientes sin sonar a comercial.",
  cover_path: null,
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
    content: "## Las tres preguntas\n\nTexto del capítulo dos.",
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
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALLO ${label}`);
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

console.log(
  failures.length === 0
    ? `\n✅ EPUB válido. ${buffer.length} bytes en /tmp/nebula-test.epub`
    : `\n❌ ${failures.length} fallo(s):\n${failures.map((f) => ` - ${f}`).join("\n")}`,
);

process.exit(failures.length === 0 ? 0 : 1);
