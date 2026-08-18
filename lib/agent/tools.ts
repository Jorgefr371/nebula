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
        theme: {
          type: "string",
          description:
            "Tema de maquetación, por nicho. Fija paleta y tipografía en el " +
            "preview, el PDF y el EPUB. Elígelo al crear el libro y no lo " +
            "cambies a mitad. Valores: editorial (neutro, ensayo y " +
            "divulgación), culinario (recetarios y meal prep), bienestar " +
            "(salud, longevidad, hábitos), crianza (maternidad y educación " +
            "infantil), negocio (marketing, ventas, productividad), creativo " +
            "(manualidades, packs de prompts y plantillas).",
        },
        image_style: {
          type: "string",
          description:
            "Dirección de arte común a TODAS las imágenes del libro: técnica, " +
            "paleta, luz y tratamiento. Se antepone automáticamente a cada " +
            "prompt de imagen, así que no hace falta repetirla. Ejemplo: " +
            "'fotografía editorial, luz natural cálida, profundidad de campo " +
            "corta, paleta tierra y azul frío, sin texto'. Defínela antes de " +
            "generar la primera imagen.",
        },
      },
      required: [
        "title",
        "subtitle",
        "author",
        "language",
        "description",
        "theme",
        "image_style",
      ],
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
  {
    name: "generate_image",
    description:
      "Genera una ilustración y la sube al libro. Devuelve el Markdown listo " +
      "para insertar. Antes de llamarla, decide QUÉ TRABAJO hace la imagen: ese " +
      "es el parámetro rol, y es el que decide la técnica. Una imagen que solo " +
      "repite en foto lo que dice el texto no aporta nada y engorda el fichero.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        rol: {
          type: "string",
          description:
            "Qué trabajo hace la imagen. El servidor monta la técnica, el " +
            "encuadre y la paleta a partir de esto, así que no describas el " +
            "estilo en el prompt. Valores: " +
            "diagrama (cómo se relacionan las partes de un sistema); " +
            "secuencia (un proceso en tres pasos, de izquierda a derecha — el " +
            "más útil, porque una secuencia en prosa obliga a reconstruirla); " +
            "comparacion (dos opciones enfrentadas, antes y después); " +
            "anatomia (las partes de una cosa, con hueco para rotularlas); " +
            "escena (fotografía que ancla el capítulo en una situación — úsalo " +
            "poco: es el que degenera en foto de archivo); " +
            "seccion (portadilla que abre una parte, con el centro despejado).",
        },
        prompt: {
          type: "string",
          description:
            "QUÉ se ve, no cómo está hecho. Los elementos concretos y su " +
            "relación: 'un perro ante una puerta entreabierta; la misma puerta " +
            "con una barrera de seguridad; una persona entrando con las manos " +
            "ocupadas'. Nada de técnica, estilo, luz ni paleta: eso lo pone el rol.",
        },
        alt: {
          type: "string",
          description:
            "Texto alternativo: qué se ve, para lectores de pantalla y para " +
            "cuando la imagen no carga. Una frase descriptiva, no el prompt.",
        },
      },
      required: ["rol", "prompt", "alt"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_cover",
    description:
      "Genera la portada del libro y la asigna directamente: no hay que " +
      "insertarla en ningún capítulo. Formato vertical. Hazlo cuando el libro " +
      "tenga ya título y tema claros. No pongas el título dentro de la imagen: " +
      "se superpone al maquetar y los modelos escriben mal el texto.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Descripción visual de la portada: sujeto, estilo, paleta y " +
            "atmósfera. Sin texto ni letras dentro de la imagen.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "audit_book",
    description:
      "Revisa el libro entero buscando repeticiones entre capítulos, " +
      "marcadores sin rellenar y capítulos demasiado cortos. Ejecútalo " +
      "obligatoriamente antes de dar el libro por terminado, y también cada " +
      "vez que lleves unos diez capítulos escritos: el riesgo de acabar " +
      "repitiendo una plantilla crece con la longitud del libro y no se ve " +
      "desde dentro de un capítulo.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "compose_cover",
    description:
      "Monta la portada de venta: coge la imagen creada por generate_cover y le " +
      "dibuja encima la tipografía, la cinta de beneficios y el sello. Devuelve " +
      "un PNG que se descarga solo y sirve para el anuncio, la página de ventas " +
      "y la miniatura de la tienda. Ejecútalo SIEMPRE después de generate_cover: " +
      "una foto sin texto no es una portada, y es lo único que el comprador ve " +
      "antes de pagar. El texto lo escribes tú aquí; no lo pidas dentro de la " +
      "imagen, que es donde los modelos lo deforman.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        kicker: {
          type: "string",
          description:
            "Antetítulo en versales, la promesa en cinco palabras: 'COME " +
            "SALUDABLE, AHORRA TIEMPO'. Cadena vacía si no aplica.",
        },
        title: {
          type: "string",
          description: "Primera parte del título, en blanco.",
        },
        highlight: {
          type: "string",
          description:
            "Segunda parte del título, en el color de acento. Vacío si el " +
            "título va de una pieza. Pártelo por donde caiga el énfasis.",
        },
        script: {
          type: "string",
          description:
            "Línea en cursiva bajo el título, en caja mixta: 'para Congelar'. " +
            "Vacío si no hay.",
        },
        ribbon: {
          type: "array",
          description:
            "Palabras de la cinta, que resumen el método en verbos: " +
            "['ORGANIZA','PREPARA','CONGELA','DISFRUTA']. Vacío si no hay.",
          items: { type: "string" },
        },
        promise: {
          type: "string",
          description:
            "La promesa de RESULTADO, en una o dos líneas: qué consigue quien " +
            "lo compre. Va sobre el panel inferior. Todas las portadas que " +
            "venden la llevan — 'para desbloquear ideas infinitas de contenido " +
            "que te ayuden a viralizar tu negocio y vender más', 'alcanzar el " +
            "éxito en tus redes sociales en 30 días'. Di el resultado y, si lo " +
            "hay, el plazo. No el tema. Vacío si no aplica.",
        },
        benefits: {
          type: "array",
          description:
            "Beneficios del panel inferior, de dos o tres palabras cada uno. " +
            "Máximo cinco: a partir de ahí no se leen en miniatura.",
          items: { type: "string" },
        },
        badge_number: {
          type: "string",
          description:
            "Cifra del sello: '68'. Tiene que ser el número REAL de unidades " +
            "del libro: es lo que el comprador va a contar. Vacío si no hay sello.",
        },
        badge_label: {
          type: "string",
          description: "Etiqueta bajo la cifra: 'recetas'. Vacío si no hay sello.",
        },
        accent: {
          type: "string",
          description:
            "Color de acento en hexadecimal (#RRGGBB) para el destacado, la " +
            "cinta y el sello. Sácalo del propio fondo para que la portada se " +
            "lea como una sola pieza.",
        },
      },
      required: [
        "kicker",
        "title",
        "highlight",
        "script",
        "ribbon",
        "promise",
        "benefits",
        "badge_number",
        "badge_label",
        "accent",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "compose_creative",
    description:
      "Monta un creativo de venta: coge una imagen ya generada y le dibuja " +
      "encima titular, subtítulo y marcadores con tipografía real. Devuelve un " +
      "PNG vertical 4:5, el formato del feed de Meta e Instagram. Sirve para " +
      "abrir una sección del libro, para la página de ventas y para el anuncio. " +
      "Una imagen sin texto comunica un tema; un creativo comunica una " +
      "intención de compra, y es lo que separa un ebook que parece hecho con " +
      "prisa de uno que parece un producto.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        image_url: {
          type: "string",
          description:
            "URL de la imagen de fondo, tal y como la devolvió generate_image. " +
            "Para 'antes-despues' usa una imagen generada con rol comparacion: " +
            "ya viene partida en dos mitades y los rótulos caen en su sitio.",
        },
        layout: {
          type: "string",
          description:
            "gancho (el dolor en titular grande sobre la imagen; abre una " +
            "sección o un anuncio); antes-despues (la transformación, con " +
            "rótulo y pie en cada mitad — es la que convierte); beneficios " +
            "(qué se lleva el lector, en lista con marcas de verificación).",
        },
        kicker: {
          type: "string",
          description: "Antetítulo corto en versales. Vacío si no hay.",
        },
        headline: {
          type: "string",
          description:
            "El titular. En 'gancho' es el DOLOR dicho con las palabras del " +
            "lector, no el tema: 'Se te escapa cada vez que abres la puerta' " +
            "funciona; 'seguridad en el hogar' no.",
        },
        subheadline: {
          type: "string",
          description: "Una línea de apoyo. Vacía si no hace falta.",
        },
        before_label: {
          type: "string",
          description: "Rótulo de la mitad izquierda: 'Antes'. Solo en antes-despues.",
        },
        before_caption: {
          type: "string",
          description: "Pie de la mitad izquierda: qué pasa hoy. Solo en antes-despues.",
        },
        after_label: {
          type: "string",
          description: "Rótulo de la mitad derecha: 'Después'. Solo en antes-despues.",
        },
        after_caption: {
          type: "string",
          description: "Pie de la mitad derecha: qué pasa al aplicarlo.",
        },
        benefits: {
          type: "array",
          description:
            "Hasta cinco beneficios, uno por línea. Dichos en resultado, no en " +
            "característica. Solo en el layout beneficios.",
          items: { type: "string" },
        },
        accent: {
          type: "string",
          description:
            "Color de acento en hexadecimal (#RRGGBB). El mismo en todos los " +
            "creativos del libro, y a juego con su tema.",
        },
      },
      required: [
        "image_url",
        "layout",
        "kicker",
        "headline",
        "subheadline",
        "before_label",
        "before_caption",
        "after_label",
        "after_caption",
        "benefits",
        "accent",
      ],
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
  generate_image: "Generando ilustración",
  generate_cover: "Diseñando la portada",
  audit_book: "Revisando el libro",
  compose_cover: "Montando la portada",
  compose_creative: "Montando el creativo",
};
