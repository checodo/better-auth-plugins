/** The brand's accent color, used for the plugged-in square of the mark. */
export const BRAND_LIME = "#A5F000";

/**
 * The logo mark: three staggered squares and a lime one being "plugged in".
 * The dark squares use `currentColor`, so the mark follows the theme.
 * Keep in sync with `app/icon.svg`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 252 252" className={className} aria-hidden="true">
      <rect x="0" y="0" width="84" height="84" fill="currentColor" />
      <rect x="84" y="84" width="84" height="84" fill="currentColor" />
      <rect x="0" y="168" width="84" height="84" fill="currentColor" />
      <rect x="168" y="0" width="84" height="84" fill={BRAND_LIME} />
    </svg>
  );
}

/** The mark next to the name in Geist, for the navigation bar. */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
      <LogoMark className="size-5" />
      better-auth-plugins
    </span>
  );
}
