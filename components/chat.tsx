"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Brain, Loader2 } from "lucide-react";
import { runAgent } from "@/lib/agent/loop";
import { TOOL_LABELS } from "@/lib/agent/tools";
import { useEbook } from "@/lib/store/ebook";
import {
  isToolResultTurn,
  textOf,
  toolUsesOf,
  type ChatMessage,
} from "@/lib/store/types";
import { PENDING_PROMPT_KEY } from "./prompt-box";
import { cn } from "@/lib/utils";

function ToolLine({ name, input }: { name: string; input: Record<string, unknown> }) {
  const label = TOOL_LABELS[name] ?? name;
  // Cada herramienta identifica su objetivo de forma distinta; se muestra el
  // dato que le dice algo al usuario ("Escribiendo capítulo 3").
  const target =
    typeof input.title === "string"
      ? input.title
      : typeof input.position === "number"
        ? `capítulo ${input.position}`
        : Array.isArray(input.chapters)
          ? `${input.chapters.length} capítulos`
          : "";

  return (
    <div className="flex items-center gap-2 py-0.5 text-[13px] text-muted-foreground">
      <span className="size-1 shrink-0 rounded-full bg-primary/70" />
      <span>{label}</span>
      {target ? (
        <code className="truncate font-mono text-[12px] text-foreground/70">
          {target}
        </code>
      ) : null}
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  // Tool-result turns are plumbing, not conversation.
  if (isToolResultTurn(message)) return null;

  const text = textOf(message);
  const toolUses = toolUsesOf(message);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-raised px-3.5 py-2.5 text-[14px] whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {text ? (
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{text}</p>
      ) : null}
      {toolUses.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface/60 px-3 py-2">
          {toolUses.map((tool) => (
            <ToolLine key={tool.id} name={tool.name} input={tool.input} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Chat() {
  const messages = useEbook((state) => state.messages);
  const phase = useEbook((state) => state.phase);
  const error = useEbook((state) => state.error);
  const stream = useEbook((state) => state.stream);
  const hydrated = useEbook((state) => state.hydrated);

  const [draft, setDraft] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const kickedOff = useRef(false);

  const busy = phase === "thinking" || phase === "working";

  // La portada deja el primer prompt en sessionStorage. Se espera a que el libro
  // esté cargado: el agente necesita su id para escribir capítulos.
  useEffect(() => {
    if (!hydrated || kickedOff.current) return;
    const pending = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!pending) return;

    kickedOff.current = true;
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    void runAgent(pending);
  }, [hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, stream.text]);

  function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void runAgent(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto px-4 py-5 scrollbar-thin"
      >
        {messages.length === 0 && !busy ? (
          <p className="text-[14px] text-muted-foreground">
            Cuéntame de qué va el libro y para quién es.
          </p>
        ) : null}

        {messages.map((message, index) => (
          <Message key={index} message={message} />
        ))}

        {/* Live turn, not yet committed to history. */}
        {busy ? (
          <div className="space-y-2">
            {stream.thinking ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowThinking((value) => !value)}
                  className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Brain className="size-3.5" />
                  {showThinking ? "Ocultar razonamiento" : "Ver razonamiento"}
                </button>
                {showThinking ? (
                  <p className="mt-1.5 rounded-lg border border-border bg-surface/60 p-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {stream.thinking}
                  </p>
                ) : null}
              </div>
            ) : null}

            {stream.text ? (
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
                {stream.text}
              </p>
            ) : null}

            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              {stream.activeTools.length > 0
                ? (TOOL_LABELS[stream.activeTools.at(-1)!] ??
                  stream.activeTools.at(-1))
                : "Pensando…"}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[13px]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="text-foreground/90">{error}</span>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <div className="rounded-2xl border border-border bg-surface p-2 transition-colors focus-within:border-primary/60">
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              const el = event.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={busy ? "Nébula está escribiendo…" : "Pide un cambio…"}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex justify-end px-1">
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || busy}
              className={cn(
                "grid size-8 place-items-center rounded-lg transition-colors",
                draft.trim() && !busy
                  ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                  : "cursor-not-allowed bg-surface-raised text-muted-foreground",
              )}
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
