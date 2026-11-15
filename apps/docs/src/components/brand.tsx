import { BRAND_LIME, LogoMark } from "@/components/logo";

const surfaces = [
  { name: "On light", background: "#FAFAFA", ink: "#171719", file: "/brand/logo-mark.svg" },
  { name: "On dark", background: "#0A0A0A", ink: "#FAFAFA", file: "/brand/logo-mark-inverted.svg" },
];

/** The mark on a light and a dark surface, each with a download link. */
export function LogoPreview() {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2">
      {surfaces.map((surface) => (
        <figure key={surface.name} className="overflow-hidden rounded-xl border border-fd-border">
          <div
            className="flex h-44 items-center justify-center"
            style={{ background: surface.background, color: surface.ink }}
          >
            <LogoMark className="size-20" />
          </div>
          <figcaption className="flex items-center justify-between border-t border-fd-border bg-fd-card px-4 py-2 text-sm">
            <span>{surface.name}</span>
            <a href={surface.file} download className="font-medium underline">
              Download SVG
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

const fullLogos = [
  { name: "On light", background: "#FAFAFA", file: "/brand/logo.svg" },
  { name: "On dark", background: "#0A0A0A", file: "/brand/logo-inverted.svg" },
];

/** The full logo (mark and outlined wordmark) with download links. */
export function FullLogoPreview() {
  return (
    <div className="not-prose grid gap-4">
      {fullLogos.map((logo) => (
        <figure key={logo.name} className="overflow-hidden rounded-xl border border-fd-border">
          <div
            className="flex h-36 items-center justify-center px-6"
            style={{ background: logo.background }}
          >
            {/* biome-ignore lint/performance/noImgElement: a static SVG shown as is */}
            <img src={logo.file} alt="better-auth-plugins" className="h-14 w-auto max-w-full" />
          </div>
          <figcaption className="flex items-center justify-between border-t border-fd-border bg-fd-card px-4 py-2 text-sm">
            <span>{logo.name}</span>
            <a href={logo.file} download className="font-medium underline">
              Download SVG
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** The mark next to the name, as it appears in the navigation. */
export function LockupPreview() {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2">
      {surfaces.map((surface) => (
        <div
          key={surface.name}
          className="flex h-28 items-center justify-center gap-3 rounded-xl border border-fd-border text-2xl font-semibold tracking-tight"
          style={{ background: surface.background, color: surface.ink }}
        >
          <LogoMark className="size-8" />
          better-auth-plugins
        </div>
      ))}
    </div>
  );
}

const colors = [
  { name: "Ink", hex: "#171719", use: "The mark and text on light backgrounds" },
  { name: "Lime", hex: BRAND_LIME, use: "The accent square. Never for text" },
  { name: "Paper", hex: "#FAFAFA", use: "Backgrounds, and the mark on dark backgrounds" },
];

/** The brand colors as swatches. */
export function ColorSwatches() {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-3">
      {colors.map((color) => (
        <div key={color.name} className="overflow-hidden rounded-xl border border-fd-border">
          <div className="h-20 border-b border-fd-border" style={{ background: color.hex }} />
          <div className="bg-fd-card px-4 py-3 text-sm">
            <div className="flex items-center justify-between font-medium">
              <span>{color.name}</span>
              <code className="font-mono text-xs">{color.hex}</code>
            </div>
            <p className="mt-1 text-fd-muted-foreground">{color.use}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
