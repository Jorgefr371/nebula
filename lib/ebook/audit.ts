import { countWords, type Chapter } from "@/lib/ebook/types";

/**
 * Detector de colapso de plantilla.
 *
 * Nace de medir un ebook real que se vendía: 68 recetas de las que solo 19
 * tenían pasos propios. Los capítulos 1 a 3 estaban escritos de verdad y a
 * partir del 4 el modelo se enganchó a una plantilla y la repitió — mismos
 * ingredientes, mismos pasos, misma tabla nutricional — hasta el final. Al
 * hojearlo no se nota: cada receta tiene su título, su foto y su número. Se
 * nota cuando alguien intenta cocinar la segunda y descubre que es la primera.
 *
 * Es el fallo más caro que puede cometer un generador de ebooks porque escala
 * con la longitud: cuanto más largo el libro, mayor la parte repetida, y la
 * longitud es justo lo que se promete en la página de ventas.
 *
 * Pedirle al modelo que no se repita no basta: el modelo que escribió esas 68
 * recetas también creía estar escribiendo 68 recetas. Hace falta medirlo.
 */

export type Finding = {
  /** `severity` ordena la salida: lo que rompe el libro va primero. */
  severity: "grave" | "aviso";
  message: string;
};

export type AuditReport = {
  findings: Finding[];
  /** Fracción de palabras que NO aparecen en otro capítulo. 1 = nada copiado. */
  originality: number;
};

/**
 * Normaliza para comparar: quita sintaxis Markdown, tildes, signos y números.
 *
 * Los números se van a propósito. La plantilla colapsada suele venir con la
 * numeración intacta ("1 Precalienta…", "2 Mezcla…"), y compararlos haría
 * pasar por distintos dos bloques idénticos con distinta numeración.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trocea en bloques: párrafos, ítems de lista y encabezados.
 *
 * La unidad de repetición es el bloque, no el capítulo. Dos recetas que
 * comparten los cinco pasos pero tienen títulos distintos son dos capítulos
 * poco parecidos y dos bloques idénticos; comparar solo capítulos enteros las
 * daría por buenas.
 */
function blocks(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n|\n(?=[-*+]\s|\d+[.)]\s|#{1,6}\s)/)
    .map(normalize)
    // Los bloques cortos se descartan: "## Ingredientes" o "Paso 1" se repiten
    // legítimamente en cualquier libro de fichas, y marcarlos sería ruido que
    // enseña a ignorar el informe.
    .filter((block) => block.split(" ").length >= 12);
}

