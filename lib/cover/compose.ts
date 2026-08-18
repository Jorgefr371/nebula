/**
 * Compositor de portadas.
 *
 * La portada generada por el modelo de imagen es un fondo, no una portada. Lo
 * que se usa en el anuncio y en la página de ventas es una pieza compuesta:
 * fotografía + jerarquía tipográfica + cinta de beneficios + sello. Medido en
 * el paquete "Recetas saludables para congelar", que vende: la portada es el
 * único activo del embudo que aparece en las tres etapas —anuncio, página y
 * entrega— y es la que decide si alguien hace clic.
 *
 * Por qué se compone aquí y no se le pide al modelo de imagen: los modelos
 * escriben el texto mal. Deforman letras, inventan tildes y arruinan una imagen
 * por lo demás correcta. Dibujando el texto sobre el canvas la tipografía es
 * real, se puede reajustar sin regenerar la imagen, y el título siempre encaja.
 *
 * La geometría vive en funciones puras (`fitFontSize`, `wrapLines`,
 * `layoutCover`) que reciben un medidor inyectado. Así se prueba el caso que
 * rompe una portada —un título largo que se sale de la caja— sin necesidad de
 * un canvas.
 */

/** Tamaño de la portada: el mismo que genera la API de imágenes. */
export const COVER_WIDTH = 1024;
export const COVER_HEIGHT = 1536;

const MARGIN = 72;
const CONTENT_WIDTH = COVER_WIDTH - MARGIN * 2;

/** Familias tipográficas. Deliberadamente de sistema: una webfont que no cargue
 *  se sustituye en silencio y la portada sale con otra letra sin avisar. */
const DISPLAY = '"Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif';
const SCRIPT = 'Georgia, "Times New Roman", serif';

/**
 * El texto con tracking ocupa más de lo que mide measureText, que no lo
 * contempla. En vez de complicar el medidor, se le descuenta al ancho
 * disponible: 0,14em de tracking son un 14% más de ancho en el peor caso.
 */
const TRACKING_KICKER = 0.86;
const TRACKING_RIBBON = 0.9;
const TRACKING_BENEFIT = 0.95;
const UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export type CoverSpec = {
  /** Antetítulo en versales. La promesa en cinco palabras. */
  kicker: string;
  /** El título. Se parte en líneas y se ajusta para llenar el ancho. */
  title: string;
  /** Segunda mitad del título, en color de acento. Opcional. */
  highlight: string;
  /** Línea en cursiva bajo el título ("para Congelar"). Opcional. */
  script: string;
  /** Palabras de la cinta; se pintan separadas por puntos. */
  ribbon: string[];
  /**
   * La promesa de resultado, sobre el panel inferior.
   *
   * La llevan las siete portadas de referencia sin excepción, y es lo único
   * que distingue una portada que vende de una que solo nombra el tema: dice
   * qué consigue el lector, no de qué va el libro.
   */
  promise: string;
  /** Beneficios del panel inferior. Máximo cinco: a partir de ahí no se leen. */
  benefits: string[];
  /** Cifra del sello ("68") y su etiqueta ("recetas"). Opcional. */
  badgeNumber: string;
  badgeLabel: string;
  /** Color de acento en hexadecimal. */
  accent: string;
};

/** Mide el ancho de un texto a un tamaño dado. El canvas lo implementa; los
 *  tests inyectan uno determinista. */
export type Measure = (text: string, fontSize: number, font: string) => number;

/**
 * Mayor tamaño de fuente al que `text` cabe en `maxWidth`.
 *
 * Es lo que hace que un título de una palabra y otro de seis llenen los dos el
 * ancho de la portada. Sin esto, o el título corto se ve ridículo o el largo se
 * sale por el borde.
 */
export function fitFontSize(
  measure: Measure,
  text: string,
  maxWidth: number,
  options: { max: number; min: number; font?: string },
): number {
  const font = options.font ?? DISPLAY;
  if (!text.trim()) return options.min;

  // Búsqueda binaria sobre tamaños enteros: el ancho crece de forma monótona
  // con el tamaño, así que basta con partir el intervalo.
  let low = options.min;
  let high = options.max;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(text, mid, font) <= maxWidth) low = mid;
    else high = mid - 1;
  }

  return low;
}

