import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No framing by other sites (clickjacking).
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // `/docs/blocklist.md` serves the Markdown of `/docs/blocklist`.
      { source: "/docs.md", destination: "/llms.mdx/docs/content.md" },
      { source: "/docs/:path*.md", destination: "/llms.mdx/docs/:path*/content.md" },
    ];
  },
};

export default withMDX(config);
