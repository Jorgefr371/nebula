import {
  fitFontSize,
  wrapLines,
  type Measure,
} from "@/lib/cover/compose";

/**
 * Compositor de creativos.
 *
 * El salto que faltaba. Nébula sabía generar ilustraciones y componer una
 * portada; entre medias no había nada. Y "entre medias" es donde vive lo que de
 * verdad vende: la sección de página de venta.
 *
 * Medido en las herramientas que hacen esto bien —Ecom Magic produce secciones
 * de landing como imágenes de 1792×2400 con el texto dentro— y en los ebooks
 * validados que ya analizamos: las páginas interiores de "Contenido
 * Inteligente" y "Raíces Poderosas" no son fotos con un pie, son piezas
 * compuestas con titular grande, subtítulo y marcadores encima de la imagen.
 * Una imagen sin texto no comunica una intención de venta; comunica un tema.
 *
 * Tres disposiciones, que son las tres que hacen el trabajo:
 *   gancho        — el dolor, en titular grande. Abre.
 *   antes-despues — la transformación. Es la que convierte.
 *   beneficios    — qué se lleva el lector. Cierra.
 *
 * El texto se dibuja sobre canvas, no se le pide al modelo de imagen: es la
 * misma razón que en la portada, y aquí pesa más, porque un creativo lleva más
 * texto y cada palabra deformada lo inutiliza.
 *
 * Formato 4:5 vertical, que es el que ocupa más pantalla en el feed de Meta e
 * Instagram, de donde sale el tráfico de este tipo de producto.
 */

export const CREATIVE_WIDTH = 1080;
export const CREATIVE_HEIGHT = 1350;

const MARGIN = 68;

const DISPLAY = '"Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif';
const UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export type CreativeLayout = "gancho" | "antes-despues" | "beneficios";

export const CREATIVE_LAYOUTS: CreativeLayout[] = [
  "gancho",
  "antes-despues",
  "beneficios",
];

export type CreativeSpec = {
  layout: CreativeLayout;
  /** Antetítulo corto en versales. Vacío si no hay. */
  kicker: string;
  /** El titular. En "gancho" es el dolor; en los demás, la promesa. */
  headline: string;
  /** Una línea de apoyo bajo el titular. Vacía si no hay. */
  subheadline: string;
  /** Solo en antes-despues: los rótulos y el pie de cada mitad. */
  beforeLabel: string;
  beforeCaption: string;
  afterLabel: string;
  afterCaption: string;
  /** Solo en beneficios: hasta cinco, con marca de verificación. */
  benefits: string[];
  accent: string;
};

/** Color legible sobre el acento, según su luminancia. */
export function contrastOn(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // Luminancia relativa, aproximada con los coeficientes de sRGB.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#FFFFFF";
}

export type CreativeLayoutResult = {
  /** Franja de imagen visible, en píxeles desde arriba. */
  imageBand: { top: number; height: number };
  /** Bloque de titular, ya partido en líneas. */
  headline: { lines: string[]; fontSize: number; y: number } | null;
  kicker: { text: string; fontSize: number; y: number } | null;
  sub: { lines: string[]; fontSize: number; y: number } | null;
  /** Solo antes-despues: la línea divisoria vertical de la imagen. */
  divider: number | null;
  benefits: { text: string; y: number; fontSize: number }[];
};

/**
 * Reparte el lienzo. Puro: decide bandas y coordenadas, no dibuja.
 *
 * Cada disposición reserva una fracción distinta para la imagen. El gancho le
 * da casi todo porque el titular va encima; los beneficios le dan la mitad
 * porque debajo hay una lista que tiene que respirar.
 */
