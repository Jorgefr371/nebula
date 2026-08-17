"use client";

import { useEffect, useState } from "react";
import { renderMarkdownSafe } from "@/lib/ebook/render";
import { useEbook } from "@/lib/store/ebook";
import { createClient } from "@/lib/supabase/client";
import type { Chapter } from "@/lib/ebook/types";

/**
 * El libro maquetado. Serif, medida de línea corta y ritmo vertical de página
 * impresa: el preview tiene que parecerse a lo que sale por el EPUB y el PDF, no
 * a una web.
 *
 * Los mismos estilos se usan al imprimir (ver `print.css` en globals), así que
 * lo que se ve aquí es literalmente lo que se exporta a PDF.
 */
function ChapterBody({ chapter }: { chapter: Chapter }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    // DOMPurify se carga dinámicamente porque necesita DOM: importarlo arriba
    // rompería el render en servidor.
    void renderMarkdownSafe(chapter.content).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [chapter.content]);

  return (
    <article className="ebook-chapter" id={`chapter-${chapter.position}`}>
      <h2 className="ebook-chapter-title">
        <span className="ebook-chapter-number">
          Capítulo {chapter.position}
        </span>
        {chapter.title}
      </h2>

      {chapter.content.trim() ? (
        <div
          className="ebook-prose"
          // Saneado con DOMPurify en renderMarkdownSafe.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="ebook-empty">Este capítulo todavía está sin escribir.</p>
      )}
    </article>
  );
}

export function EbookPreview() {
  const ebook = useEbook((state) => state.ebook);
  const chapters = useEbook((state) => state.chapters);
  const selectedChapterId = useEbook((state) => state.selectedChapterId);

  // `cover_path` guarda la ruta en Storage, no una URL: las firmadas caducan y
  // el libro se rompería solo. La URL pública se compone aquí, al pintar —
  // getPublicUrl solo concatena cadenas, así que no hace falta memoizarlo.
  const coverUrl = ebook?.cover_path
    ? createClient().storage.from("images").getPublicUrl(ebook.cover_path).data
        .publicUrl
    : null;

  const visible = selectedChapterId
    ? chapters.filter((chapter) => chapter.id === selectedChapterId)
    : chapters;

  return (
    // print-flow: al imprimir, este contenedor con scroll propio tiene que
    // soltar su altura, o el PDF sale recortado a la altura de la pantalla.
    <div className="print-flow h-full overflow-y-auto bg-background scrollbar-thin">
      <div className="ebook-page">
        {selectedChapterId === null && ebook ? (
          <header className="ebook-titlepage">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="ebook-cover"
                src={coverUrl}
                alt={`Portada de ${ebook.title}`}
              />
            ) : null}
            <h1>{ebook.title}</h1>
            {ebook.subtitle ? <p className="subtitle">{ebook.subtitle}</p> : null}
            {ebook.author ? <p className="author">{ebook.author}</p> : null}
            {ebook.description ? (
              <p className="description">{ebook.description}</p>
            ) : null}
          </header>
        ) : null}

        {visible.length === 0 ? (
          <p className="ebook-empty">
            El libro está vacío. Pídele al agente que proponga un índice.
          </p>
        ) : (
          visible.map((chapter) => (
            <ChapterBody key={chapter.id} chapter={chapter} />
          ))
        )}
      </div>
    </div>
  );
}
