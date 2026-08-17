export type EbookStatus = "draft" | "writing" | "ready";

export type Ebook = {
  id: string;
  owner_id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  language: string;
  description: string | null;
  /** Ruta dentro del bucket `images`, no una URL: las firmadas caducan. */
  cover_path: string | null;
  /**
   * Dirección de arte común a todas las imágenes. El servidor la antepone a
   * cada prompt, así la coherencia no depende de que el agente se acuerde.
   */
  image_style: string | null;
  status: EbookStatus;
  created_at: string;
  updated_at: string;
};

export type Chapter = {
  id: string;
  ebook_id: string;
  position: number;
  title: string;
  /** Markdown. Es el formato fuente del que salen el preview, el PDF y el EPUB. */
  content: string;
  created_at: string;
  updated_at: string;
};

/** Palabras de un markdown, descontando la sintaxis. Lo que cuenta un autor. */
export function countWords(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ") // bloques de código
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // enlaces e imágenes
    .replace(/[#*_>~|-]/g, " ");

  const words = plain.match(/\p{L}[\p{L}\p{M}'’-]*/gu);
  return words ? words.length : 0;
}

/**
 * Minutos de lectura. 200 palabras/minuto es la media habitual para prosa
 * en castellano e inglés.
 */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200));
}
