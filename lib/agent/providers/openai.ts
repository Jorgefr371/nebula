import OpenAI from "openai";
import type {
  AssistantBlock,
  ChatMessage,
  ToolResultBlock,
  ToolUseBlock,
} from "@/lib/store/types";
import type { ToolDefinition } from "../tools";
import type { Provider, ProviderRequest, ProviderTurn } from "./types";

/**
 * Proveedor OpenAI.
 *
 * Traduce entre el formato canónico (bloques de contenido) y Chat Completions.
 * Cuatro diferencias que hay que salvar y que no son obvias:
 *
 *  1. Las llamadas a herramientas son `tool_calls` con los argumentos como
 *     STRING JSON, no como objeto.
 *  2. Cada resultado va en su propio mensaje `role: "tool"`. Anthropic mete
 *     todos los resultados de un turno en un único mensaje de usuario; aquí hay
 *     que desplegarlos, uno por tool_call_id.
 *  3. No hay bloques de pensamiento que devolver: el razonamiento de los modelos
 *     de la serie 5 se queda del lado del servidor. Los bloques de thinking que
 *     pueda haber en el historial (de una conversación empezada con Anthropic)
 *     se descartan al traducir, o la API los rechaza.
 *  4. La caché de prompt es automática por prefijo a partir de 1024 tokens: no
 *     hay breakpoints que colocar. La regla de mantener el prompt de sistema
 *     byte-estable sigue valiendo igual.
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";

function toOpenAITools(
  tools: ToolDefinition[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      // El esquema ya viene con additionalProperties:false y todos los campos
      // en required, que es justo lo que exige el modo estricto.
      strict: true,
    },
  }));
}

function toOpenAIMessages(
  system: string,
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const message of messages) {
    if (message.role === "user") {
      const toolResults = message.content.filter(
        (block): block is ToolResultBlock => block.type === "tool_result",
      );

      // Un turno de resultados de herramienta se despliega en un mensaje `tool`
      // por cada llamada.
      if (toolResults.length > 0) {
        for (const result of toolResults) {
          out.push({
            role: "tool",
            tool_call_id: result.tool_use_id,
            content: result.content,
          });
        }
        continue;
      }

      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (text) out.push({ role: "user", content: text });
      continue;
    }

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const toolUses = message.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    // Un turno de asistente sin texto ni herramientas no aporta nada y la API
    // rechaza `content: null` sin tool_calls.
    if (!text && toolUses.length === 0) continue;

    out.push({
      role: "assistant",
      content: text || null,
      ...(toolUses.length > 0
        ? {
            tool_calls: toolUses.map((toolUse) => ({
              id: toolUse.id,
              type: "function" as const,
              function: {
                name: toolUse.name,
                arguments: JSON.stringify(toolUse.input),
              },
            })),
          }
        : {}),
    });
  }

  return out;
}

/** finish_reason de OpenAI → los valores de stop_reason que usa el bucle. */
function normaliseStopReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return reason ?? null;
  }
}

export function createOpenAIProvider(apiKey: string): Provider {
  const client = new OpenAI({ apiKey });

  return {
    id: "openai",
    model: MODEL,

    async run({
      system,
      tools,
      messages,
      onEvent,
      signal,
    }: ProviderRequest): Promise<ProviderTurn> {
      const stream = await client.chat.completions.create(
        {
          model: MODEL,
          messages: toOpenAIMessages(system, messages),
          tools: toOpenAITools(tools),
          stream: true,
          stream_options: { include_usage: true },
          // Escribir capítulos enteros necesita espacio; con menos, el modelo
          // trunca a mitad de párrafo y el capítulo llega roto.
          max_completion_tokens: 32000,
        },
        { signal },
      );

      let text = "";
      // Los argumentos de una tool_call llegan troceados: hay que acumularlos
      // por índice antes de poder parsearlos.
      const toolCalls = new Map<
        number,
        { id: string; name: string; args: string; announced: boolean }
      >();
      let finishReason: string | null = null;
      let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            cacheRead:
              chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            // OpenAI no cobra la escritura de caché aparte, así que no hay
            // equivalente a cache_creation_input_tokens.
            cacheWrite: 0,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          onEvent({ type: "text_delta", text: delta.content });
        }

        for (const call of delta.tool_calls ?? []) {
          const index = call.index;
          const existing = toolCalls.get(index) ?? {
            id: "",
            name: "",
            args: "",
            announced: false,
          };

          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name += call.function.name;
          if (call.function?.arguments) existing.args += call.function.arguments;

          // Avisar a la UI en cuanto se conoce el nombre, no al final: es lo que
          // hace que el indicador diga "Escribiendo" mientras aún genera.
          if (!existing.announced && existing.name) {
            existing.announced = true;
            onEvent({ type: "tool_start", name: existing.name });
          }

          toolCalls.set(index, existing);
        }
      }

      const content: AssistantBlock[] = [];
      if (text) content.push({ type: "text", text });

      for (const call of [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value)) {
        let input: Record<string, unknown> = {};
        try {
          input = call.args ? JSON.parse(call.args) : {};
        } catch {
          // Argumentos ilegibles: se pasa igualmente como tool_use para que el
          // ejecutor falle con un mensaje claro que el modelo pueda corregir,
          // en vez de romper el turno entero aquí.
          input = { __parse_error: call.args };
        }

        content.push({
          type: "tool_use",
          id: call.id || `call_${call.name}`,
          name: call.name,
          input,
        });
      }

      return {
        content,
        stopReason: normaliseStopReason(finishReason),
        usage,
      };
    },
  };
}
