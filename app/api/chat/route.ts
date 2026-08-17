import { resolveProvider } from "@/lib/agent/providers";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { TOOLS } from "@/lib/agent/tools";
import type { ChatMessage } from "@/lib/store/types";

/**
 * Proxy de streaming hacia el modelo.
 *
 * Esta ruta es deliberadamente sin estado: quien manda el bucle del agente es el
 * cliente, porque las herramientas operan sobre Supabase con la sesión del
 * usuario. El servidor existe por un único motivo: que la clave del modelo no
 * llegue nunca al navegador.
 *
 * Qué proveedor se usa lo decide `resolveProvider()` según la clave presente.
 */

export const maxDuration = 300;

type ClientEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; name: string }
  | {
      type: "done";
      stopReason: string | null;
      content: unknown[];
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
    }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  const provider = resolveProvider();
  if ("error" in provider) {
    return Response.json({ error: provider.error }, { status: 500 });
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "Se esperaba un array 'messages' no vacío" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: ClientEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const turn = await provider.run({
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: messages as ChatMessage[],
          onEvent: send,
          signal: request.signal,
        });

        // El cliente añade `content` literal al historial. Importa: en Anthropic
        // los bloques de pensamiento llevan una firma que la API rechaza si se
        // modifica, así que los bloques viajan de vuelta sin reconstruirse.
        send({
          type: "done",
          stopReason: turn.stopReason,
          content: turn.content,
          usage: turn.usage,
        });
      } catch (error) {
        send({ type: "error", message: describeError(error) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/**
 * Los SDKs traen el detalle útil en sitios distintos. Un "500" pelado deja al
 * usuario sin saber si le falta saldo, si el modelo no existe o si se cayó la red.
 */
function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      status?: number;
      message?: string;
      error?: { message?: string };
    };
    const detail = candidate.error?.message ?? candidate.message;
    if (detail) {
      return candidate.status ? `${candidate.status}: ${detail}` : detail;
    }
  }
  return error instanceof Error
    ? error.message
    : "Error desconocido llamando al modelo";
}
