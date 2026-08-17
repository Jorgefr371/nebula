/**
 * Herramientas del agente escritor de ebooks.
 *
 * EL ORDEN IMPORTA. Las herramientas se renderizan en la posición 0 del prompt,
 * antes del bloque de sistema, así que cualquier cambio en este array —incluido
 * reordenarlo— invalida la caché de prompt de todas las conversaciones. Las
 * nuevas se añaden AL FINAL; esta lista no se ordena nunca.
 *
 * Todas son `strict: true`: un payload mal formado en `edit_chapter` es un
 * capítulo corrupto en la base de datos, así que compensa pagar la validación.
 */

export type ToolDefinition = {
  name: string;
  description: string;
  strict: true;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "set_metadata",
    description:
      "Fija los metadatos del ebook: título, subtítulo, autor, idioma y " +
      "descripción comercial. Hazlo al principio, en cuanto sepas de qué va el " +
      "libro. Envía cadena vacía en los campos que no quieras cambiar.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del libro." },
        subtitle: { type: "string", description: "Subtítulo. Vacío si no hay." },
        author: { type: "string", description: "Nombre del autor o autora." },
        language: {
          type: "string",
          description: "Código ISO del idioma, p. ej. 'es' o 'en'.",
        },
        description: {
          type: "string",
          description:
            "Sinopsis de 2-4 frases, del tipo que iría en la contraportada.",
        },
      },
      required: ["title", "subtitle", "author", "language", "description"],
      additionalProperties: false,
    },
  },
  {
    name: "create_outline",
    description:
      "Crea la estructura del libro de una vez: la lista ordenada de capítulos " +
      "con su título. REEMPLAZA cualquier estructura previa, así que úsalo al " +
      "empezar un libro, no para añadir un capítulo suelto. Los capítulos nacen " +
      "vacíos; después los escribes uno a uno con write_chapter.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        chapters: {
          type: "array",
          description: "Títulos de los capítulos, en orden de lectura.",
          items: { type: "string" },
        },
      },
      required: ["chapters"],
      additionalProperties: false,
    },
  },
  {
    name: "list_chapters",
    description:
      "Lista los capítulos con su posición, título, número de palabras y si " +
      "están escritos o vacíos. Es la forma barata de saber por dónde vas sin " +
      "leer el contenido.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "read_chapter",
    description:
      "Lee el contenido completo de un capítulo. Necesario antes de editarlo si " +
      "no lo tienes ya en el contexto.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        position: {
          type: "integer",
          description: "Posición del capítulo, empezando en 1.",
        },
      },
      required: ["position"],
      additionalProperties: false,
    },
  },
  {
    name: "write_chapter",
    description:
      "Escribe (o reescribe entero) el contenido de un capítulo en Markdown. " +
      "Escribe el capítulo COMPLETO: prosa real y desarrollada, no un esquema " +
      "ni un resumen. Si el capítulo ya tiene contenido y solo quieres cambiar " +
      "un fragmento, usa edit_chapter.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        position: {
          type: "integer",
          description: "Posición del capítulo, empezando en 1.",
        },
        content: {
          type: "string",
          description:
            "Contenido en Markdown. No repitas el título del capítulo como " +
            "encabezado: ya se renderiza a partir del título.",
        },
      },
      required: ["position", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_chapter",
    description:
      "Sustituye un fragmento exacto dentro de un capítulo. old_string debe " +
      "aparecer una sola vez; si aparece cero o varias veces la herramienta " +
      "falla sin tocar nada. Para retoques es mucho más barato que reescribir.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        position: { type: "integer", description: "Posición del capítulo." },
        old_string: {
          type: "string",
          description: "Texto exacto a reemplazar.",
        },
        new_string: { type: "string", description: "Texto de reemplazo." },
      },
      required: ["position", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  {
    name: "add_chapter",
    description:
      "Inserta un capítulo nuevo en una posición concreta, desplazando los " +
      "siguientes. Para añadir al final, usa una posición mayor que el número " +
      "de capítulos actual.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        position: {
          type: "integer",
          description: "Posición en la que insertarlo, empezando en 1.",
        },
        title: { type: "string", description: "Título del capítulo." },
        content: {
          type: "string",
          description: "Contenido en Markdown. Vacío si lo escribes después.",
        },
      },
      required: ["position", "title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_chapter",
    description: "Cambia el título de un capítulo sin tocar su contenido.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        position: { type: "integer", description: "Posición del capítulo." },
        title: { type: "string", description: "Título nuevo." },
      },
      required: ["position", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_chapter",
    description:
      "Borra un capítulo y recoloca los siguientes para que no queden huecos.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        position: { type: "integer", description: "Posición del capítulo." },
      },
      required: ["position"],
      additionalProperties: false,
    },
  },
  {
    name: "move_chapter",
    description:
      "Mueve un capítulo de una posición a otra, recolocando el resto. Úsalo " +
      "para reordenar el libro sin reescribir nada.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        from: { type: "integer", description: "Posición actual." },
        to: { type: "integer", description: "Posición destino." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** Etiqueta legible para el indicador de actividad del chat. */
export const TOOL_LABELS: Record<string, string> = {
  set_metadata: "Definiendo el libro",
  create_outline: "Creando la estructura",
  list_chapters: "Revisando el índice",
  read_chapter: "Releyendo",
  write_chapter: "Escribiendo",
  edit_chapter: "Puliendo",
  add_chapter: "Añadiendo capítulo",
  rename_chapter: "Retitulando",
  delete_chapter: "Borrando capítulo",
  move_chapter: "Reordenando",
};
