import { llms, loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { getMarkdownComponents } from "@/components/markdown";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      // Keeps MDX components as components in the Markdown output, so
      // `getMarkdownComponents()` can render them as Markdown (callouts,
      // option tables) instead of JSX.
      includeProcessedMarkdown: { output: "function" },
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

/** The docs as Markdown for LLMs and AI agents, see https://fumadocs.dev/docs/integrations/llms */
export const docsLlms = llms(source, {
  renderPage: async (page) => {
    const body = await page.data.getText("processed", { components: getMarkdownComponents() });
    const description = page.data.description ? `\n\n${page.data.description}` : "";
    return `# ${page.data.title} (${page.url})${description}\n\n${body}`;
  },
});
