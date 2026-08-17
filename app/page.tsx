import Link from "next/link";
import { BookOpen, Zap } from "lucide-react";
import { PromptBox } from "@/components/prompt-box";
import { Sidebar } from "@/components/sidebar";
import { createClient } from "@/lib/supabase/server";
import type { Ebook } from "@/lib/ebook/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  writing: "En escritura",
  ready: "Listo",
};

export default async function Home() {
  const supabase = await createClient();

  // El workspace es compartido: aquí se ven los libros de todo el equipo, no
  // solo los propios. Es la razón de haber movido el almacenamiento a Supabase.
  const { data } = await supabase
    .from("ebooks")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(24);

  const ebooks = (data ?? []) as Ebook[];

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />

      <main className="relative flex-1 overflow-y-auto scrollbar-thin">
        <div className="bg-hero pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

        <div className="relative flex min-h-full flex-col items-center px-6 pt-20 pb-16 sm:pt-24">
          <div className="mb-10 inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface/70 px-4 py-1.5 text-[13px] backdrop-blur">
            <Zap className="size-3.5 text-primary" />
            <span className="text-muted-foreground">
              Del prompt al EPUB, sin salir de aquí
            </span>
          </div>

          <h1 className="max-w-3xl text-center text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            ¿Qué libro escribimos?
          </h1>
          <p className="mt-4 max-w-xl text-center text-[15px] text-muted-foreground">
            Describe la idea. Nébula propone el índice, escribe los capítulos y
            los maqueta mientras los lees.
          </p>

          <div className="mt-10 flex w-full justify-center">
            <PromptBox />
          </div>

          {ebooks.length > 0 ? (
            <section className="mt-20 w-full max-w-5xl">
              <h2 className="mb-4 text-[13px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Libros del equipo
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ebooks.map((ebook) => (
                  <Link
                    key={ebook.id}
                    href={`/ebook/${ebook.id}`}
                    className="group rounded-2xl border border-border bg-surface/60 p-4 transition-colors hover:border-border-strong hover:bg-surface-raised"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <BookOpen className="size-4 shrink-0 text-primary" />
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {STATUS_LABEL[ebook.status] ?? ebook.status}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[15px] font-medium group-hover:text-foreground">
                      {ebook.title}
                    </p>
                    {ebook.subtitle ? (
                      <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
                        {ebook.subtitle}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
