import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { docsContentRoute } from "@/lib/shared";

const { rewrite: rewriteToMarkdown } = rewritePath(
  "/docs{/*path}",
  `${docsContentRoute}{/*path}/content.md`,
);

/**
 * Serves a docs page as Markdown to clients that prefer it (AI agents
 * sending `Accept: text/markdown`), at the page's own URL.
 */
export default function proxy(request: NextRequest) {
  if (isMarkdownPreferred(request)) {
    const target = rewriteToMarkdown(request.nextUrl.pathname);
    if (target) {
      return NextResponse.rewrite(new URL(target, request.nextUrl), {
        // The same URL has two representations; keep caches apart.
        headers: { Vary: "Accept" },
      });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/docs", "/docs/:path*"],
};
