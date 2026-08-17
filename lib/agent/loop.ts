"use client";

import { useEbook } from "@/lib/store/ebook";
import type {
  AssistantBlock,
  ChatMessage,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "@/lib/store/types";
import { runTool } from "./executors";
import { buildContextBlock } from "./system-prompt";

/**
 * Tope de idas y vueltas por mensaje del usuario. Escribir un libro son muchas
 * llamadas (una por capítulo), de ahí que sea generoso — pero acotado, para que
 * un agente perdido no gire en el vacío gastando tokens.
 */
const MAX_ITERATIONS = 30;

type TurnResult = {
  content: AssistantBlock[];
  stopReason: string | null;
};

/**
 * El estado del libro se adjunta al último turno humano en el momento de la
 * petición y NO se guarda en el historial. Dos motivos: la transcripción del
 * chat queda limpia, y la conversación no acumula doce copias desfasadas del
 * índice que el modelo luego tiene que reconciliar.
 */
function prepareRequestMessages(messages: ChatMessage[]): ChatMessage[] {
  const { ebook, chapters } = useEbook.getState();
  const contextBlock = buildContextBlock({ ebook, chapters });

  let target = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message.role === "user" &&
      message.content.some((block) => block.type === "text")
    ) {
      target = i;
      break;
    }
  }
  if (target === -1) return messages;

  return messages.map((message, index) => {
    if (index !== target || message.role !== "user") return message;
    return {
      role: "user",
      content: [
        ...message.content,
        { type: "text", text: contextBlock } satisfies TextBlock,
      ],
    };
  });
}

async function streamTurn(messages: ChatMessage[]): Promise<TurnResult> {
  const store = useEbook.getState();

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: prepareRequestMessages(messages) }),
  });

  if (!response.ok || !response.body) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) detail = payload.error;
    } catch {
      /* nos quedamos con el código de estado */
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TurnResult | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;

      const event = JSON.parse(line.slice(6));

      switch (event.type) {
        case "text_delta":
          store.patchStream({
            text: useEbook.getState().stream.text + event.text,
          });
          store.setPhase("working");
          break;
        case "thinking_delta":
          store.patchStream({
            thinking: useEbook.getState().stream.thinking + event.text,
          });
          break;
        case "tool_start":
          store.patchStream({
            activeTools: [...useEbook.getState().stream.activeTools, event.name],
          });
          store.setPhase("working");
          break;
        case "done":
          result = {
            content: event.content as AssistantBlock[],
            stopReason: event.stopReason,
          };
          break;
        case "error":
          streamError = event.message;
          break;
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error("El modelo cerró la conexión sin responder.");
  return result;
}

export async function runAgent(userText: string): Promise<void> {
  const store = useEbook.getState();

  store.beginTurn();
  await store.appendMessage({
    role: "user",
    content: [{ type: "text", text: userText }],
  });

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const turn = await streamTurn(useEbook.getState().messages);

      // Se añade literal: los bloques de thinking llevan firma y la API los
      // rechaza si se modifican.
      await useEbook.getState().appendMessage({
        role: "assistant",
        content: turn.content,
      });
      useEbook.getState().resetStream();

      if (turn.stopReason === "refusal") {
        useEbook
          .getState()
          .setError(
            "El modelo declinó esta petición por sus políticas de seguridad. Reformúlala o pide otra cosa.",
          );
        return;
      }

      const toolUses = turn.content.filter(
        (block): block is ToolUseBlock => block.type === "tool_use",
      );

      // Un turno en pausa no trae herramientas; reenviar lo reanuda del lado del
      // servidor.
      if (turn.stopReason === "pause_turn") continue;

      if (toolUses.length === 0) {
        useEbook.getState().setPhase("idle");
        return;
      }

      // Todos los resultados del turno van en UN ÚNICO mensaje de usuario. Si se
      // reparten en varios, el modelo aprende a dejar de pedir herramientas en
      // paralelo.
      const results: ToolResultBlock[] = [];
      for (const toolUse of toolUses) {
        const outcome = await runTool(toolUse.name, toolUse.input);
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: outcome.output,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }

      await useEbook.getState().appendMessage({ role: "user", content: results });
      useEbook.getState().patchStream({ activeTools: [] });
    }

    useEbook
      .getState()
      .setError(
        `El agente alcanzó el límite de ${MAX_ITERATIONS} pasos sin terminar. Pídele que siga desde donde lo dejó.`,
      );
  } catch (error) {
    useEbook
      .getState()
      .setError(error instanceof Error ? error.message : String(error));
  } finally {
    if (useEbook.getState().phase !== "error") {
      useEbook.getState().setPhase("idle");
    }
    useEbook.getState().resetStream();
  }
}