/** Shingles de 6 palabras, para comparar capítulos que se parecen sin ser iguales. */
function shingles(text: string): Set<string> {
  const words = normalize(text).split(" ").filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + 6 <= words.length; i++) {
    set.add(words.slice(i, i + 6).join(" "));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

function list(positions: number[]): string {
  const shown = positions.slice(0, 8).join(", ");
  return positions.length > 8
    ? `${shown} y ${positions.length - 8} más`
    : shown;
}

/**
 * Marcadores que quedaron sin rellenar. La lista es corta y literal a
 * propósito: son las fórmulas que el modelo escribe cuando ya no está
 * redactando esa unidad concreta sino rellenando un molde.
 */
const PLACEHOLDERS = [
  "ingrediente principal",
  "segun receta",
  "cuando aplique",
  "segun corresponda",
  "lo que prefieras",
  "por definir",
  "pendiente",
  "todo",
  "lorem",
];

export function auditBook(chapters: Chapter[]): AuditReport {
  const findings: Finding[] = [];
  const written = chapters.filter((chapter) => chapter.content.trim());

  if (written.length < 2) {
    return { findings, originality: 1 };
  }

  // 1. Bloques idénticos entre capítulos distintos.
  //
  // No basta con contar bloques repetidos: una colección de fichas repite a
  // propósito los avisos de seguridad, las fórmulas de conservación y los
  // encabezados en todas sus unidades, y eso está bien. Lo que distingue el
  // repetir legítimo del colapso es la PROPORCIÓN: en una ficha sana la parte
  // común son dos frases de cien palabras; en una colapsada es la ficha entera.
  // Así que se mide, por capítulo, qué porcentaje de sus palabras vive en
  // bloques que también aparecen en otro capítulo.
  const owners = new Map<string, Set<number>>();
  for (const chapter of written) {
    for (const block of new Set(blocks(chapter.content))) {
      const set = owners.get(block);
      if (set) set.add(chapter.position);
      else owners.set(block, new Set([chapter.position]));
    }
  }

  let totalWords = 0;
  let sharedWords = 0;
  const contaminated: { position: number; ratio: number; with: number[] }[] = [];

  for (const chapter of written) {
    let own = 0;
    let shared = 0;
    const partners = new Set<number>();

    for (const block of new Set(blocks(chapter.content))) {
      const words = block.split(" ").length;
      own += words;
      const set = owners.get(block);
      if (set && set.size > 1) {
        shared += words;
        for (const position of set) {
          if (position !== chapter.position) partners.add(position);
        }
      }
    }

    totalWords += own;
    sharedWords += shared;
    if (own > 0 && shared / own >= 0.5) {
      contaminated.push({
        position: chapter.position,
        ratio: shared / own,
        with: [...partners].sort((a, b) => a - b),
      });
    }
  }

  const originality = totalWords > 0 ? 1 - sharedWords / totalWords : 1;

  // Se ordena por gravedad: el capítulo más copiado primero.
  for (const chapter of contaminated.sort((a, b) => b.ratio - a.ratio).slice(0, 6)) {
    findings.push({
      severity: "grave",
      message:
        `El capítulo ${chapter.position} es un ${Math.round(chapter.ratio * 100)}% texto ` +
        `copiado palabra por palabra de los capítulos ${list(chapter.with)}. ` +
        `Reescríbelo entero: necesita contenido propio, no una plantilla con el título cambiado.`,
    });
  }

  if (contaminated.length > 6) {
    findings.push({
      severity: "grave",
      message:
        `Hay ${contaminated.length} capítulos con este problema, no solo los listados arriba. ` +
        `El libro se está escribiendo sobre una plantilla: revísalo entero.`,
    });
  }

  // 2. Capítulos casi calcados aunque no compartan bloques exactos.
  const prints = written.map((chapter) => ({
    position: chapter.position,
    title: chapter.title,
    set: shingles(chapter.content),
  }));

  const nearDuplicates: string[] = [];
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const score = jaccard(prints[i].set, prints[j].set);
      if (score >= 0.5) {
        nearDuplicates.push(
          `${prints[i].position} y ${prints[j].position} (${Math.round(score * 100)}% común)`,
        );
      }
    }
  }

  if (nearDuplicates.length > 0) {
    findings.push({
      severity: "grave",
      message:
        `Capítulos casi calcados: ${nearDuplicates.slice(0, 6).join("; ")}` +
        (nearDuplicates.length > 6 ? ` y ${nearDuplicates.length - 6} pares más` : "") +
        ". Varían las palabras pero dicen lo mismo.",
    });
  }

  // 3. Marcadores sin rellenar.
  for (const chapter of written) {
    const plain = normalize(chapter.content);
    const found = PLACEHOLDERS.filter((marker) =>
      new RegExp(`\\b${marker}\\b`).test(plain),
    );
    if (found.length > 0) {
      findings.push({
        severity: "grave",
        message:
          `El capítulo ${chapter.position} ("${chapter.title}") tiene marcadores sin ` +
          `rellenar: ${found.map((f) => `"${f}"`).join(", ")}. Sustitúyelos por el dato real.`,
      });
    }
  }

  // 4. Capítulos demasiado cortos para estar escritos.
  const thin = written.filter((chapter) => countWords(chapter.content) < 120);
  if (thin.length > 0) {
    findings.push({
      severity: "aviso",
      message:
        `Capítulos por debajo de 120 palabras: ${list(thin.map((c) => c.position))}. ` +
        `Comprueba que sean breves a propósito y no esquemas a medio escribir.`,
    });
  }

  const empty = chapters.length - written.length;
  if (empty > 0) {
    findings.push({
      severity: "aviso",
      message: `${empty} capítulos del índice siguen vacíos.`,
    });
  }

  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "grave" ? -1 : 1));
  return { findings, originality };
}

/** Informe en texto para el tool_result. */
export function formatAudit(report: AuditReport): string {
  const percent = Math.round(report.originality * 100);

  if (report.findings.length === 0) {
    return `Revisión superada. Originalidad ${percent}%: no hay bloques repetidos entre capítulos.`;
  }

  return (
    `Originalidad ${percent}% (100% = ningún bloque repetido entre capítulos).\n\n` +
    report.findings
      .map((finding) => `[${finding.severity.toUpperCase()}] ${finding.message}`)
      .join("\n\n")
  );
}
