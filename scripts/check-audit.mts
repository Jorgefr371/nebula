/**
 * Comprueba el detector de colapso de plantilla contra el caso real que lo
 * motivó: tres recetas del ebook "Recetas saludables para congelar" —bocaditos
 * de yogur, pancakes de avena y barritas de manzana— que se venden como platos
 * distintos y son el mismo texto palabra por palabra.
 *
 * El fixture es la transcripción literal del PDF, no una imitación. Si algún
 * día alguien relaja el umbral de similitud o el mínimo de palabras por bloque
 * "porque daba muchos falsos positivos", este script falla y explica por qué.
 *
 *   npm run check:audit
 */

import { auditBook, formatAudit, type Finding } from "@/lib/ebook/audit";
import type { Chapter } from "@/lib/ebook/types";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function chapter(position: number, title: string, content: string): Chapter {
  return {
    id: `c${position}`,
    ebook_id: "libro",
    position,
    title,
    content,
    created_at: "",
    updated_at: "",
  };
}

const has = (findings: Finding[], fragment: string) =>
  findings.some((f) => f.message.includes(fragment));

// ---------------------------------------------------------------------------
// Fixture 1: el colapso real.
// ---------------------------------------------------------------------------

/** Plantilla literal compartida por 16 recetas del capítulo 7 y 9 del PDF. */
const PLANTILLA_REPOSTERIA = `## Ingredientes

- 1½ tazas de avena o harina integral según receta
- 2 huevos o sustituto equivalente
- 1 taza del ingrediente principal
- ½ taza de leche o bebida vegetal
- 2 cdas de aceite o mantequilla de frutos secos
- 1 cdta de canela o vainilla
- 1 cdta de polvo de hornear cuando aplique
- Endulzante moderado al gusto

## Preparación

1. Precalienta el horno si la receta lo requiere y prepara el molde o bandeja.
2. Mezcla primero los ingredientes húmedos y, aparte, los secos.
3. Integra ambas mezclas solo hasta combinar para evitar una textura pesada.
4. Divide en porciones uniformes y cocina u hornea hasta que el centro esté firme.
5. Enfría completamente; congela primero las unidades separadas y luego agrúpalas.

Congelar: enfría completamente y guarda en un recipiente apto, retirando exceso de aire. Etiqueta con nombre, fecha y porciones. Descongelar: preferentemente en refrigeración.`;

const colapsado = [
  chapter(1, "Bocaditos de yogur y frutos rojos", PLANTILLA_REPOSTERIA),
  chapter(2, "Pancakes dulces de avena", PLANTILLA_REPOSTERIA),
  chapter(3, "Barritas de manzana y canela", PLANTILLA_REPOSTERIA),
];

console.log("\nEl ebook real que colapsó (3 recetas idénticas)");
const informeColapso = auditBook(colapsado);

check(
  "detecta que los capítulos son copia unos de otros",
  has(informeColapso.findings, "100% texto copiado"),
  formatAudit(informeColapso),
);
check(
  "lo marca como GRAVE, no como aviso",
  informeColapso.findings.some(
    (f) => f.severity === "grave" && f.message.includes("texto copiado"),
  ),
);
check(
  "detecta el marcador sin rellenar «ingrediente principal»",
  has(informeColapso.findings, "ingrediente principal"),
);
check(
  "la originalidad cae por debajo del 50%",
  informeColapso.originality < 0.5,
  `originalidad medida: ${Math.round(informeColapso.originality * 100)}%`,
);

// ---------------------------------------------------------------------------
// Fixture 2: parafraseo. Mismo contenido con las palabras cambiadas — lo que
// hace un modelo al que solo se le ha pedido "no repitas literalmente".
// ---------------------------------------------------------------------------

