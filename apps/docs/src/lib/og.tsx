import { ImageResponse } from "next/og";
import { BRAND_LIME } from "@/components/logo";

const INK = "#0A0A0A";
const PAPER = "#FAFAFA";

/** The size of every social preview image. */
export const ogImageSize = { width: 1200, height: 630 };

/** A social preview image: the logo, a lime bar, a title, and an optional description. */
export function renderOgImage({ title, description }: { title: string; description?: string }) {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 80,
        background: INK,
        color: PAPER,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 32 }}>
        <svg viewBox="0 0 252 252" width="48" height="48" aria-hidden="true">
          <rect x="0" y="0" width="84" height="84" fill={PAPER} />
          <rect x="84" y="84" width="84" height="84" fill={PAPER} />
          <rect x="0" y="168" width="84" height="84" fill={PAPER} />
          <rect x="168" y="0" width="84" height="84" fill={BRAND_LIME} />
        </svg>
        better-auth-plugins
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", width: 72, height: 8, background: BRAND_LIME }} />
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>
          {title}
        </div>
        {description ? (
          <div style={{ display: "flex", fontSize: 32, color: "#A3A3A3", lineHeight: 1.4 }}>
            {description}
          </div>
        ) : null}
      </div>
    </div>,
    ogImageSize,
  );
}
