"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Chapter, Ebook } from "@/lib/ebook/types";
import type { ChatMessage } from "./types";

export type AgentPhase = "idle" | "thinking" | "working" | "error";

export type StreamState = {
  text: string;
  thinking: string;
  activeTools: string[];
};

type EbookStore = {
  ebook: Ebook | null;
  chapters: Chapter[];
  messages: ChatMessage[];
  phase: AgentPhase;
  error: string | null;
  stream: StreamState;
  /** Capítulos que el agente ha tocado en este turno; se resaltan en la lista. */
  touched: string[];
  selectedChapterId: string | null;
  hydrated: boolean;

  load: (ebookId: string) => Promise<void>;
  setSelectedChapter: (id: string | null) => void;

  applyEbookPatch: (patch: Partial<Ebook>) => Promise<void>;
  upsertChapter: (chapter: Chapter) => void;
  removeChapter: (id: string) => void;
  replaceChapters: (chapters: Chapter[]) => void;

  appendMessage: (message: ChatMessage) => Promise<void>;
  setPhase: (phase: AgentPhase) => void;
  setError: (error: string | null) => void;
  patchStream: (patch: Partial<StreamState>) => void;
  resetStream: () => void;
  beginTurn: () => void;
};

const EMPTY_STREAM: StreamState = { text: "", thinking: "", activeTools: [] };

export const useEbook = create<EbookStore>((set, get) => ({
  ebook: null,
  chapters: [],
  messages: [],
  phase: "idle",
  error: null,
  stream: EMPTY_STREAM,
  touched: [],
  selectedChapterId: null,
  hydrated: false,

  async load(ebookId) {
    const supabase = createClient();

    const [ebookResult, chaptersResult, messagesResult] = await Promise.all([
      supabase.from("ebooks").select("*").eq("id", ebookId).single(),
      supabase
        .from("chapters")
        .select("*")
        .eq("ebook_id", ebookId)
        .order("position"),
      supabase
        .from("messages")
        .select("*")
        .eq("ebook_id", ebookId)
        .order("created_at"),
    ]);

    if (ebookResult.error) {
      set({ error: ebookResult.error.message, phase: "error", hydrated: true });
      return;
    }

    const chapters = (chaptersResult.data ?? []) as Chapter[];

    set({
      ebook: ebookResult.data as Ebook,
      chapters,
      messages: (messagesResult.data ?? []).map((row) => ({
        role: row.role,
        content: row.content,
      })) as ChatMessage[],
      selectedChapterId: chapters[0]?.id ?? null,
      hydrated: true,
      error: null,
    });
  },

  setSelectedChapter(id) {
    set({ selectedChapterId: id });
  },

  async applyEbookPatch(patch) {
    const { ebook } = get();
    if (!ebook) return;

    // Optimista: la UI reacciona ya y Postgres confirma después. Un fallo de red
    // deja la vista adelantada, pero el agente relee el estado en cada turno.
    set({ ebook: { ...ebook, ...patch } });

    const supabase = createClient();
    await supabase.from("ebooks").update(patch).eq("id", ebook.id);
  },

  upsertChapter(chapter) {
    set((prior) => {
      const existing = prior.chapters.findIndex((c) => c.id === chapter.id);
      const chapters =
        existing === -1
          ? [...prior.chapters, chapter]
          : prior.chapters.map((c) => (c.id === chapter.id ? chapter : c));

      return {
        chapters: chapters.sort((a, b) => a.position - b.position),
        touched: prior.touched.includes(chapter.id)
          ? prior.touched
          : [...prior.touched, chapter.id],
      };
    });
  },

  removeChapter(id) {
    set((prior) => ({
      chapters: prior.chapters.filter((chapter) => chapter.id !== id),
      selectedChapterId:
        prior.selectedChapterId === id ? null : prior.selectedChapterId,
    }));
  },

  replaceChapters(chapters) {
    set({
      chapters: [...chapters].sort((a, b) => a.position - b.position),
      touched: chapters.map((chapter) => chapter.id),
    });
  },

  async appendMessage(message) {
    const { ebook } = get();
    set((prior) => ({ messages: [...prior.messages, message] }));
    if (!ebook) return;

    const supabase = createClient();
    await supabase.from("messages").insert({
      ebook_id: ebook.id,
      role: message.role,
      content: message.content,
    });
  },

  setPhase(phase) {
    set({ phase });
  },

  setError(error) {
    set({ error, phase: error ? "error" : "idle" });
  },

  patchStream(patch) {
    set((prior) => ({ stream: { ...prior.stream, ...patch } }));
  },

  resetStream() {
    set({ stream: EMPTY_STREAM });
  },

  beginTurn() {
    set({ stream: EMPTY_STREAM, touched: [], error: null, phase: "thinking" });
  },
}));