const parafraseado = [
  chapter(
    1,
    "Crema de calabaza",
    `Pela la calabaza y córtala en cubos de tamaño parecido para que se cocinen a la vez. Sofríe la cebolla en aceite de oliva a fuego medio hasta que quede transparente, unos seis minutos. Añade la calabaza y cúbrela con caldo de verduras caliente. Deja hervir a fuego suave veinticinco minutos, hasta que la calabaza se deshaga al presionarla con un tenedor. Tritura con la batidora hasta obtener una textura completamente lisa y rectifica de sal. Deja enfriar del todo antes de repartir en recipientes individuales y llevar al congelador.`,
  ),
  chapter(
    2,
    "Crema de zanahoria",
    `Pela la zanahoria y córtala en cubos de tamaño parecido para que se cocinen a la vez. Sofríe la cebolla en aceite de oliva a fuego medio hasta que quede transparente, unos seis minutos. Añade la zanahoria y cúbrela con caldo de verduras caliente. Deja hervir a fuego suave veinticinco minutos, hasta que la zanahoria se deshaga al presionarla con un tenedor. Tritura con la batidora hasta obtener una textura completamente lisa y rectifica de sal. Deja enfriar del todo antes de repartir en recipientes individuales y llevar al congelador.`,
  ),
];

console.log("\nParafraseo: dos capítulos que dicen lo mismo con otras palabras");
const informeParafraseo = auditBook(parafraseado);
check(
  "los marca como casi calcados",
  has(informeParafraseo.findings, "casi calcados"),
  formatAudit(informeParafraseo),
);

// ---------------------------------------------------------------------------
// Fixture 3: un libro legítimo. Aquí se mide el ruido: una colección de fichas
// comparte encabezados y fórmulas de seguridad en TODAS las unidades, y eso es
// correcto. Si el detector se queja, el agente aprende a ignorarlo.
// ---------------------------------------------------------------------------

const legitimo = [
  chapter(
    1,
    "Pollo al limón y hierbas",
    `## Ingredientes

- 600 g de pechuga de pollo
- 2 cdas de jugo de limón
- 2 dientes de ajo picados
- 1 cdta de orégano seco

## Preparación

1. Corta el pollo en piezas de tamaño similar para que se cocinen de manera uniforme.
2. Mezcla el aceite con el limón, el ajo y el orégano, incorpora el pollo y deja reposar quince minutos en refrigeración.
3. Calienta una sartén amplia a fuego medio-alto y cocina el pollo por tandas, evitando amontonarlo.
4. Dora por ambos lados hasta que el centro esté completamente cocido.

Congelar: enfría completamente y guarda en un recipiente apto, retirando el exceso de aire.`,
  ),
  chapter(
    2,
    "Albóndigas en salsa de tomate",
    `## Ingredientes

- 500 g de carne molida de res
- 1 huevo
- 3 cdas de pan rallado integral
- 400 g de tomate triturado

## Preparación

1. Mezcla la carne con el huevo y el pan rallado hasta integrar sin trabajar la masa en exceso.
2. Forma bolas del tamaño de una nuez y deja reposar diez minutos en frío para que no se deshagan.
3. Dora las albóndigas en una sartén con un poco de aceite, girándolas para que se sellen por todos lados.
4. Añade el tomate triturado y cocina veinte minutos a fuego bajo, hasta que la salsa espese.

Congelar: enfría completamente y guarda en un recipiente apto, retirando el exceso de aire.`,
  ),
];

console.log("\nLibro legítimo: mismo esqueleto, contenido distinto");
const informeLegitimo = auditBook(legitimo);
check(
  "no lo acusa de copiar (la frase de conservación compartida es legítima)",
  !has(informeLegitimo.findings, "texto copiado"),
  formatAudit(informeLegitimo),
);
check(
  "no lo acusa de capítulos calcados",
  !has(informeLegitimo.findings, "casi calcados"),
);
check(
  "no inventa marcadores sin rellenar",
  !has(informeLegitimo.findings, "marcadores sin"),
);

