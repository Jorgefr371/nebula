/**
 * Verificación del proveedor de modelo contra la API real.
 *
 * Ejercita las dos traducciones que son fáciles de romper y difíciles de
 * detectar: canónico → formato del proveedor al enviar, y respuesta → canónico
 * al volver. En concreto, la vuelta de resultados de herramienta, que en OpenAI
 * se despliega en un mensaje `tool` por llamada.
 *
 *   npx tsx scripts/check-provider.mts
 */
import { resolveProvider } from "@/lib/agent/providers";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { TOOLS, TOOL_NAMES } from "@/lib/agent/tools";
import type { ChatMessage, ToolUseBlock } from "@/lib/store/types";

const failures: string[] = [];
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const provider = resolveProvider();
if ("error" in provider) {
  console.error(provider.error);
  process.exit(1);
}

console.log(`Proveedor: ${provider.id} · modelo: ${provider.model}\n`);

// --- Turno 1: el primer mensaje de un libro nuevo ---------------------------
console.log("Turno 1 — primer mensaje de un libro nuevo");

const messages: ChatMessage[] = [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: "Un ebook corto para consultores sobre cómo cobrar por valor y no por horas.\n\n<contexto-del-libro>\nEl libro no tiene capítulos todavía.\n</contexto-del-libro>",
      },
    ],
  },
];

let streamedText = "";
const announcedTools: string[] = [];

const turn1 = await provider.run({
  system: SYSTEM_PROMPT,
  tools: TOOLS,
  messages,
  onEvent: (event) => {
    if (event.type === "text_delta") streamedText += event.text;
    if (event.type === "tool_start") announcedTools.push(event.name);
  },
});

const toolUses1 = turn1.content.filter(
  (block): block is ToolUseBlock => block.type === "tool_use",
);

// La invariante real del streaming no es "hubo texto" — un turno puede ir
// directo a las herramientas sin escribir nada, y es correcto. Es que lo que se
// emitió por deltas coincida exactamente con el texto del turno final: si no,
// la UI enseñaría algo distinto de lo que se guarda en el historial.
const textOfTurn1 = turn1.content
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("");

check(
  "el texto emitido en streaming coincide con el del turno",
  streamedText === textOfTurn1,
  `streaming: ${streamedText.length} caracteres · turno: ${textOfTurn1.length}`,
);
check("pide al menos una herramienta", toolUses1.length > 0);
check(
  "los nombres de herramienta son válidos",
  toolUses1.every((tool) => TOOL_NAMES.includes(tool.name)),
  toolUses1.map((t) => t.name).join(", "),
);
check(
  "los eventos tool_start avisan a la UI",
  announcedTools.length === toolUses1.length,
  `avisados: ${announcedTools.join(", ") || "ninguno"}`,
);
check(
  "los argumentos llegan parseados como objeto, no como string",
  toolUses1.every(
    (tool) =>
      typeof tool.input === "object" &&
      tool.input !== null &&
      !("__parse_error" in tool.input),
  ),
);
check("stopReason normalizado a tool_use", turn1.stopReason === "tool_use");
check("cada tool_use trae un id", toolUses1.every((tool) => Boolean(tool.id)));

// El prompt manda empezar por metadatos e índice antes de escribir.
check(
  "empieza por set_metadata o create_outline",
  toolUses1.some((tool) =>
    ["set_metadata", "create_outline"].includes(tool.name),
  ),
  toolUses1.map((t) => t.name).join(", "),
);

console.log(`\n  herramientas: ${toolUses1.map((t) => t.name).join(", ")}`);
for (const tool of toolUses1) {
  const preview = JSON.stringify(tool.input);
  console.log(
    `  ${tool.name}: ${preview.length > 220 ? `${preview.slice(0, 220)}…` : preview}`,
  );
}

// --- Turno 2: devolver resultados y continuar -------------------------------
// Es LA parte frágil: el formato canónico mete todos los resultados en un único
// mensaje de usuario, y OpenAI exige un mensaje `tool` por cada tool_call_id.
console.log("\nTurno 2 — devolviendo resultados de herramienta");

