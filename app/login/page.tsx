"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Acceso con correo y contraseña.
 *
 * Sin enlaces mágicos a propósito: exigen un SMTP propio con dominio verificado,
 * que para un equipo de dos personas es montar una infraestructura de correo
 * para nada. Quien decide si alguien puede entrar sigue siendo la lista blanca
 * de la base de datos (`allowed_emails`), no la existencia de un formulario.
 *
 * Cada uno elige su propia contraseña al registrarse: así no hay ninguna clave
 * circulando por un chat, un correo o un documento compartido.
 */
type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length >= 8 && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    const supabase = createClient();
    const credentials = { email: email.trim(), password };

    const { data, error: authError } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    if (authError) {
      setBusy(false);
      setError(humanise(authError.message, mode));
      return;
    }

    // Si el proyecto exige confirmar el correo, signUp devuelve usuario pero no
    // sesión. Sin decirlo, la pantalla se quedaría colgada sin explicación.
    if (!data.session) {
      setBusy(false);
      setError(
        "Cuenta creada, pero el proyecto exige confirmar el correo. Desactiva " +
          '"Confirm email" en Supabase → Authentication → Sign In / Providers → Email.',
      );
      return;
    }

    // Recarga desde el servidor para que el proxy vea la cookie de sesión nueva.
    router.refresh();
    router.push("/");
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

        <form
          onSubmit={submit}
          className="rounded-2xl border border-border bg-surface p-5"
        >
          <div className="mb-4 flex rounded-xl bg-background p-1">
            {(
              [
                { id: "signin", label: "Entrar" },
                { id: "signup", label: "Crear cuenta" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  setError(null);
                }}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                  mode === id
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <label
            htmlFor="email"
            className="mb-1.5 block text-[13px] text-muted-foreground"
          >
            Correo del equipo
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

          <label
            htmlFor="password"
            className="mt-3 mb-1.5 block text-[13px] text-muted-foreground"
          >
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "signup" ? "Mínimo 8 caracteres" : "••••••••"}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary/60 placeholder:text-muted-foreground/60"
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {mode === "signin" ? "Entrando…" : "Creando cuenta…"}
              </>
            ) : mode === "signin" ? (
              "Entrar"
            ) : (
              "Crear cuenta"
            )}
          </button>

          {error ? (
            <p className="mt-3 text-[13px] leading-relaxed text-destructive">
              {error}
            </p>
          ) : null}

          <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground/80">
            Herramienta interna. Solo los correos autorizados pueden registrarse.
          </p>
        </form>
      </div>
    </div>
  );
}

/**
 * Supabase envuelve el rechazo de la lista blanca en un genérico "Database error
 * saving new user", que es exacto y completamente inútil para quien acaba de
 * escribir mal su correo.
 */
function humanise(message: string, mode: Mode): string {
  if (/database error saving new user/i.test(message)) {
    return "Ese correo no está autorizado. Pide que te añadan al equipo, o revisa si te has equivocado al escribirlo.";
  }
  if (/invalid login credentials/i.test(message)) {
    return mode === "signin"
      ? "Correo o contraseña incorrectos. Si aún no tienes cuenta, usa «Crear cuenta»."
      : message;
  }
  if (/user already registered/i.test(message)) {
    return "Ya existe una cuenta con ese correo. Usa «Entrar».";
  }
  if (/password/i.test(message) && /least|short|weak/i.test(message)) {
    return "La contraseña es demasiado corta. Usa al menos 8 caracteres.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  }
  return message;
}