// ---------------------------------------------------------------------------
// Fixture 4: las reglas que salieron de auditar un libro real de Nébula.
// ---------------------------------------------------------------------------

const cuerpo = (tema: string) =>
  `${tema} exige atención constante durante las primeras semanas. `.repeat(14) +
  `Conviene medir el progreso cada siete días y ajustar la rutina en función ` +
  `de lo observado, sin cambiar más de una variable a la vez.`;

const libroSinNada = [
  ...Array.from({ length: 8 }, (_, i) =>
    chapter(i + 1, `Capítulo sobre ${i + 1}`, cuerpo(`El asunto ${i + 1}`)),
  ),
];
// Solo los tres primeros llevan imagen: el patrón medido en el libro real.
libroSinNada[0].content += "\n\n![figura](https://img/a.png)";
libroSinNada[1].content += "\n\n![figura](https://img/b.png)";
libroSinNada[2].content += "\n\n![figura](https://img/c.png)";

console.log("\nEl libro real que salió de Nébula");
const informeReal = auditBook(libroSinNada);

check(
  "detecta que las imágenes se acaban a media obra",
  has(informeReal.findings, "se acaban a media obra"),
  formatAudit(informeReal),
);
check(
  "detecta que no usa el sistema de maquetación",
  has(informeReal.findings, "bloques de maquetación"),
);
check(
  "detecta que falta la apertura y el cierre",
  has(informeReal.findings, "apertura") && has(informeReal.findings, "cierre"),
);

// Y el contrario: un libro bien montado no debe recibir ninguno de los tres.
const libroCompleto = [
  chapter(1, "Qué vas a conseguir con este libro", cuerpo("La promesa")),
  chapter(2, "Cómo usar este libro", cuerpo("El método")),
  ...Array.from({ length: 4 }, (_, i) =>
    chapter(i + 3, `Tema ${i + 1}`, `:::tip\nUn consejo del capítulo.\n:::\n\n${cuerpo(`Tema ${i + 1}`)}\n\n![figura](https://img/${i}.png)`),
  ),
  chapter(7, "Plan de acción", cuerpo("Los pasos")),
  chapter(8, "Sobre el autor", cuerpo("Quién firma")),
];

console.log("\nUn libro bien montado");
const informeCompleto = auditBook(libroCompleto);
check(
  "no se queja de las imágenes",
  !has(informeCompleto.findings, "se acaban a media obra"),
  formatAudit(informeCompleto),
);
check(
  "no se queja de la maquetación",
  !has(informeCompleto.findings, "bloques de maquetación"),
);
check(
  "no le pide una arquitectura que ya tiene",
  !has(informeCompleto.findings, "Al índice le falta"),
);

// El falso positivo que encontró el libro real: "todo" y "pendiente" son
// palabras corrientes en español, y marcaban siete capítulos como GRAVE.
console.log("\nFalsos positivos del castellano");
const castellano = [
  chapter(1, "Vacunas", `Sobre todo, revisa el calendario. ${cuerpo("La vacuna")}`),
  chapter(2, "Paseos", `Queda pendiente la revisión anual. ${cuerpo("El paseo")}`),
];
const informeCastellano = auditBook(castellano);
check(
  "«sobre todo» y «pendiente» no se confunden con marcadores",
  !has(informeCastellano.findings, "marcadores sin"),
  formatAudit(informeCastellano),
);
check(
  "pero un TODO en mayúsculas sí se detecta",
  has(
    auditBook([
      chapter(1, "Uno", `TODO: rellenar esta parte. ${cuerpo("Algo")}`),
      chapter(2, "Dos", cuerpo("Otra cosa")),
    ]).findings,
    "TODO",
  ),
);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? "\nTodo correcto: el detector marca el colapso real y deja pasar el libro legítimo.\n"
    : `\n${failures} comprobaciones fallidas.\n`,
);
process.exit(failures === 0 ? 0 : 1);
