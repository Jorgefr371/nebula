/**
 * Temas de maquetación por nicho.
 *
 * El problema que resuelven: sin un tema, cada libro sale con la maquetación
 * que le tocó ese día. Dos ebooks del mismo nicho no se parecen entre sí, y eso
 * es exactamente lo contrario de lo que hace un catálogo que vende — donde el
 * segundo libro se reconoce como del mismo autor antes de leer el título.
 *
 * Los nichos salen de medir dónde está el mercado: de las 35 páginas de ventas
 * recogidas de la Biblioteca de Anuncios de Meta, casi la mitad son crianza y
 * educación infantil, y el resto se reparte entre salud, cocina, relaciones y
 * manualidades. No es una paleta de colores bonita: es la lista de nichos donde
 * de verdad se compra.
 *
 * Cada tema es un contrato pequeño y cerrado —tinta, papel, acento, dos
 * familias tipográficas— porque un tema con veinte variables acaba siendo
 * veinte decisiones que el agente toma mal. Elige el tema; no lo diseña.
 */

export type Theme = {
  id: string;
  /** Nombre que ve el usuario. */
  label: string;
  /** Para qué nicho es. Va en la descripción de la herramienta. */
  para: string;
  colors: {
    /** Color del texto principal. */
    ink: string;
    /** Fondo de la página impresa. */
    paper: string;
    /** Fondo de bloques destacados: fichas, tips, plantillas. */
    soft: string;
    /** El color de la marca: números de capítulo, filetes, cifras. */
    accent: string;
    /** Filetes y bordes. */
    rule: string;
  };
  fonts: {
    /** Titulares. */
    display: string;
    /** Texto corrido. */
    body: string;
  };
};

/**
 * Las familias son de sistema a propósito. Una webfont que no cargue se
 * sustituye en silencio, y el libro sale impreso con otra letra sin que nadie
 * se entere hasta que el PDF ya está vendido.
 */
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GROTESK = '"Helvetica Neue", Arial, system-ui, sans-serif';
const ROUNDED = '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif';

export const THEMES: Theme[] = [
  {
    id: "editorial",
    label: "Editorial",
    para: "El neutro. Ensayo, divulgación, cualquier libro que sea sobre todo texto.",
    colors: {
      ink: "#1B1A18",
      paper: "#FAF9F6",
      soft: "#F0EDE6",
      accent: "#8A5A2B",
      rule: "#D9D4C9",
    },
    fonts: { display: SERIF, body: SERIF },
  },
  {
    id: "culinario",
    label: "Culinario",
    para: "Recetarios, meal prep, nutrición práctica. Fichas repetidas y mucha tabla.",
    colors: {
      ink: "#22251C",
      paper: "#FBFAF5",
      soft: "#EEF1E4",
      accent: "#6F8F2E",
      rule: "#D5DBC4",
    },
    fonts: { display: GROTESK, body: SERIF },
  },
  {
    id: "bienestar",
    label: "Bienestar",
    para: "Salud, longevidad, hábitos, fitness. Donde el dato y la fuente pesan.",
    colors: {
      ink: "#16232A",
      paper: "#F8FBFB",
      soft: "#E6F0F1",
      accent: "#1F7A86",
      rule: "#C7DADD",
    },
    fonts: { display: SANS, body: SERIF },
  },
  {
    id: "crianza",
    label: "Crianza",
    para: "Maternidad, educación infantil, actividades para niños. El nicho más grande.",
    colors: {
      ink: "#2C2118",
      paper: "#FFFBF5",
      soft: "#FDEEDF",
      accent: "#D2703A",
      rule: "#F0D9C4",
    },
    fonts: { display: ROUNDED, body: SERIF },
  },
  {
    id: "negocio",
    label: "Negocio",
    para: "Marketing, ventas, productividad, dinero. Denso, con cifras y checklists.",
    colors: {
      ink: "#14181F",
      paper: "#F7F8FA",
      soft: "#E8ECF2",
      accent: "#B4531A",
      rule: "#CBD3DE",
    },
    fonts: { display: GROTESK, body: SANS },
  },
  {
    id: "creativo",
    label: "Creativo",
    para: "Manualidades, packs de prompts, plantillas. Unidades breves y muy visuales.",
    colors: {
      ink: "#241C29",
      paper: "#FCFAFD",
      soft: "#F1E9F3",
      accent: "#7B3F8C",
      rule: "#DFCFE4",
    },
    fonts: { display: ROUNDED, body: SANS },
  },
];

export const DEFAULT_THEME = "editorial";

export function getTheme(id: string | null | undefined): Theme {
  return (
    THEMES.find((theme) => theme.id === id) ??
    THEMES.find((theme) => theme.id === DEFAULT_THEME)!
  );
}

/**
 * Variables CSS del tema.
 *
 * Se aplican como estilo en línea sobre el contenedor del libro en vez de por
 * hoja de estilos: el mismo objeto sirve para el preview en React y para la
 * hoja incrustada en el EPUB, y así no hay dos definiciones del mismo tema
 * separándose con el tiempo.
 */
export function themeVariables(theme: Theme): Record<string, string> {
  return {
    "--book-ink": theme.colors.ink,
    "--book-paper": theme.colors.paper,
    "--book-soft": theme.colors.soft,
    "--book-accent": theme.colors.accent,
    "--book-rule": theme.colors.rule,
    "--book-display": theme.fonts.display,
    "--book-body": theme.fonts.body,
  };
}

/** Las mismas variables, como texto CSS para incrustar en el EPUB. */
export function themeCss(theme: Theme, selector = ":root"): string {
  const entries = Object.entries(themeVariables(theme))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
  return `${selector} {\n${entries}\n}`;
}