messages.push({ role: "assistant", content: turn1.content });
messages.push({
  role: "user",
  content: toolUses1.map((tool) => ({
    type: "tool_result" as const,
    tool_use_id: tool.id,
    content:
      tool.name === "create_outline"
        ? "Índice creado con 3 capítulos:\n1. Por qué las horas mienten — vacío\n2. Cómo se calcula el valor — vacío\n3. La conversación de precio — vacío"
        : "Metadatos actualizados.",
  })),
});

let streamedText2 = "";
const turn2 = await provider.run({
  system: SYSTEM_PROMPT,
  tools: TOOLS,
  messages,
  onEvent: (event) => {
    if (event.type === "text_delta") streamedText2 += event.text;
  },
});

const textOfTurn2 = turn2.content
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("");

check(
  "el streaming del segundo turno también coincide",
  streamedText2 === textOfTurn2,
  `streaming: ${streamedText2.length} caracteres · turno: ${textOfTurn2.length}`,
);

const toolUses2 = turn2.content.filter(
  (block): block is ToolUseBlock => block.type === "tool_use",
);

check(
  "el turno con resultados no rompe la API",
  turn2.content.length > 0,
  `stopReason: ${turn2.stopReason}`,
);
check(
  "continúa el trabajo tras los resultados",
  toolUses2.length > 0 || turn2.stopReason === "end_turn",
);

if (toolUses2.some((tool) => tool.name === "write_chapter")) {
  const write = toolUses2.find((tool) => tool.name === "write_chapter")!;
  const content = String(write.input.content ?? "");
  check("write_chapter trae contenido real", content.length > 400, `${content.length} caracteres`);
  console.log(`\n  primeras líneas del capítulo:\n  ${content.slice(0, 200).replace(/\n/g, "\n  ")}…`);
}

// --- Turno 3: una pregunta, que no debe disparar herramientas ---------------
// Sirve para dos cosas: comprobar el modo conversación del prompt, y probar que
// el texto SÍ llega por deltas. gpt-5.2 no mezcla texto y tool_calls en el mismo
// turno (Claude sí), así que en los turnos de trabajo el chat va mudo y solo se
// ve la actividad de herramientas: el texto llega cuando el agente termina.
console.log("\nTurno 3 — pregunta sin acción (modo conversación)");

messages.push({ role: "assistant", content: turn2.content });
messages.push({
  role: "user",
  content: toolUses2.map((tool) => ({
    type: "tool_result" as const,
    tool_use_id: tool.id,
    content: "Hecho.",
  })),
});
messages.push({
  role: "user",
  content: [
    {
      type: "text",
      text: "Sin tocar nada todavía: ¿crees que el índice tiene demasiados capítulos para un ebook corto?",
    },
  ],
});

let streamedText3 = "";
const turn3 = await provider.run({
  system: SYSTEM_PROMPT,
  tools: TOOLS,
  messages,
  onEvent: (event) => {
    if (event.type === "text_delta") streamedText3 += event.text;
  },
});

check("una pregunta devuelve texto por deltas", streamedText3.length > 0);
check(
  "el streaming coincide con el turno",
  streamedText3 ===
    turn3.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
);
check(
  "una pregunta no dispara herramientas",
  turn3.content.every((block) => block.type !== "tool_use"),
);

console.log(`\n  respuesta: ${streamedText3.slice(0, 220)}…`);

console.log(
  `\n  tokens: ${turn1.usage.input + turn2.usage.input + turn3.usage.input} entrada · ` +
    `${turn1.usage.output + turn2.usage.output + turn3.usage.output} salida · ` +
    `${turn1.usage.cacheRead + turn2.usage.cacheRead + turn3.usage.cacheRead} leídos de caché`,
);

console.log(
  failures.length === 0
    ? "\n✅ El proveedor funciona de punta a punta."
    : `\n❌ ${failures.length} fallo(s):\n${failures.map((f) => ` - ${f}`).join("\n")}`,
);

process.exit(failures.length === 0 ? 0 : 1);
