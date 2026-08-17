"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import {
  joinEbookChannel,
  leaveEbookChannel,
  publishPhase,
} from "@/lib/realtime/ebook-channel";
import { useEbook } from "@/lib/store/ebook";
import { Chat } from "./chat";
import { PeerBadges } from "./peer-badges";
import { ChapterList } from "./chapter-list";
import { EbookPreview } from "./ebook-preview";
import { ExportMenu } from "./export-menu";

export function Workspace({ ebookId }: { ebookId: string }) {
  const load = useEbook((state) => state.load);
  const hydrated = useEbook((state) => state.hydrated);
  const ebook = useEbook((state) => state.ebook);

  useEffect(() => {
    void load(ebookId);
  }, [load, ebookId]);

  // Canal de colaboración: cambios en vivo y presencia del equipo.
  useEffect(() => {
    const store = useEbook.getState();

    void joinEbookChannel(ebookId, {
      onChapterUpsert: (chapter) =>
        useEbook.getState().applyRemoteChapter(chapter),
      onChapterDelete: (id) => useEbook.getState().applyRemoteChapterDelete(id),
      onEbookUpdate: (remote) => useEbook.getState().applyRemoteEbook(remote),
      onPeersChange: (peers) => useEbook.getState().setPeers(peers),
    });

    // Publicar la fase del agente para que los demás sepan si pueden escribir.
    // Zustand notifica en cada cambio de estado, así que se filtra por fase para
    // no inundar el canal con un `track` por cada delta del streaming.
    let lastPhase = store.phase;
    const unsubscribe = useEbook.subscribe((state) => {
      if (state.phase === lastPhase) return;
      lastPhase = state.phase;
      publishPhase(state.phase);
    });

    return () => {
      unsubscribe();
      void leaveEbookChannel();
    };
  }, [ebookId]);

  return (
    // Las clases print-* las consume @media print en globals.css: marcan qué
    // desaparece al imprimir y qué contenedores tienen que soltar sus límites
    // de altura para que el libro pagine entero.
    <div className="print-shell flex h-dvh overflow-hidden">
      <div className="print-hide flex w-[400px] shrink-0 flex-col border-r border-border">
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-linear-to-br from-primary to-accent">
              <Sparkles className="size-3.5 text-primary-foreground" />
            </span>
            <span className="text-sm font-semibold">Nébula</span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <PeerBadges />
            <ExportMenu />
          </div>
        </header>

        <Chat />
      </div>

      <aside className="print-hide w-60 shrink-0 border-r border-border bg-surface">
        <ChapterList />
      </aside>

      <main className="print-flow min-w-0 flex-1">
        {hydrated && !ebook ? (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
            No se encontró este libro, o no tienes acceso.
          </div>
        ) : (
          // `ebook-print-root` es lo que sobrevive al @media print: al exportar a
          // PDF se imprime este subárbol y desaparece todo lo demás.
          <div className="ebook-print-root h-full">
            <EbookPreview />
          </div>
        )}
      </main>
    </div>
  );
}
