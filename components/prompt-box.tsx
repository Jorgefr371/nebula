"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  { label: "Guía práctica", prompt: "Una guía práctica sobre " },
  { label: "Curso en capítulos", prompt: "Un curso por capítulos que enseñe " },
  { label: "Libro de método", prompt: "Un libro que explique mi método de " },
  { label: "Lead magnet", prompt: "Un ebook corto para captar clientes sobre " },
];

/** Donde la portada deja el primer prompt para que lo recoja el workspace. */
export const PENDING_PROMPT_KEY = "nebula:pending-prompt";

export function PromptBox() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = value.trim().length > 0 && !submitting;

  async function start() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error: insertError } = await supabase
      .from("ebooks")
      .insert({ owner_id: user.id })
      .select()
      .single();

    if (insertError || !data) {
      setSubmitting(false);
      setError(insertError?.message ?? "No se pudo crear el ebook.");
      return;
    }

    sessionStorage.setItem(PENDING_PROMPT_KEY, value.trim());
    router.push(`/ebook/${data.id}`);
  }

  function applySuggestion(prompt: string) {
    setValue(prompt);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="rounded-2xl border border-border-strong bg-surface/80 p-2 shadow-glow backdrop-blur-xl transition-colors focus-within:border-primary/60">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void start();
            }
          }}
          rows={2}
          placeholder="¿De qué va el ebook? Cuanto más concreto, mejor sale…"
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
        />

        <div className="flex items-center justify-end gap-2 px-1 pb-0.5 pt-1">
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
              canSubmit
                ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-raised text-muted-foreground",
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creando…
              </>
            ) : (
              <>
                Empezar el libro
                <ArrowUp className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-center text-[13px] text-destructive">{error}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => applySuggestion(suggestion.prompt)}
            className="rounded-full border border-border bg-surface/60 px-3.5 py-1.5 text-[13px] text-muted-foreground backdrop-blur transition-colors hover:border-border-strong hover:bg-surface-raised hover:text-foreground"
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
