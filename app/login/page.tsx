"use client";

import { useState } from "react";
import { Loader2, Mail, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Enlace mágico por correo. Sin contraseñas: no hay nada que filtrar, nada que
 * rotar, y el acceso queda cerrado por la lista blanca del servidor — un correo
 * que no esté en `allowed_emails` no puede darse de alta aunque reciba el enlace.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setState("error");
      setMessage(humanise(error.message));
      return;
    }

    setState("sent");
  }

/**
 * Cuando el trigger de la lista blanca rechaza un alta, Supabase la envuelve en
 * un genérico "Database error saving new user". Es exacto y completamente
 * inútil para quien acaba de escribir mal su correo.
 */
function humanise(message: string): string {
  if (/database error saving new user/i.test(message)) {
    return "Ese correo no está autorizado. Pide que te añadan al equipo, o revisa si te has equivocado al escribirlo.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  }
  return message;
}

  return (
    <div className="bg-hero flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-linear-to-br from-primary to-accent">
            <Sparkles className="size-5 text-primary-foreground" />
          </span>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Nébula</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Escribe ebooks con IA
            </p>
          </div>
        </div>

        {state === "sent" ? (
          <div className="rounded-2xl border border-border bg-surface p-5 text-center">
            <Mail className="mx-auto mb-3 size-5 text-primary" />
            <p className="text-sm">
              Te hemos enviado un enlace a{" "}
              <span className="font-medium">{email}</span>.
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Ábrelo desde este mismo navegador para entrar.
            </p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="rounded-2xl border border-border bg-surface p-5"
          >
            <label
              htmlFor="email"
              className="mb-1.5 block text-[13px] text-muted-foreground"
            >
              Tu correo del equipo
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nombre@equipo.com"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary/60 placeholder:text-muted-foreground/60"
            />

            <button
              type="submit"
              disabled={state === "sending" || !email.trim()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "sending" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                "Enviarme el enlace"
              )}
            </button>

            {state === "error" ? (
              <p className="mt-3 text-[13px] text-destructive">{message}</p>
            ) : null}

            <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground/80">
              Nébula es una herramienta interna. Solo los correos autorizados
              pueden entrar.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
