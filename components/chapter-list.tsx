"use client";

import { BookOpen, FileText } from "lucide-react";
import { countWords, readingMinutes } from "@/lib/ebook/types";
import { useEbook } from "@/lib/store/ebook";
import { cn } from "@/lib/utils";

export function ChapterList() {
  const chapters = useEbook((state) => state.chapters);
  const selectedChapterId = useEbook((state) => state.selectedChapterId);
  const setSelectedChapter = useEbook((state) => state.setSelectedChapter);
  const touched = useEbook((state) => state.touched);
  const remoteTouched = useEbook((state) => state.remoteTouched);

  const totalWords = chapters.reduce(
    (sum, chapter) => sum + countWords(chapter.content),
    0,
  );

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={() => setSelectedChapter(null)}
        className={cn(
          "flex items-center gap-2 border-b border-border px-3 py-2.5 text-left text-[13px] transition-colors",
          selectedChapterId === null
            ? "bg-surface-raised text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <BookOpen className="size-3.5 shrink-0" />
        <span className="flex-1">Libro completo</span>
        {totalWords > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {readingMinutes(totalWords)} min
          </span>
        ) : null}
      </button>

      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {chapters.length === 0 ? (
          <p className="px-3 py-4 text-[13px] leading-relaxed text-muted-foreground">
            Todavía no hay índice. Pídeselo al agente en el chat.
          </p>
        ) : null}

        {chapters.map((chapter) => {
          const words = countWords(chapter.content);
          const isSelected = selectedChapterId === chapter.id;
          const isTouched = touched.includes(chapter.id);
          const isRemote = remoteTouched.includes(chapter.id);

          return (
            <button
              key={chapter.id}
              type="button"
              onClick={() => setSelectedChapter(chapter.id)}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                isSelected
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
                {chapter.position}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">
                  {chapter.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                  {words === 0 ? (
                    <>
                      <FileText className="size-3" />
                      Sin escribir
                    </>
                  ) : (
                    `${words.toLocaleString("es")} palabras`
                  )}
                </span>
              </span>

              {/* Dos marcas distintas a propósito: lo que acaba de escribir tu
                  agente y lo que ha cambiado otra persona no son lo mismo, y
                  confundirlas hace que la lista mienta. */}
              {isTouched ? (
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                  title="Modificado en este turno"
                />
              ) : isRemote ? (
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full ring-2 ring-accent"
                  title="Cambiado por otra persona del equipo"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {totalWords > 0 ? (
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          {totalWords.toLocaleString("es")} palabras ·{" "}
          {readingMinutes(totalWords)} min de lectura
        </div>
      ) : null}
    </div>
  );
}