export function layoutCreative(
  spec: CreativeSpec,
  measure: Measure,
  width = CREATIVE_WIDTH,
  height = CREATIVE_HEIGHT,
): CreativeLayoutResult {
  const content = width - MARGIN * 2;

  const imageFraction =
    spec.layout === "gancho" ? 1 : spec.layout === "antes-despues" ? 0.6 : 0.52;
  const imageBand = { top: 0, height: Math.round(height * imageFraction) };

  // Dónde empieza el texto. En el gancho va superpuesto sobre la imagen, en el
  // tercio inferior; en las otras dos, debajo de la banda.
  let cursor =
    spec.layout === "gancho" ? Math.round(height * 0.58) : imageBand.height + 54;

  let kicker: CreativeLayoutResult["kicker"] = null;
  if (spec.kicker.trim()) {
    const size = fitFontSize(measure, spec.kicker.toUpperCase(), content * 0.85, {
      max: 30,
      min: 15,
      font: UI,
    });
    cursor += size;
    kicker = { text: spec.kicker.toUpperCase(), fontSize: size, y: cursor };
    cursor += size * 0.7;
  }

  // La lista de beneficios se reserva ANTES que el titular y se ancla abajo.
  // Apilando de arriba abajo, un titular de tres líneas dejaba a la lista 130
  // píxeles y salía a cuerpo 11: ilegible. Aquí la lista fija su altura y el
  // titular se ajusta a lo que quede, que es el orden correcto de prioridades
  // en un creativo de beneficios.
  const listaBeneficios =
    spec.layout === "beneficios"
      ? spec.benefits.slice(0, 5).map((b) => b.trim()).filter(Boolean)
      : [];
  const beneficiosAltura = listaBeneficios.length > 0 ? listaBeneficios.length * 74 + 20 : 0;
  const suelo = height - MARGIN - beneficiosAltura;

  let headline: CreativeLayoutResult["headline"] = null;
  if (spec.headline.trim()) {
    // El cuerpo lo marca la palabra más larga, ya en versales: medir en caja
    // mixta y dibujar en versales deja el titular desbordado por la derecha.
    const longest = spec.headline
      .toUpperCase()
      .split(/\s+/)
      .reduce((a, b) => (measure(a, 100, DISPLAY) >= measure(b, 100, DISPLAY) ? a : b), "");

    let size = fitFontSize(measure, longest, content, { max: 96, min: 30 });
    let lines = wrapLines(measure, spec.headline.toUpperCase(), content, size);

    // Si el titular no cabe en el hueco que queda sobre la lista, se reduce
    // hasta que quepa. Un titular algo menor se lee; una lista pisada, no.
    const disponible = suelo - cursor - (spec.subheadline.trim() ? 90 : 0);
    while (size > 30 && lines.length * size * 1.06 > disponible) {
      size -= 4;
      lines = wrapLines(measure, spec.headline.toUpperCase(), content, size);
    }

    cursor += size;
    headline = { lines, fontSize: size, y: cursor };
    cursor += size * 1.06 * (lines.length - 1) + size * 0.45;
  }

  let sub: CreativeLayoutResult["sub"] = null;
  if (spec.subheadline.trim()) {
    const size = fitFontSize(measure, spec.subheadline, content * 0.5, {
      max: 38,
      min: 17,
      font: UI,
    });
    const lines = wrapLines(measure, spec.subheadline, content, size, UI);
    cursor += size;
    sub = { lines, fontSize: size, y: cursor };
    cursor += size * 1.35 * (lines.length - 1) + size * 0.6;
  }

  const benefits: CreativeLayoutResult["benefits"] = [];
  if (listaBeneficios.length > 0) {
    // Todos al mismo cuerpo: el más largo manda. Cuerpos distintos en una lista
    // de beneficios se leen como jerarquía y aquí no la hay.
    const size = Math.min(
      32,
      ...listaBeneficios.map((text) =>
        fitFontSize(measure, text, content - 76, { max: 32, min: 18, font: UI }),
      ),
    );
    listaBeneficios.forEach((text, index) => {
      benefits.push({ text, fontSize: size, y: suelo + 74 * (index + 0.7) });
    });
  }

  return {
    imageBand,
    kicker,
    headline,
    sub,
    divider: spec.layout === "antes-despues" ? Math.round(width / 2) : null,
    benefits,
  };
}

/* ------------------------------------------------------------------------ */

function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, fontSize, font) => {
    ctx.font = `900 ${fontSize}px ${font}`;
    return ctx.measureText(text).width;
  };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Rótulo en píldora, como los ANTES / DESPUÉS de un creativo de Meta. */
function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  background: string,
) {
  const size = 30;
  ctx.font = `800 ${size}px ${UI}`;
  ctx.letterSpacing = "0.1em";
  const w = ctx.measureText(text.toUpperCase()).width + 52;
  const h = 58;

  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();

  ctx.fillStyle = contrastOn(background);
  ctx.textAlign = "center";
  ctx.fillText(text.toUpperCase(), cx, cy + size * 0.36);
  ctx.letterSpacing = "0em";
}