/**
 * Parte el texto en líneas que caben en `maxWidth` a un tamaño dado.
 *
 * Una palabra más larga que la caja se queda sola en su línea en vez de
 * partirse: partir palabras en una portada se ve peor que reducir el cuerpo, y
 * de reducirlo ya se encarga fitFontSize.
 */
export function wrapLines(
  measure: Measure,
  text: string,
  maxWidth: number,
  fontSize: number,
  font: string = DISPLAY,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (measure(candidate, fontSize, font) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

export type TextBlock = {
  text: string;
  fontSize: number;
  font: string;
  /** Alto de la línea, ya multiplicado. */
  lineHeight: number;
  color: "foreground" | "accent";
};

export type CoverLayout = {
  /** Bloques del tercio superior, en orden de pintado. */
  blocks: { block: TextBlock; y: number }[];
  ribbon: { y: number; height: number; text: string } | null;
  promise: { y: number; height: number; text: string } | null;
  panel: { y: number; height: number } | null;
  /** Altura total ocupada por el texto superior. Sirve para el degradado. */
  textBottom: number;
};

const PANEL_HEIGHT = 210;
const RIBBON_HEIGHT = 62;
/** Altura reservada sobre el panel para la promesa, cuando la hay. */
const PROMISE_HEIGHT = 96;

/**
 * Coloca los elementos. Puro: no toca el canvas, solo decide coordenadas.
 *
 * El texto se apila desde arriba y el panel se ancla abajo. Si el bloque
 * superior creciera hasta chocar con el panel, los cuerpos se reducen en
 * conjunto: es preferible un título algo menor a un título tapado.
 */
export function layoutCover(
  spec: CoverSpec,
  measure: Measure,
  width = COVER_WIDTH,
  height = COVER_HEIGHT,
): CoverLayout {
  const maxWidth = width - MARGIN * 2;
  const blocks: TextBlock[] = [];

  if (spec.kicker.trim()) {
    const size = fitFontSize(
      measure,
      spec.kicker.toUpperCase(),
      maxWidth * TRACKING_KICKER,
      { max: 34, min: 16, font: UI },
    );
    blocks.push({
      text: spec.kicker.toUpperCase(),
      fontSize: size,
      font: UI,
      lineHeight: size * 1.4,
      color: "accent",
    });
  }

  // El título y el destacado se ajustan JUNTOS al mismo cuerpo. Ajustarlos por
  // separado da dos tamaños distintos y el conjunto se lee como dos títulos
  // pegados en vez de uno.
  const titleParts = [spec.title, spec.highlight].filter((part) => part.trim());
  if (titleParts.length > 0) {
    // Se mide YA EN VERSALES. Medir "Saludables" y dibujar "SALUDABLES" es un
    // error silencioso: las mayúsculas son más anchas, así que el cuerpo sale
    // holgado y la palabra se sale por el borde derecho. Ocurrió, y solo se vio
    // al mirar el PNG — ninguna prueba de geometría lo detecta si la prueba
    // comete la misma confusión de caja.
    const longest = titleParts
      .flatMap((part) => part.trim().toUpperCase().split(/\s+/))
      .reduce((a, b) => (measure(a, 100, DISPLAY) >= measure(b, 100, DISPLAY) ? a : b), "");

    // El cuerpo lo marca la palabra más larga: si esa cabe, cabe todo.
    const size = fitFontSize(measure, longest, maxWidth, { max: 150, min: 44 });

    for (const [index, part] of titleParts.entries()) {
      for (const line of wrapLines(measure, part.toUpperCase(), maxWidth, size)) {
        blocks.push({
          text: line,
          fontSize: size,
          font: DISPLAY,
          lineHeight: size * 1.02,
          color: index === 0 ? "foreground" : "accent",
        });
      }
    }
  }

  if (spec.script.trim()) {
    const size = fitFontSize(measure, spec.script, maxWidth, {
      max: 92,
      min: 30,
      font: SCRIPT,
    });
    blocks.push({
      text: spec.script,
      fontSize: size,
      font: SCRIPT,
      lineHeight: size * 1.3,
      color: "foreground",
    });
  }

  const hasPanel = spec.benefits.length > 0 || spec.badgeNumber.trim() !== "";
  const panelY = height - MARGIN - PANEL_HEIGHT;
  const hasPromise = spec.promise.trim() !== "";
  const promiseY = (hasPanel ? panelY : height - MARGIN) - PROMISE_HEIGHT - 18;

  const ribbonText = spec.ribbon
    .map((word) => word.trim().toUpperCase())
    .filter(Boolean)
    .join("   ·   ");

  // Techo del bloque superior: no puede invadir la promesa, la cinta ni el panel.
  const floor = hasPromise
    ? promiseY - 24
    : hasPanel
      ? panelY - 40
      : height - MARGIN;
  const reserved = ribbonText ? RIBBON_HEIGHT + 40 : 0;
  const available = floor - MARGIN * 2 - reserved;

  const naturalHeight = blocks.reduce((sum, b) => sum + b.lineHeight, 0);
  // Si no cabe, se encoge todo proporcionalmente. Un título recortado es un
  // error visible; un título un 10% menor no lo nota nadie.
  const scale = naturalHeight > available ? available / naturalHeight : 1;

  const placed: { block: TextBlock; y: number }[] = [];
  let cursor = MARGIN * 1.6;

  for (const block of blocks) {
    const scaled: TextBlock = {
      ...block,
      fontSize: Math.floor(block.fontSize * scale),
      lineHeight: block.lineHeight * scale,
    };
    cursor += scaled.lineHeight;
    placed.push({ block: scaled, y: cursor });
  }

  return {
    blocks: placed,
    ribbon: ribbonText
      ? { y: cursor + 34, height: RIBBON_HEIGHT, text: ribbonText }
      : null,
    promise: hasPromise
      ? { y: promiseY, height: PROMISE_HEIGHT, text: spec.promise.trim() }
      : null,
    panel: hasPanel ? { y: panelY, height: PANEL_HEIGHT } : null,
    textBottom: cursor + (ribbonText ? 34 + RIBBON_HEIGHT : 0),
  };
}

/* ------------------------------------------------------------------------ *
 * Dibujo. Solo navegador.
 * ------------------------------------------------------------------------ */

function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, fontSize, font) => {
    ctx.font = `900 ${fontSize}px ${font}`;
    return ctx.measureText(text).width;
  };
}

