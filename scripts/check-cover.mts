/**
 * Comprueba la geometría del compositor de portadas.
 *
 * Lo que rompe una portada no es el dibujo, es la medida: un título largo que
 * se sale por el borde, un beneficio de dos palabras que desborda su celda, o
 * un bloque superior que se come el panel inferior. Nada de eso necesita un
 * canvas para probarse — solo un medidor determinista — así que se prueba aquí
 * en vez de a ojo sobre un PNG.
 *
 *   npm run check:cover
 */

import {
  COVER_HEIGHT,
  COVER_WIDTH,
  fitFontSize,
  layoutCover,
  wrapLines,
  type CoverSpec,
  type Measure,
} from "@/lib/cover/compose";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/**
 * Medidor determinista: ancho proporcional al número de caracteres.
 *
 * 0,62 em por carácter es lo que mide de media una grotesca pesada como Arial
 * Black. No busca replicar el canvas, sino ser monótono en el tamaño, que es la
 * única propiedad de la que dependen fitFontSize y wrapLines.
 */
const measure: Measure = (text, fontSize) => text.length * fontSize * 0.62;

const MARGIN = 72;
const CONTENT = COVER_WIDTH - MARGIN * 2;

// ---------------------------------------------------------------------------

console.log("\nfitFontSize");

const ancho = fitFontSize(measure, "RECETAS", CONTENT, { max: 150, min: 44 });
// La invariante no es "llena el ancho": es "cabe, y un punto más ya no cabría",
// salvo cuando lo que manda es el tope de cuerpo. Distinguir los dos casos
// importa — la primera versión de esta prueba daba por hecho que el ancho
// siempre era el límite, y falló con un título corto que topaba con el máximo.
check(
  "encuentra el mayor cuerpo que cabe",
  measure("RECETAS", ancho, "") <= CONTENT &&
    (ancho === 150 || measure("RECETAS", ancho + 1, "") > CONTENT),
  `cuerpo ${ancho}, ancho ${Math.round(measure("RECETAS", ancho, ""))} de ${CONTENT}`,
);

const larguisimo = fitFontSize(
  measure,
  "DESINTOXICACIÓN",
  CONTENT,
  { max: 150, min: 44 },
);
check(
  "una palabra muy larga baja de cuerpo en vez de desbordar",
  larguisimo < ancho,
  `larga ${larguisimo} vs corta ${ancho}`,
);

check(
  "nunca devuelve menos del mínimo, aunque no quepa",
  fitFontSize(measure, "A".repeat(400), CONTENT, { max: 150, min: 44 }) === 44,
);

// ---------------------------------------------------------------------------

console.log("\nwrapLines");

const lineas = wrapLines(
  measure,
  "RECETAS SALUDABLES PARA CONGELAR EN CASA",
  CONTENT,
  100,
);
check(
  "ninguna línea se sale de la caja",
  lineas.every((linea) => measure(linea, 100, "") <= CONTENT),
  lineas.map((l) => `${l} → ${Math.round(measure(l, 100, ""))}`).join(" | "),
);
check("no pierde ni inventa palabras", lineas.join(" ").split(" ").length === 6);

// ---------------------------------------------------------------------------

console.log("\nlayoutCover — la portada real de referencia");

const referencia: CoverSpec = {
  kicker: "Come saludable, ahorra tiempo",
  title: "Recetas",
  highlight: "Saludables",
  script: "para Congelar",
  ribbon: ["Organiza", "Prepara", "Congela", "Disfruta"],
  promise: "Cocina una vez y resuelve la semana completa en minutos",
  benefits: [
    "Recetas nutritivas",
    "Ideales para congelar",
    "Ahorra tiempo y dinero",
    "Prácticas y deliciosas",
    "Para toda la familia",
  ],
  badgeNumber: "68",
  badgeLabel: "recetas",
  accent: "#7FB539",
};

const layout = layoutCover(referencia, measure);
const minimaSinPromesa = layoutCover({ ...referencia, promise: "" }, measure);

check("coloca todos los bloques de texto", layout.blocks.length >= 4);
check("dibuja la cinta", layout.ribbon !== null);
check("dibuja el panel inferior", layout.panel !== null);

