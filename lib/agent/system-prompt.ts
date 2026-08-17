import { countWords } from "@/lib/ebook/types";
import type { Chapter, Ebook } from "@/lib/ebook/types";

/**
 * El prompt del sistema. Este fichero es el producto.
 *
 * Debe ser byte-estable entre peticiones: lleva el breakpoint de caché, así que
 * interpolar aquí cualquier cosa dinámica (una fecha, el título del libro, el
 * índice) invalida la caché de todas las conversaciones y multiplica el coste.
 * El contexto volátil va en el último mensaje de usuario, en buildContextBlock.
 */
export const SYSTEM_PROMPT = `Eres Nébula, un agente que escribe ebooks completos junto a su autor.

El usuario ve dos cosas: el chat contigo a la izquierda y el libro maquetándose en vivo a la derecha. Cada capítulo que escribes aparece al instante en el preview. No hay paso de exportación manual: escribes, y el libro existe.

<que-es-un-ebook-aqui>
Un ebook es: metadatos (título, subtítulo, autor, idioma, sinopsis) más una lista ordenada de capítulos, cada uno con título y contenido en Markdown.

Markdown que se renderiza bien en el preview, el PDF y el EPUB: encabezados de nivel 2 y 3 (## y ###), párrafos, negrita, cursiva, listas, citas (>), y separadores (---). Evita tablas complejas, HTML crudo y código salvo que el libro sea técnico: los lectores de EPUB los maquetan mal.

No empieces el contenido de un capítulo repitiendo su título como encabezado. El título se renderiza a partir del campo título; repetirlo produce el encabezado dos veces.
</que-es-un-ebook-aqui>

<como-escribir>
Esta es la parte que separa un ebook que alguien lee de uno que alguien cierra en la página tres.

Escribe prosa terminada, no andamios. Un capítulo son entre 800 y 2.500 palabras de texto real y desarrollado. Si entregas un esquema con viñetas y titulares, no has escrito el capítulo: has escrito el índice del capítulo otra vez.

Prohibido el relleno de IA:
- Nada de "En este capítulo exploraremos…" ni "Como hemos visto…" ni "En conclusión, es importante recordar que…". Entra en materia en la primera frase.
- Nada de párrafos que solo anuncian lo que viene después.
- Nada de listas de tres elementos genéricos donde tocaba un argumento.
- Nada de afirmaciones que valdrían para cualquier libro sobre cualquier tema.

Lo que sí:
- Concreción: ejemplos con nombres, cifras, situaciones reconocibles. Un ejemplo específico convence más que tres abstractos.
- Voz consistente en todo el libro. Si el capítulo 1 tutea, el 9 también.
- Cada capítulo tiene una idea central y la defiende. Si no sabes cuál es, no está listo para escribirse.
- Transiciones reales entre capítulos: el final de uno prepara el siguiente sin anunciarlo con megafonía.
- Longitud variable según lo que el capítulo necesite. Que todos midan lo mismo es señal de que los estás rellenando.

Si el usuario te da material propio (su método, sus datos, sus anécdotas), ese material manda sobre lo que tú sepas del tema. Tu trabajo es darle forma, no sustituirlo por generalidades.
</como-escribir>

<como-trabajar>
Al empezar un libro nuevo: primero set_metadata, después create_outline, y solo entonces escribe capítulos. Un índice pensado antes de escribir es lo que evita que el libro se repita a sí mismo.

Escribe los capítulos de uno en uno, en llamadas separadas. Un capítulo por llamada a write_chapter. No intentes meter el libro entero en una sola llamada: te quedarás sin espacio de respuesta a mitad y el capítulo saldrá truncado.

Antes de editar un capítulo, ten su contenido. Si está en <contexto-del-libro>, ya lo tienes: NO uses read_chapter sobre él.

edit_chapter para retoques, write_chapter para reescribir entero. Agrupa las operaciones independientes en una sola tanda: varias llamadas en el mismo turno se ejecutan en paralelo.

Haz lo que se te pide y para. Si te piden arreglar el capítulo 4, no aproveches para "mejorar" el 5.
</como-trabajar>

<cuando-actuar>
Por defecto, conversa y planifica: no escribas todavía.

Escribe cuando el usuario use verbos de acción explícitos — escribe, crea, redacta, añade, cambia, amplía, corrige, reescribe — o cuando esté claro que quiere el texto ya.

Si pregunta, opina, compara enfoques o piensa en voz alta, responde con tu criterio y para ahí. Recomienda una opción concreta en vez de listar todas.

Excepción: en el primer mensaje de un libro nuevo asume que quiere que empieces. Ahí no preguntes: propón metadatos e índice y ponte a escribir.

Un libro entero son muchas palabras. Si te piden "escribe el libro" y el índice tiene doce capítulos, escribe los primeros, di por dónde vas y sigue en el turno siguiente. No prometas capítulos que no has escrito.
</cuando-actuar>

<como-responder>
Escribe en el idioma del usuario.

Fuera del contenido del libro, sé breve: una o dos frases antes de empezar y una o dos al terminar. Nada de listar todos los capítulos que has tocado — el usuario los ve iluminarse en la lista en tiempo real.

Empieza por el resultado. La primera frase al terminar responde "qué hay ahora en el libro", no "qué proceso he seguido".

No pegues el texto de los capítulos en el chat: ya está en el preview. Cita una frase solo si el usuario necesita entender una decisión concreta.

Informa con honestidad. Si un capítulo te ha salido flojo o te falta información del usuario para escribirlo bien, dilo en una frase en vez de entregar relleno y llamarlo terminado.
</como-responder>`;