/** Dibuja el fondo recortado a la caja sin deformarlo (equivalente a cover). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Compone la portada y devuelve el PNG.
 *
 * El fondo se trae con fetch y createImageBitmap en vez de con un <img>: si el
 * bucket no sirviera CORS, un <img> mancharía el canvas y el fallo aparecería
 * al exportar, con un SecurityError sin contexto. Así falla en la descarga, que
 * es donde se entiende.
 */
export async function composeCover(
  spec: CoverSpec,
  backgroundUrl: string,
): Promise<Blob> {
  const response = await fetch(backgroundUrl, { mode: "cors" });
  if (!response.ok) {
    throw new Error(
      `No se pudo leer la portada de fondo (HTTP ${response.status}). ` +
        "Genera primero la portada con generate_cover.",
    );
  }

  const bitmap = await createImageBitmap(await response.blob());

  const canvas = document.createElement("canvas");
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no permitió crear el canvas 2D.");

  const layout = layoutCover(spec, canvasMeasure(ctx));

  drawCover(ctx, bitmap, COVER_WIDTH, COVER_HEIGHT);
  bitmap.close();

  // Velo. Sin esto la portada depende de que la foto salga oscura, y basta con
  // que el modelo devuelva una cocina soleada para que el título desaparezca.
  const veil = ctx.createLinearGradient(0, 0, 0, COVER_HEIGHT);
  veil.addColorStop(0, "rgba(0,0,0,0.78)");
  veil.addColorStop(Math.min(0.95, layout.textBottom / COVER_HEIGHT), "rgba(0,0,0,0.30)");
  veil.addColorStop(0.72, "rgba(0,0,0,0.18)");
  veil.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  for (const { block, y } of layout.blocks) {
    ctx.font = `900 ${block.fontSize}px ${block.font}`;
    ctx.fillStyle = block.color === "accent" ? spec.accent : "#FFFFFF";

    if (block.font === SCRIPT) {
      ctx.font = `italic 400 ${block.fontSize}px ${block.font}`;
    }
    if (block.font === UI) {
      ctx.font = `700 ${block.fontSize}px ${block.font}`;
      ctx.letterSpacing = "0.14em";
    } else {
      ctx.letterSpacing = "0em";
    }

    ctx.fillText(block.text, MARGIN, y);
  }
  ctx.letterSpacing = "0em";

  if (layout.ribbon) {
    ctx.fillStyle = spec.accent;
    roundedRect(ctx, MARGIN, layout.ribbon.y, CONTENT_WIDTH, layout.ribbon.height, 6);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    const size = fitFontSize(
      canvasMeasure(ctx),
      layout.ribbon.text,
      (CONTENT_WIDTH - 48) * TRACKING_RIBBON,
      { max: 30, min: 13, font: UI },
    );
    ctx.font = `700 ${size}px ${UI}`;
    ctx.letterSpacing = "0.1em";
    ctx.fillText(
      layout.ribbon.text,
      COVER_WIDTH / 2,
      layout.ribbon.y + layout.ribbon.height / 2 + size * 0.36,
    );
    ctx.letterSpacing = "0em";
    ctx.textAlign = "left";
  }

  if (layout.promise) {
    const { y, height, text } = layout.promise;
    const size = fitFontSize(canvasMeasure(ctx), text, CONTENT_WIDTH * 0.62, {
      max: 34,
      min: 15,
      font: UI,
    });
    ctx.font = `600 ${size}px ${UI}`;
    const lines = wrapLines(canvasMeasure(ctx), text, CONTENT_WIDTH * 0.92, size, UI);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    const start = y + height / 2 - ((lines.length - 1) * size * 1.32) / 2;
    lines.forEach((line, i) =>
      ctx.fillText(line, COVER_WIDTH / 2, start + i * size * 1.32),
    );
    ctx.textAlign = "left";
  }

  if (layout.panel) {
    const { y, height } = layout.panel;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    roundedRect(ctx, MARGIN, y, CONTENT_WIDTH, height, 18);
    ctx.fill();

    const benefits = spec.benefits.slice(0, 5).map((b) => b.trim()).filter(Boolean);
    const hasBadge = spec.badgeNumber.trim() !== "";
    const badgeWidth = hasBadge ? 190 : 0;
    const zone = CONTENT_WIDTH - badgeWidth;

    if (benefits.length > 0) {
      const cell = zone / benefits.length;
      ctx.textAlign = "center";

      benefits.forEach((benefit, index) => {
        const cx = MARGIN + cell * index + cell / 2;

        if (index > 0) {
          ctx.strokeStyle = "rgba(0,0,0,0.13)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(MARGIN + cell * index, y + 34);
          ctx.lineTo(MARGIN + cell * index, y + height - 34);
          ctx.stroke();
        }

        // Cada beneficio se ajusta a su celda: dos palabras y seis letras no
        // pueden compartir cuerpo sin que una de las dos desborde.
        const size = fitFontSize(
          canvasMeasure(ctx),
          benefit.toUpperCase(),
          (cell - 26) * TRACKING_BENEFIT,
          { max: 24, min: 11, font: UI },
        );
        ctx.font = `800 ${size}px ${UI}`;
        ctx.fillStyle = "#1A1A1A";
        ctx.letterSpacing = "0.05em";

        const lines = wrapLines(
          canvasMeasure(ctx),
          benefit.toUpperCase(),
          (cell - 26) * TRACKING_BENEFIT,
          size,
          UI,
        );
        const start = y + height / 2 - ((lines.length - 1) * size * 1.3) / 2 + size * 0.34;
        lines.forEach((line, i) => ctx.fillText(line, cx, start + i * size * 1.3));
        ctx.letterSpacing = "0em";
      });
    }

    if (hasBadge) {
      const cx = MARGIN + CONTENT_WIDTH - badgeWidth / 2;
      const cy = y + height / 2;

      ctx.fillStyle = spec.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 76, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = "#FFFFFF";
      const numberSize = fitFontSize(
        canvasMeasure(ctx),
        spec.badgeNumber,
        120,
        { max: 62, min: 22 },
      );
      ctx.font = `900 ${numberSize}px ${DISPLAY}`;
      ctx.fillText(spec.badgeNumber, cx, cy + (spec.badgeLabel.trim() ? 4 : numberSize * 0.35));

      if (spec.badgeLabel.trim()) {
        const labelSize = fitFontSize(
          canvasMeasure(ctx),
          spec.badgeLabel,
          128,
          { max: 24, min: 11, font: UI },
        );
        ctx.font = `600 ${labelSize}px ${UI}`;
        ctx.fillText(spec.badgeLabel, cx, cy + 4 + labelSize * 1.5);
      }
    }

    ctx.textAlign = "left";
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("El canvas no devolvió ninguna imagen.")),
      "image/png",
    );
  });
}
