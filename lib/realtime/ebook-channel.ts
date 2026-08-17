"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Chapter, Ebook } from "@/lib/ebook/types";
import { createClient } from "@/lib/supabase/client";

/**
 * Canal de colaboración de un libro.
 *
 * Hace dos cosas sobre el mismo websocket:
 *
 *  1. **Postgres Changes** en `chapters` y `ebooks`, filtrados por este libro:
 *     lo que escribe el agente de un compañero aparece en tu pantalla sin
 *     refrescar.
 *  2. **Presencia**: quién tiene el libro abierto y qué está haciendo. Esto es
 *     lo que de verdad evita el pisotón — Realtime te enseña los cambios, pero
 *     no impide que dos agentes escriban a la vez y gane el último. Sabiendo que
 *     el agente de otra persona está trabajando, se puede bloquear el envío.
 */

export type Peer = {
  userId: string;
  name: string;
  /** Fase del agente de esa persona; "working" es lo que bloquea a los demás. */
  phase: "idle" | "thinking" | "working" | "error";
};

export type EbookChannelHandlers = {
  onChapterUpsert: (chapter: Chapter) => void;
  onChapterDelete: (chapterId: string) => void;
  onEbookUpdate: (ebook: Ebook) => void;
  onPeersChange: (peers: Peer[]) => void;
};

let channel: RealtimeChannel | null = null;
let joinedEbookId: string | null = null;
let me: { userId: string; name: string } | null = null;
let myPhase: Peer["phase"] = "idle";

export async function joinEbookChannel(
  ebookId: string,
  handlers: EbookChannelHandlers,
): Promise<void> {
  if (joinedEbookId === ebookId && channel) return;
  await leaveEbookChannel();

  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return;

  // El websocket necesita el token para que RLS se aplique a los cambios que
  // recibes. Sin esto llegan cero eventos y no hay error en ningún sitio: el
  // canal simplemente se queda mudo.
  supabase.realtime.setAuth(session.access_token);

  me = {
    userId: session.user.id,
    name:
      (session.user.user_metadata?.display_name as string | undefined) ??
      session.user.email?.split("@")[0] ??
      "alguien",
  };

  joinedEbookId = ebookId;

  channel = supabase
    .channel(`ebook:${ebookId}`, {
      config: { presence: { key: session.user.id } },
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chapters",
        filter: `ebook_id=eq.${ebookId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          // En los DELETE solo llega la clave primaria, aun con REPLICA
          // IDENTITY FULL: Supabase no puede aplicar RLS sobre una fila ya
          // borrada, así que no manda el resto. El id basta para quitarlo.
          const removed = payload.old as Partial<Chapter>;
          if (removed?.id) handlers.onChapterDelete(removed.id);
          return;
        }
        handlers.onChapterUpsert(payload.new as Chapter);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "ebooks",
        filter: `id=eq.${ebookId}`,
      },
      (payload) => {
        handlers.onEbookUpdate(payload.new as Ebook);
      },
    )
    .on("presence", { event: "sync" }, () => {
      if (!channel) return;
      const state = channel.presenceState<Peer>();

      // Una misma persona puede tener dos pestañas abiertas; se colapsa por
      // usuario y gana la fase más "ocupada", que es la que importa.
      const byUser = new Map<string, Peer>();
      for (const entries of Object.values(state)) {
        for (const entry of entries) {
          const existing = byUser.get(entry.userId);
          if (!existing || rank(entry.phase) > rank(existing.phase)) {
            byUser.set(entry.userId, entry);
          }
        }
      }

      handlers.onPeersChange(
        [...byUser.values()].filter((peer) => peer.userId !== me?.userId),
      );
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED" && me) {
        await channel?.track({ ...me, phase: myPhase } satisfies Peer);
      }
    });
}

function rank(phase: Peer["phase"]): number {
  return { idle: 0, error: 1, thinking: 2, working: 3 }[phase];
}

/** Publica tu fase para que los demás sepan si pueden escribir. */
export function publishPhase(phase: Peer["phase"]): void {
  myPhase = phase;
  if (!channel || !me) return;
  void channel.track({ ...me, phase } satisfies Peer);
}

export async function leaveEbookChannel(): Promise<void> {
  if (!channel) return;
  const supabase = createClient();
  await supabase.removeChannel(channel);
  channel = null;
  joinedEbookId = null;
  me = null;
  myPhase = "idle";
}
