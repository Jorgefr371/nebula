import type { AssistantBlock, ChatMessage } from "@/lib/store/types";
import type { ToolDefinition } from "../tools";

/**
 * Costura entre el agente y el proveedor del modelo.
 *
 * El formato canónico interno es el de bloques de contenido de Anthropic: es lo
 * que ya hay guardado en Postgres, lo que lee la UI y contra lo que está escrito
 * el bucle. Cada proveedor traduce a su formato y vuelve, en vez de obligar al
 * resto de la aplicación a conocer dos modelos de datos.
 */

export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; name: string };

export type ProviderTurn = {
  /** Bloques del turno del asistente, en el formato canónico. */
  content: AssistantBlock[];
  /** Normalizado a los valores de Anthropic: end_turn, tool_use, refusal… */
  stopReason: string | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type ProviderRequest = {
  system: string;
  tools: ToolDefinition[];
  messages: ChatMessage[];
  /** Se llama con cada evento incremental para que la UI vaya pintando. */
  onEvent: (event: ProviderEvent) => void;
  signal?: AbortSignal;
};

export type Provider = {
  id: "anthropic" | "openai";
  model: string;
  run: (request: ProviderRequest) => Promise<ProviderTurn>;
};
