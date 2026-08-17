/**
 * Wire-shaped conversation types.
 *
 * These mirror the Anthropic Messages API content blocks rather than inventing a
 * separate chat model, because the history *is* what we send back on every turn.
 * A parallel UI-only model would mean two sources of truth to keep in sync, and
 * any drift between them shows up as the agent forgetting what it just did.
 */

export type TextBlock = { type: "text"; text: string };

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/**
 * Thinking blocks must be echoed back byte-identical (signature included) or the
 * API rejects the turn, so we store them as received and never touch them.
 */
export type ThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature: string;
};

export type RedactedThinkingBlock = {
  type: "redacted_thinking";
  data: string;
};

export type AssistantBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock;

export type UserBlock = TextBlock | ToolResultBlock;

export type ChatMessage =
  | { role: "user"; content: UserBlock[] }
  | { role: "assistant"; content: AssistantBlock[] };

export function textOf(message: ChatMessage): string {
  return message.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function toolUsesOf(message: ChatMessage): ToolUseBlock[] {
  if (message.role !== "assistant") return [];
  return message.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use",
  );
}

/** True for the synthetic user turns that only carry tool results. */
export function isToolResultTurn(message: ChatMessage): boolean {
  return (
    message.role === "user" &&
    message.content.length > 0 &&
    message.content.every((block) => block.type === "tool_result")
  );
}
