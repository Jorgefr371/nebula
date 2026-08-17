"use client";

import { useState } from "react";
// lucide-react v1 retiró los iconos de marca, así que GitHub va con GitBranch.
import { BookDown, Download, FileText, GitBranch, Loader2 } from "lucide-react";
import { buildEpub, downloadBlob, slugify } from "@/lib/export/epub";
import { useEbook } from "@/lib/store/ebook";
import { cn } from "@/lib/utils";

export function ExportMenu() {
  const ebook = useEbook((state) => state.ebook);
  const chapters = useEbook((state) => state.chapters);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const written = chapters.filter((chapter) => chapter.content.trim());
  const canExport = Boolean(ebook) && written.length > 0;

  async function exportEpub() {
    if (!ebook) return;
    setBusy("epub");
    setError(null);
    try {
      const blob = await buildEpub(ebook, chapters);
      downloadBlob(blob, `${slugify(ebook.title)}.epub`);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function exportPdf() {
    // El PDF es la impresión del navegador sobre el mismo marcado del preview.
    // Una librería de PDF en cliente daría peor tipografía y ningún control de
    // saltos de página; el motor de impresión ya sabe hacer las dos cosas.
    setOpen(false);
    requestAnimationFrame(() => window.print());
  }

  async function exportGithub() {
    if (!ebook) return;
    setBusy("github");
    setError(null);
    try {
      const response = await fetch("/api/github/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ebookId: ebook.id }),
      });

      const payload = await response.json();

      if (response.status === 401 && payload.authorizeUrl) {
        // Sin sesión de GitHub todavía: llevamos al usuario a autorizarla y al
        // volver reintenta.
        window.location.href = payload.authorizeUrl;
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Error exportando");

      window.open(payload.url, "_blank", "noopener");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={!canExport}
        title={canExport ? undefined : "Escribe algún capítulo primero"}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
      >
        <Download className="size-3.5" />
        Exportar
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1.5 w-60 overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-glow">
            {(
              [
                {
                  id: "epub",
                  label: "EPUB",
                  hint: "Para Kindle, Kobo y tiendas",
                  icon: BookDown,
                  action: exportEpub,
                },
                {
                  id: "pdf",
                  label: "PDF",
                  hint: "Maquetado en A5, listo para imprimir",
                  icon: FileText,
                  action: exportPdf,
                },
                {
                  id: "github",
                  label: "GitHub",
                  hint: "Un .md por capítulo, versionado",
                  icon: GitBranch,
                  action: exportGithub,
                },
              ] as const
            ).map(({ id, label, hint, icon: Icon, action }) => (
              <button
                key={id}
                type="button"
                onClick={() => void action()}
                disabled={busy !== null}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                  "hover:bg-surface disabled:opacity-50",
                )}
              >
                {busy === id ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="block text-[13px]">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {hint}
                  </span>
                </span>
              </button>
            ))}

            {error ? (
              <p className="border-t border-border px-3 py-2 text-[11px] text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
