import { docsLlms } from "@/lib/source";

export const revalidate = false;

/** An index of every docs page, https://llmstxt.org */
export async function GET() {
  return new Response(await docsLlms.index(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
