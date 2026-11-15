import { docsLlms } from "@/lib/source";

export const revalidate = false;

/** Every docs page as Markdown, in one file. */
export async function GET() {
  return new Response(await docsLlms.full(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
