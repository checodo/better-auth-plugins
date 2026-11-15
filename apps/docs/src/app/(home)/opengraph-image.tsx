import { ogImageSize, renderOgImage } from "@/lib/og";

/** The home page's social preview image (docs pages have their own, see `app/og`). */
export const alt = "better-auth-plugins: community plugins for better-auth";
export const size = ogImageSize;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage({
    // Short enough for one line: a longer title wraps at the hyphen in "better-auth".
    title: "Plugins for better-auth",
    description:
      "Small, typed plugins that install and behave like the ones that ship with better-auth.",
  });
}
