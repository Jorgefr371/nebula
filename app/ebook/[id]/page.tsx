import { Workspace } from "@/components/workspace";

// `params` es una Promise desde Next.js 16: el acceso síncrono se eliminó.
export default async function EbookPage({ params }: PageProps<"/ebook/[id]">) {
  const { id } = await params;
  return <Workspace ebookId={id} />;
}
