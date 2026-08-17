import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Chapter, Ebook } from "@/lib/ebook/types";

/**
 * Exporta el ebook a un repositorio de GitHub: un `.md` por capítulo más un
 * README con el índice.
 *
 * Se sube con la API de Git (blobs → tree → commit), no fichero a fichero con la
 * API de contenidos: así el libro entero entra en UN commit en vez de en veinte,
 * y el historial del repo cuenta la evolución del libro, no la del exportador.
 */

const GITHUB_API = "https://api.github.com";

type ExportBody = { ebookId?: string };

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ebook"
  );
}

async function github(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

export async function POST(request: Request) {
  const { ebookId } = (await request.json()) as ExportBody;
  if (!ebookId) {
    return Response.json({ error: "Falta ebookId" }, { status: 400 });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      {
        error:
          "GitHub no está configurado. Añade GITHUB_CLIENT_ID y GITHUB_CLIENT_SECRET a .env.local.",
      },
      { status: 500 },
    );
  }

  const token = (await cookies()).get("gh_token")?.value;
  if (!token) {
    // Sin token todavía: se devuelve la URL de autorización para que el cliente
    // redirija. `state` trae la ruta de vuelta al libro.
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("scope", "repo");
    authorizeUrl.searchParams.set("state", `/ebook/${ebookId}`);

    return Response.json(
      { error: "Sin autorizar", authorizeUrl: authorizeUrl.toString() },
      { status: 401 },
    );
  }

  // El contenido se lee con la sesión del usuario, así que RLS decide si puede
  // exportarlo. Nunca se confía en el ebookId que manda el cliente.
  const supabase = await createClient();

  const [{ data: ebookRow, error: ebookError }, { data: chapterRows }] =
    await Promise.all([
      supabase.from("ebooks").select("*").eq("id", ebookId).single(),
      supabase
        .from("chapters")
        .select("*")
        .eq("ebook_id", ebookId)
        .order("position"),
    ]);

  if (ebookError || !ebookRow) {
    return Response.json(
      { error: "No se encontró el libro o no tienes acceso." },
      { status: 404 },
    );
  }

  const ebook = ebookRow as Ebook;
  const chapters = (chapterRows ?? []) as Chapter[];

  try {
    const userResponse = await github(token, "/user");
    if (!userResponse.ok) {
      return Response.json(
        { error: "El token de GitHub ya no es válido. Vuelve a autorizar." },
        { status: 401 },
      );
    }
    const { login } = await userResponse.json();

    const repoName = slugify(ebook.title);

    // Crear el repo si no existe; si ya existe, se reutiliza y el export queda
    // como un commit más encima.
    const existing = await github(token, `/repos/${login}/${repoName}`);
    if (existing.status === 404) {
      const created = await github(token, "/user/repos", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          description: ebook.description?.slice(0, 300) ?? ebook.title,
          private: true,
          auto_init: true,
        }),
      });
      if (!created.ok) {
        const detail = await created.json();
        throw new Error(detail.message ?? "No se pudo crear el repositorio");
      }
      // auto_init tarda un instante en dejar la rama utilizable.
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } else if (!existing.ok) {
      throw new Error("No se pudo comprobar si el repositorio existe");
    }

    const files = buildFiles(ebook, chapters);

    const repoResponse = await github(token, `/repos/${login}/${repoName}`);
    const { default_branch: branch } = await repoResponse.json();

    const refResponse = await github(
      token,
      `/repos/${login}/${repoName}/git/ref/heads/${branch}`,
    );
    const ref = await refResponse.json();
    const baseCommitSha: string | undefined = ref.object?.sha;

    // 1. Un blob por fichero.
    const blobs = await Promise.all(
      files.map(async ({ path, content }) => {
        const response = await github(
          token,
          `/repos/${login}/${repoName}/git/blobs`,
          {
            method: "POST",
            body: JSON.stringify({ content, encoding: "utf-8" }),
          },
        );
        const blob = await response.json();
        if (!blob.sha) throw new Error(blob.message ?? "Fallo creando un blob");
        return { path, sha: blob.sha as string };
      }),
    );

    // 2. Un árbol que los referencia.
    const treeResponse = await github(
      token,
      `/repos/${login}/${repoName}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseCommitSha
            ? (await (
                await github(
                  token,
                  `/repos/${login}/${repoName}/git/commits/${baseCommitSha}`,
                )
              ).json()
              ).tree.sha
            : undefined,
          tree: blobs.map(({ path, sha }) => ({
            path,
            mode: "100644",
            type: "blob",
            sha,
          })),
        }),
      },
    );
    const tree = await treeResponse.json();
    if (!tree.sha) throw new Error(tree.message ?? "Fallo creando el árbol");

    // 3. El commit.
    const written = chapters.filter((chapter) => chapter.content.trim()).length;
    const commitResponse = await github(
      token,
      `/repos/${login}/${repoName}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: `Nébula: ${ebook.title} — ${written} de ${chapters.length} capítulos`,
          tree: tree.sha,
          parents: baseCommitSha ? [baseCommitSha] : [],
        }),
      },
    );
    const commit = await commitResponse.json();
    if (!commit.sha) throw new Error(commit.message ?? "Fallo creando el commit");

    // 4. Mover la rama.
    await github(token, `/repos/${login}/${repoName}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return Response.json({
      url: `https://github.com/${login}/${repoName}`,
      repo: repoName,
      files: files.length,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Error exportando a GitHub",
      },
      { status: 500 },
    );
  }
}

/** Un `.md` por capítulo, numerado para que ordene bien, más un README índice. */
function buildFiles(
  ebook: Ebook,
  chapters: Chapter[],
): { path: string; content: string }[] {
  const files = chapters.map((chapter) => ({
    path: `capitulos/${String(chapter.position).padStart(2, "0")}-${slugify(chapter.title)}.md`,
    content: `# ${chapter.title}\n\n${chapter.content}\n`,
  }));

  const index = chapters
    .map(
      (chapter) =>
        `${chapter.position}. [${chapter.title}](capitulos/${String(chapter.position).padStart(2, "0")}-${slugify(chapter.title)}.md)`,
    )
    .join("\n");

  files.push({
    path: "README.md",
    content: [
      `# ${ebook.title}`,
      ebook.subtitle ? `\n*${ebook.subtitle}*` : "",
      ebook.author ? `\n**${ebook.author}**` : "",
      ebook.description ? `\n${ebook.description}` : "",
      `\n## Índice\n\n${index || "_Sin capítulos todavía._"}`,
      `\n---\n\nGenerado con Nébula.`,
    ].join("\n"),
  });

  return files;
}