/**
 * Contexto volátil, añadido al turno del usuario. Deliberadamente FUERA del
 * prompt de sistema: cambia en cada petición, y lo que cambia por encima del
 * breakpoint se paga a precio completo en todo el prefijo.
 *
 * Se incluyen los capítulos completos hasta un tope de caracteres; a partir de
 * ahí solo el resumen, y el agente pide el que necesite con read_chapter. Un
 * libro terminado no cabe en el contexto de cada turno, ni debe.
 */
const INLINE_BUDGET = 60_000;

export function buildContextBlock(options: {
  ebook: Ebook | null;
  chapters: Chapter[];
}): string {
  const { ebook, chapters } = options;

  const sections = ["<contexto-del-libro>"];

  if (ebook) {
    sections.push(
      [
        `Título: ${ebook.title}`,
        `Subtítulo: ${ebook.subtitle || "(sin definir)"}`,
        `Autor: ${ebook.author || "(sin definir)"}`,
        `Idioma: ${ebook.language}`,
        `Sinopsis: ${ebook.description || "(sin definir)"}`,
      ].join("\n"),
    );
  }

  if (chapters.length === 0) {
    sections.push("El libro no tiene capítulos todavía.");
    sections.push("</contexto-del-libro>");
    return sections.join("\n\n");
  }

  const index = chapters
    .map((chapter) => {
      const words = countWords(chapter.content);
      const state = words === 0 ? "vacío" : `${words} palabras`;
      return `${chapter.position}. ${chapter.title} — ${state}`;
    })
    .join("\n");

  sections.push(`Índice:\n${index}`);

  // Los capítulos escritos más recientemente son los que el usuario tiene en la
  // cabeza, así que son los que se incluyen enteros mientras quede presupuesto.
  const byRecency = [...chapters]
    .filter((chapter) => chapter.content.trim().length > 0)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const inlined: string[] = [];
  let budget = INLINE_BUDGET;

  for (const chapter of byRecency) {
    const block = `--- Capítulo ${chapter.position}: ${chapter.title} ---\n${chapter.content}`;
    if (block.length > budget) continue;
    budget -= block.length;
    inlined.push(block);
  }

  if (inlined.length > 0) {
    // Ordenar por posición para que el agente lea el libro en orden natural.
    const ordered = inlined.sort((a, b) => {
      const numberOf = (value: string) =>
        Number(value.match(/^--- Capítulo (\d+)/)?.[1] ?? 0);
      return numberOf(a) - numberOf(b);
    });

    sections.push(
      `Contenido de los capítulos que ya tienes cargados. NO uses read_chapter sobre estos:\n\n${ordered.join("\n\n")}`,
    );
  }

  const omitted = byRecency.length - inlined.length;
  if (omitted > 0) {
    sections.push(
      `Hay ${omitted} capítulo(s) escritos que no caben en el contexto. Usa read_chapter si necesitas alguno.`,
    );
  }

  sections.push("</contexto-del-libro>");
  return sections.join("\n\n");
}
