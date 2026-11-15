import { notFound } from "next/navigation";
import { getPageMarkdownUrl } from "@/lib/shared";
import { docsLlms, source } from "@/lib/source";

export const revalidate = false;

/** The Markdown of one docs page, at `/llms.mdx/docs/<slug>/content.md` (and `/docs/<slug>.md`). */
export async function GET(_request: Request, context: RouteContext<"/llms.mdx/docs/[[...slug]]">) {
  const { slug = [] } = await context.params;
  if (slug.at(-1) !== "content.md") notFound();
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return new Response(await docsLlms.page(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: getPageMarkdownUrl(page).segments }));
}
