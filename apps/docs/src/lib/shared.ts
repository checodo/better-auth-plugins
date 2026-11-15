import { createGetUrl } from "fumadocs-core/source";

/** Where the Markdown of each docs page is served (see `app/llms.mdx`). */
export const docsContentRoute = "/llms.mdx/docs";

const getContentUrl = createGetUrl(docsContentRoute);

/** The route segments and URL of a page's Markdown: `/llms.mdx/docs/<slug>/content.md`. */
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string | undefined }) {
  const segments = [...page.slugs, "content.md"];
  return { segments, url: getContentUrl(segments, page.locale) };
}
