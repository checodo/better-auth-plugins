import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // `/docs/blocklist.md` serves the Markdown of `/docs/blocklist`.
      { source: "/docs.md", destination: "/llms.mdx/docs/content.md" },
      { source: "/docs/:path*.md", destination: "/llms.mdx/docs/:path*/content.md" },
    ];
  },
};

export default withMDX(config);
