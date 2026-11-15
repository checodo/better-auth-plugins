import { notFound } from "next/navigation";
import { renderOgImage } from "@/lib/og";
import { source } from "@/lib/source";

export const revalidate = false;

/** The social preview image of a docs page, at `/og/docs/<slug>/image.png`. */
export async function GET(_request: Request, context: RouteContext<"/og/docs/[[...slug]]">) {
  const { slug = [] } = await context.params;
  if (slug.at(-1) !== "image.png") notFound();
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return renderOgImage({ title: page.data.title, description: page.data.description });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: [...page.slugs, "image.png"] }));
}
