import { getTheme } from "@/lib/ebook/themes";

/**
 * Papeles de imagen.
 *
 * El fallo que esto arregla: pedirle a un modelo "una ilustración de un husky
 * junto a una valla" devuelve una foto de archivo. Bonita, intercambiable, y
 * que no explica nada. Un capítulo titulado "problema → solución" no necesita
 * un retrato del perro: necesita un esquema de tres viñetas. Son dos imágenes
 * tan distintas que no pueden salir del mismo tipo de prompt.
 *
 * Así que la decisión que se le pide al agente no es "descríbeme una imagen"
 * sino "¿qué trabajo tiene que hacer esta imagen?". El andamiaje técnico
 * —técnica, encuadre, paleta, qué prohibir— lo pone el servidor, igual que ya
 * hace con image_style. El agente aporta el CONTENIDO; el registro visual no se
 * negocia turno a turno.
 *
 * Esto es también lo que evita que un libro mezcle registros: hoy el capítulo 1
 * sale con un esquema vectorial y el 3 con una fotografía de estudio, y el
 * conjunto parece un collage de dos libros distintos.
 *
 * Los diagramas heredan la paleta del tema del libro. Un esquema en azul acero
 * dentro de un libro de paleta cálida se ve pegado, por bien dibujado que esté.
 */

export type ImageRole =
  | "diagrama"
  | "secuencia"
  | "comparacion"
  | "anatomia"
  | "escena"
  | "seccion";

type RoleSpec = {
  /** Para qué sirve. Va en la descripción de la herramienta. */
  para: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  /** Andamiaje técnico. `palette` es la del tema del libro. */
  scaffold: (palette: Palette) => string;
};

type Palette = {
  ink: string;
  paper: string;
  soft: string;
  accent: string;
};

/**
 * Prohibición de texto, repetida en cada papel.
 *
 * Va literal y al final porque es la instrucción que más se ignora, y una sola
 * palabra mal escrita dentro de una imagen la inutiliza entera: no se puede
 * corregir sin regenerar. Los rótulos se ponen al maquetar, con tipografía de
 * verdad.
 */
const SIN_TEXTO =
  "ABSOLUTAMENTE NINGÚN texto, letra, número, rótulo, etiqueta, firma ni marca " +
  "de agua en ninguna parte de la imagen. Ni siquiera texto decorativo o " +
  "ilegible de fondo.";

/** Base común de los papeles esquemáticos. */
function esquema(palette: Palette, composicion: string): string {
  return [
    "Ilustración vectorial plana de estilo infográfico editorial.",
    "Formas geométricas simples y sólidas, contornos limpios, sin degradados, " +
      "sin sombras realistas, sin texturas fotográficas, sin tridimensionalidad.",
    `Paleta ESTRICTAMENTE limitada a estos colores: ${palette.accent} como color ` +
      `principal, ${palette.ink} para los trazos y las siluetas, ${palette.soft} ` +
      `para los rellenos secundarios, sobre fondo liso ${palette.paper}.`,
    composicion,
    "Margen interior generoso: ningún elemento toca ni se acerca a los bordes " +
      "del lienzo, y nada aparece recortado por el encuadre.",
    SIN_TEXTO,
  ].join(" ");
}

