import Anthropic from "@anthropic-ai/sdk";
import type { AssistantBlock } from "@/lib/store/types";
import type { Provider, ProviderRequest, ProviderTurn } from "./types";

/**
 * Proveedor Anthropic.
 *
 * Es el formato nativo: no hay traducción que hacer, los bloques van y vuelven
 * tal cual. Lo que sí es específico de aquí es la caché de prompt explícita —
 * el breakpoint va en el último bloque de `system`, que al renderizarse después
 * de `tools` cachea prompt y herramientas juntos.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

export function createAnthropicProvider(apiKey: string): Provider {
  const client = new Anthropic({ apiKey });

  return {
    id: "anthropic",
    model: MODEL,

    async run({
      system,
      tools,
      messages,
      onEvent,
      signal,
    }: ProviderRequest): Promise<ProviderTurn> {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          system: [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools,
          output_config: { effort: "high" },
          thinking: { type: "adaptive", display: "summarized" },
          messages: messages as Anthropic.MessageParam[],
        },
        { signal },
      );

      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            onEvent({ type: "tool_start", name: event.content_block.name });
          }
          return;
        }
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            onEvent({ type: "text_delta", text: event.delta.text });
          } else if (event.delta.type === "thinking_delta") {
            onEvent({ type: "thinking_delta", text: event.delta.thinking });
          }
        }
      });

      const message = await stream.finalMessage();

      return {
        // Literal: los bloques de thinking llevan firma y la API los rechaza si
        // se modifican al devolverlos.
        content: message.content as AssistantBlock[],
        stopReason: message.stop_reason,
        usage: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}