const ultimo = layout.blocks[layout.blocks.length - 1];
check(
  "el texto no invade el panel inferior",
  layout.panel !== null && ultimo.y < layout.panel.y,
  `último texto en y=${Math.round(ultimo.y)}, panel en y=${layout.panel?.y}`,
);
check(
  "el texto tampoco invade la promesa",
  layout.promise !== null && ultimo.y < layout.promise.y,
  `último texto en y=${Math.round(ultimo.y)}, promesa en y=${layout.promise?.y}`,
);
check(
  "la cinta queda por encima del panel",
  layout.ribbon !== null &&
    layout.panel !== null &&
    layout.ribbon.y + layout.ribbon.height <= layout.panel.y,
);
check(
  "el panel cabe dentro de la portada",
  layout.panel !== null && layout.panel.y + layout.panel.height <= COVER_HEIGHT,
);
check("dibuja la promesa de resultado", layout.promise !== null);
check(
  "la promesa queda entre la cinta y el panel",
  layout.promise !== null &&
    layout.ribbon !== null &&
    layout.panel !== null &&
    layout.ribbon.y + layout.ribbon.height <= layout.promise.y &&
    layout.promise.y + layout.promise.height <= layout.panel.y,
  `cinta ${layout.ribbon?.y}+${layout.ribbon?.height}, promesa ${layout.promise?.y}, panel ${layout.panel?.y}`,
);
check("sin promesa no se reserva su hueco", minimaSinPromesa.promise === null);
check(
  "título y destacado comparten cuerpo",
  new Set(
    layout.blocks
      .filter((b) => b.block.font.includes("Arial Black"))
      .map((b) => b.block.fontSize),
  ).size === 1,
);

// ---------------------------------------------------------------------------

console.log("\nlayoutCover — el caso que desborda");

const desbordado = layoutCover(
  {
    ...referencia,
    title: "Guía completa y definitiva de organización",
    highlight: "para congelar comida casera todas las semanas del año",
    script: "el método que de verdad funciona en cocinas reales",
    kicker: "Un sistema probado para familias con poco tiempo y mucha hambre",
  },
  measure,
);

const ultimoDesbordado = desbordado.blocks[desbordado.blocks.length - 1];
check(
  "un texto larguísimo se encoge en vez de invadir el panel",
  desbordado.panel !== null && ultimoDesbordado.y < desbordado.panel.y,
  `último texto en y=${Math.round(ultimoDesbordado.y)}, panel en y=${desbordado.panel?.y}`,
);
check(
  "sigue sin salirse por abajo",
  ultimoDesbordado.y < COVER_HEIGHT,
);

// ---------------------------------------------------------------------------

console.log("\nlayoutCover — portada mínima");

const minima = layoutCover(
  {
    kicker: "",
    title: "Longevidad",
    highlight: "",
    script: "",
    ribbon: [],
    promise: "",
    benefits: [],
    badgeNumber: "",
    badgeLabel: "",
    accent: "#A83E1B",
  },
  measure,
);

check("sin cinta no dibuja cinta", minima.ribbon === null);
check("sin beneficios ni sello no dibuja panel", minima.panel === null);
check("pinta el título igualmente", minima.blocks.length === 1);
// Sin nada más en la portada no hay motivo para encoger: el cuerpo lo decide
// solo el ancho disponible, no la altura.
const soloTitulo = minima.blocks[0].block.fontSize;
check(
  "un título solo se ajusta al ancho, sin encogerse por altura",
  measure("LONGEVIDAD", soloTitulo, "") <= CONTENT &&
    (soloTitulo === 150 || measure("LONGEVIDAD", soloTitulo + 1, "") > CONTENT),
  `cuerpo ${soloTitulo}, ancho ${Math.round(measure("LONGEVIDAD", soloTitulo, ""))} de ${CONTENT}`,
);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? "\nGeometría correcta: nada desborda y nada se solapa.\n"
    : `\n${failures} comprobaciones fallidas.\n`,
);
process.exit(failures === 0 ? 0 : 1);
