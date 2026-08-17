import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import type { Provider } from "./types";

export type { Provider, ProviderEvent, ProviderTurn } from "./types";

/**
 * Elige proveedor según la clave que haya configurada.
 *
 * OpenAI primero cuando ambas están puestas, porque es la que se configura
 * explícitamente; `MODEL_PROVIDER` fuerza una de las dos si hace falta.
 */
export function resolveProvider(): Provider | { error: string } {
  const forced = process.env.MODEL_PROVIDER?.toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (forced === "anthropic") {
    return anthropicKey
      ? createAnthropicProvider(anthropicKey)
      : { error: "MODEL_PROVIDER=anthropic pero falta ANTHROPIC_API_KEY." };
  }

  if (forced === "openai") {
    return openaiKey
      ? createOpenAIProvider(openaiKey)
      : { error: "MODEL_PROVIDER=openai pero falta OPENAI_API_KEY." };
  }

  if (openaiKey) return createOpenAIProvider(openaiKey);
  if (anthropicKey) return createAnthropicProvider(anthropicKey);

  return {
    error:
      "No hay ninguna clave de modelo configurada. Añade OPENAI_API_KEY o ANTHROPIC_API_KEY a .env.local y reinicia el servidor.",
  };
}
