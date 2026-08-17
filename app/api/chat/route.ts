import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { TOOLS } from "@/lib/agent/tools";

/**
 * Streaming proxy to the Claude Messages API.
 *
 * This route is deliberately stateless: the client owns the conversation and the
 * agent loop, because the agent's tools (write a file, npm install, read the dev
 * server's logs) can only run where WebContainer lives — the browser. The server
 * exists for exactly one reason: to keep ANTHROPIC_API_KEY off the client.
 */

const MODEL = "claude-opus-5";

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Falta ANTHROPIC_API_KEY. Añádela a .env.local y reinicia el servidor.",
      },
      { status: 500 },
    );
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

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ClientEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const claudeStream = client.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          // The cache breakpoint sits on the last system block, which caches
          // tools + system together (render order is tools → system → messages).
          // Nothing dynamic may appear above this point.
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: TOOLS,
          // xhigh is the recommended level for coding and agentic work.
          output_config: { effort: "xhigh" },
          // Adaptive thinking defaults to omitted output; we want the summary so
          // the UI can show what the agent is reasoning about.
          thinking: { type: "adaptive", display: "summarized" },
          messages: messages as Anthropic.MessageParam[],
        });

        claudeStream.on("streamEvent", (event) => {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              send({ type: "tool_start", name: event.content_block.name });
            }
            return;
          }
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              send({ type: "text_delta", text: event.delta.text });
            } else if (event.delta.type === "thinking_delta") {
              send({ type: "thinking_delta", text: event.delta.thinking });
            }
          }
        });

        const message = await claudeStream.finalMessage();

        // The client appends `content` verbatim. That matters: thinking blocks
        // carry a signature the API rejects if it is modified, so the assembled
        // blocks travel back untouched rather than being rebuilt from deltas.
        send({
          type: "done",
          stopReason: message.stop_reason,
          content: message.content,
          usage: {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
            cacheRead: message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
          },
        });
      } catch (error) {
        const message =
          error instanceof Anthropic.APIError
            ? `${error.status ?? ""} ${error.message}`.trim()
            : error instanceof Error
              ? error.message
              : "Error desconocido llamando al modelo";
        send({ type: "error", message });
      } finally {
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