export async function composeCreative(
  spec: CreativeSpec,
  backgroundUrl: string,
): Promise<Blob> {
  const response = await fetch(backgroundUrl, { mode: "cors" });
  if (!response.ok) {
    throw new Error(
      `No se pudo leer la imagen de fondo (HTTP ${response.status}). ` +
        "Genera primero la imagen con generate_image.",
    );
  }
  const bitmap = await createImageBitmap(await response.blob());

  const canvas = document.createElement("canvas");
  canvas.width = CREATIVE_WIDTH;
  canvas.height = CREATIVE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no permitió crear el canvas 2D.");

  const layout = layoutCreative(spec, canvasMeasure(ctx));
  const sobreImagen = spec.layout === "gancho";

  // Fondo del lienzo: bajo la banda de imagen, cuando la hay.
  ctx.fillStyle = "#0E0E10";
  ctx.fillRect(0, 0, CREATIVE_WIDTH, CREATIVE_HEIGHT);

  drawCoverImage(
    ctx,
    bitmap,
    0,
    layout.imageBand.top,
    CREATIVE_WIDTH,
    layout.imageBand.height,
  );
  bitmap.close();

  if (sobreImagen) {
    // Velo: el titular va encima de la foto, y sin esto depende de que la foto
    // salga oscura por abajo. Basta una imagen clara para perder el titular.
    const veil = ctx.createLinearGradient(0, CREATIVE_HEIGHT * 0.34, 0, CREATIVE_HEIGHT);
    veil.addColorStop(0, "rgba(8,8,10,0)");
    veil.addColorStop(0.42, "rgba(8,8,10,0.72)");
    veil.addColorStop(1, "rgba(8,8,10,0.95)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, CREATIVE_HEIGHT * 0.34, CREATIVE_WIDTH, CREATIVE_HEIGHT * 0.66);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (layout.kicker) {
    ctx.font = `800 ${layout.kicker.fontSize}px ${UI}`;
    ctx.letterSpacing = "0.16em";
    ctx.fillStyle = spec.accent;
    ctx.fillText(layout.kicker.text, MARGIN, layout.kicker.y);
    ctx.letterSpacing = "0em";
  }

  if (layout.headline) {
    ctx.font = `900 ${layout.headline.fontSize}px ${DISPLAY}`;
    ctx.fillStyle = "#FFFFFF";
    layout.headline.lines.forEach((line, index) =>
      ctx.fillText(
        line,
        MARGIN,
        layout.headline!.y + index * layout.headline!.fontSize * 1.06,
      ),
    );
  }

  if (layout.sub) {
    ctx.font = `500 ${layout.sub.fontSize}px ${UI}`;
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    layout.sub.lines.forEach((line, index) =>
      ctx.fillText(line, MARGIN, layout.sub!.y + index * layout.sub!.fontSize * 1.35),
    );
  }

  if (spec.layout === "antes-despues" && layout.divider !== null) {
    const band = layout.imageBand;

    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(layout.divider, band.top);
    ctx.lineTo(layout.divider, band.top + band.height);
    ctx.stroke();

    // El "antes" en gris y el "después" en el acento: la jerarquía de color
    // hace el trabajo antes de que nadie lea los rótulos.
    if (spec.beforeLabel.trim()) {
      pill(ctx, spec.beforeLabel, CREATIVE_WIDTH * 0.25, band.top + 62, "#5A5A5F");
    }
    if (spec.afterLabel.trim()) {
      pill(ctx, spec.afterLabel, CREATIVE_WIDTH * 0.75, band.top + 62, spec.accent);
    }

    // Sin este velo los pies desaparecen: el fondo de una comparación es una
    // ilustración sobre papel claro, y el texto blanco encima no se ve. Se
    // descubrió mirando el PNG, no con una prueba de geometría.
    const scrim = ctx.createLinearGradient(
      0,
      band.top + band.height - 150,
      0,
      band.top + band.height,
    );
    scrim.addColorStop(0, "rgba(8,8,10,0)");
    scrim.addColorStop(1, "rgba(8,8,10,0.88)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, band.top + band.height - 150, CREATIVE_WIDTH, 150);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    const captionSize = 26;
    ctx.font = `600 ${captionSize}px ${UI}`;

    for (const [caption, cx] of [
      [spec.beforeCaption, CREATIVE_WIDTH * 0.25],
      [spec.afterCaption, CREATIVE_WIDTH * 0.75],
    ] as const) {
      if (!caption.trim()) continue;
      const lines = wrapLines(
        canvasMeasure(ctx),
        caption,
        CREATIVE_WIDTH / 2 - 60,
        captionSize,
        UI,
      );
      lines.forEach((line, index) =>
        ctx.fillText(
          line,
          cx,
          band.top + band.height - 40 - (lines.length - 1 - index) * captionSize * 1.3,
        ),
      );
    }
    ctx.textAlign = "left";
  }

  for (const benefit of layout.benefits) {
    const size = benefit.fontSize;

    // Marca de verificación dibujada, no un carácter: los emoji y los glifos de
    // símbolo cambian de forma según el sistema, y el creativo tiene que salir
    // igual desde cualquier ordenador del equipo.
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = Math.max(4, size * 0.16);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(MARGIN + 4, benefit.y - size * 0.32);
    ctx.lineTo(MARGIN + size * 0.42, benefit.y);
    ctx.lineTo(MARGIN + size * 1.05, benefit.y - size * 0.82);
    ctx.stroke();

    ctx.font = `600 ${size}px ${UI}`;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(benefit.text, MARGIN + size * 1.5, benefit.y);
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("El canvas no devolvió ninguna imagen.")),
      "image/png",
    );
  });
}