export const ROLES: Record<ImageRole, RoleSpec> = {
  diagrama: {
    para:
      "Un concepto que el texto explica peor: cómo se relacionan las partes de " +
      "un sistema, qué provoca qué, dónde va cada cosa.",
    size: "1024x1024",
    scaffold: (p) =>
      esquema(
        p,
        "Composición centrada y equilibrada, con los elementos dispuestos de " +
          "forma que se entienda la relación entre ellos de un vistazo.",
      ),
  },

  secuencia: {
    para:
      "Un proceso en pasos: antes, durante y después. El papel más útil de " +
      "todos, porque una secuencia en prosa obliga al lector a reconstruirla.",
    size: "1536x1024",
    scaffold: (p) =>
      esquema(
        p,
        "Composición en TRES viñetas alineadas en horizontal, del mismo tamaño, " +
          "separadas por flechas simples que van de izquierda a derecha. Cada " +
          "viñeta muestra una etapa distinta y claramente reconocible.",
      ),
  },

  comparacion: {
    para: "Dos opciones enfrentadas: lo correcto contra lo habitual, antes y después.",
    size: "1536x1024",
    scaffold: (p) =>
      esquema(
        p,
        "Composición partida en DOS mitades simétricas separadas por una línea " +
          "vertical fina y centrada. Cada mitad muestra una versión de la misma " +
          "escena, con una diferencia evidente entre ellas.",
      ),
  },

  anatomia: {
    para:
      "Las partes de una cosa: las zonas de un congelador, el material de un " +
      "kit, la estructura de algo. Sustituye a media página de enumeración.",
    size: "1024x1024",
    scaffold: (p) =>
      esquema(
        p,
        "UN SOLO objeto o espacio, visto en corte o despiece, grande y centrado, " +
          "con sus partes diferenciadas por color y separadas entre sí, dejando " +
          "hueco alrededor de cada una para rotularlas después. " +
          "NO es una secuencia: no dividas el lienzo en viñetas, ni repitas el " +
          "mismo objeto varias veces, ni muestres etapas en el tiempo.",
      ),
  },

  escena: {
    para:
      "Anclar un capítulo en una situación reconocible. Úsalo con cuentagotas: " +
      "es el papel que degenera en foto de archivo si el capítulo no pide una escena concreta.",
    size: "1536x1024",
    scaffold: () =>
      [
        "Fotografía editorial de alta calidad.",
        "Luz natural, profundidad de campo corta, encuadre cuidado y momento " +
          "concreto: una acción sucediendo, no una pose.",
        "Nada de aspecto de banco de imágenes: ni miradas a cámara, ni sonrisas " +
          "genéricas, ni composiciones perfectamente simétricas.",
        SIN_TEXTO,
      ].join(" "),
  },

  seccion: {
    para:
      "La portadilla que abre una parte del libro. Va a media página, con el " +
      "título encima al maquetar, así que necesita centro despejado.",
    size: "1536x1024",
    scaffold: (p) =>
      [
        "Imagen de apertura de sección, atmosférica y de lectura inmediata.",
        `Paleta dominada por ${p.accent} y ${p.ink}, coherente con el resto del libro.`,
        "Composición con el centro despejado y el interés visual en los bordes: " +
          "encima irá un título, y no puede competir con el fondo.",
        "Contraste suave, sin zonas de blanco puro ni negro puro en el centro.",
        SIN_TEXTO,
      ].join(" "),
  },
};

export const IMAGE_ROLES = Object.keys(ROLES) as ImageRole[];

export function isImageRole(value: unknown): value is ImageRole {
  return typeof value === "string" && value in ROLES;
}

/**
 * Monta el prompt final: papel + dirección de arte del libro + petición.
 *
 * El orden importa. El andamiaje del papel va PRIMERO porque decide la técnica
 * —vectorial plano contra fotografía— y es lo que el modelo debe fijar antes de
 * nada. La dirección de arte del libro se aplica después, y solo a los papeles
 * fotográficos: aplicarle "fotografía de luz cálida" a un diagrama vectorial es
 * pedirle dos cosas incompatibles, y el modelo resuelve el conflicto
 * devolviendo justo la foto de archivo que se quería evitar.
 */
export function buildImagePrompt(options: {
  role: ImageRole;
  prompt: string;
  themeId: string | null | undefined;
  imageStyle: string | null | undefined;
}): { prompt: string; size: string } {
  const spec = ROLES[options.role];
  const theme = getTheme(options.themeId);
  const fotografico = options.role === "escena";

  const parts = [
    spec.scaffold({
      ink: theme.colors.ink,
      paper: theme.colors.paper,
      soft: theme.colors.soft,
      accent: theme.colors.accent,
    }),
    fotografico && options.imageStyle?.trim()
      ? `Dirección de arte del libro (aplícala): ${options.imageStyle.trim()}.`
      : null,
    `Contenido de la imagen: ${options.prompt.trim()}`,
  ].filter(Boolean);

  return { prompt: parts.join("\n\n"), size: spec.size };
}
