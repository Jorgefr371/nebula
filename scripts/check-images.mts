/**
 * Comprueba el montaje de prompts de imagen.
 *
 * Lo que se prueba: que el papel decida la técnica, que la paleta salga del
 * tema del libro y que la prohibición de texto llegue en todos los casos. Son
 * las tres cosas que, cuando fallan, dan la imagen genérica de banco de
 * fotos — y eso no se ve en un error, se ve tres semanas después al abrir el
 * PDF terminado.
 *
 * Con OPENAI_API_KEY en el entorno y --real, además genera de verdad una imagen
 * por papel y las deja en /tmp/nebula-imagenes para mirarlas. Cuesta dinero, así
 * que no va por defecto.
 *
 *   npm run check:images
 *   npm run check:images -- --real
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { buildImagePrompt, IMAGE_ROLES, ROLES, isImageRole } from "@/lib/images/roles";
import { getTheme } from "@/lib/ebook/themes";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const CONTENIDO =
  "un perro ante una puerta entreabierta; la misma puerta con una barrera de " +
  "seguridad instalada; una persona entrando con las manos ocupadas sin que el perro salga";

// ---------------------------------------------------------------------------

console.log("\nTodos los papeles");

for (const role of IMAGE_ROLES) {
  const { prompt, size } = buildImagePrompt({
    role,
    prompt: CONTENIDO,
    themeId: "culinario",
    imageStyle: "fotografía editorial, luz cálida",
  });

  check(
    `${role}: prohíbe el texto`,
    prompt.includes("NINGÚN texto"),
    prompt.slice(0, 120),
  );
  check(`${role}: incluye el contenido pedido`, prompt.includes("barrera de"));
  check(
    `${role}: el tamaño es uno de los admitidos por la API`,
    ["1024x1024", "1536x1024", "1024x1536"].includes(size),
    size,
  );
}

// ---------------------------------------------------------------------------

console.log("\nEl papel decide la técnica");

const diagrama = buildImagePrompt({
  role: "diagrama",
  prompt: CONTENIDO,
  themeId: "culinario",
  imageStyle: "fotografía editorial, luz cálida, grano fino",
});
const escena = buildImagePrompt({
  role: "escena",
  prompt: CONTENIDO,
  themeId: "culinario",
  imageStyle: "fotografía editorial, luz cálida, grano fino",
});

check(
  "un diagrama pide vectorial plano",
  diagrama.prompt.includes("vectorial plana") &&
    diagrama.prompt.includes("sin degradados"),
);
check(
  "una escena pide fotografía",
  escena.prompt.includes("Fotografía editorial") &&
    !escena.prompt.includes("vectorial"),
);

// El fallo silencioso que esto vigila: aplicarle la dirección de arte
// fotográfica a un diagrama vectorial son dos instrucciones incompatibles, y el
// modelo resuelve el conflicto devolviendo la foto de archivo que se quería
// evitar.
check(
  "la dirección de arte fotográfica NO contamina los diagramas",
  !diagrama.prompt.includes("grano fino"),
  diagrama.prompt.slice(0, 200),
);
check(
  "pero sí se aplica a las escenas",
  escena.prompt.includes("grano fino"),
);

check(
  "la secuencia pide tres viñetas con flechas",
  buildImagePrompt({ role: "secuencia", prompt: CONTENIDO, themeId: null, imageStyle: null })
    .prompt.includes("TRES viñetas"),
);
check(
  "la comparación pide dos mitades",
  buildImagePrompt({ role: "comparacion", prompt: CONTENIDO, themeId: null, imageStyle: null })
    .prompt.includes("DOS mitades"),
);

// ---------------------------------------------------------------------------

console.log("\nLa paleta sale del tema del libro");

for (const themeId of ["culinario", "crianza", "bienestar"]) {
  const { prompt } = buildImagePrompt({
    role: "diagrama",
    prompt: CONTENIDO,
    themeId,
    imageStyle: null,
  });
  const theme = getTheme(themeId);
  check(
    `${themeId}: el esquema hereda el acento del tema`,
    prompt.includes(theme.colors.accent) && prompt.includes(theme.colors.paper),
    `esperaba ${theme.colors.accent}`,
  );
}

check(
  "un tema inexistente no rompe el montaje",
  buildImagePrompt({ role: "diagrama", prompt: "x", themeId: "no-existe", imageStyle: null })
    .prompt.length > 0,
);

console.log("\nValidación de papel");
check("acepta los papeles reales", IMAGE_ROLES.every(isImageRole));
check(
  "rechaza lo que no lo es",
  !isImageRole("foto") && !isImageRole("") && !isImageRole(undefined),
);
check(
  "cada papel explica para qué sirve",
  IMAGE_ROLES.every((role) => ROLES[role].para.length > 30),
);

// ---------------------------------------------------------------------------
// Generación real, opcional.
// ---------------------------------------------------------------------------

if (process.argv.includes("--real")) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("\n--real pedido pero no hay OPENAI_API_KEY. Se omite.");
  } else {
    const dir = "/tmp/nebula-imagenes";
    mkdirSync(dir, { recursive: true });
    console.log(`\nGenerando de verdad en ${dir} (esto cuesta dinero)`);

    for (const role of IMAGE_ROLES) {
      const { prompt, size } = buildImagePrompt({
        role,
        prompt: CONTENIDO,
        themeId: "crianza",
        imageStyle: "fotografía editorial, luz natural de tarde",
      });

      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1-mini",
          prompt,
          size,
          n: 1,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        failures++;
        console.log(`  FALLO ${role}: ${payload?.error?.message ?? response.status}`);
        continue;
      }

      const file = `${dir}/${role}.png`;
      writeFileSync(file, Buffer.from(payload.data[0].b64_json, "base64"));
      console.log(`  ok    ${role} → ${file}`);
    }
  }
}

console.log(
  failures === 0
    ? "\nLos prompts de imagen se montan bien: el papel manda sobre la técnica.\n"
    : `\n${failures} comprobaciones fallidas.\n`,
);
process.exit(failures === 0 ? 0 : 1);
