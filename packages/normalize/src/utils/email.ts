/** How a provider treats the local part (before the `@`). */
interface ProviderRule {
  /** Everything from this character on is a tag the provider ignores. */
  tag: string;
  /** The provider ignores dots (Gmail). */
  ignoresDots?: boolean;
  /** Another domain of the same mailbox, e.g. `googlemail.com` for `gmail.com`. */
  sameAs?: string;
}

const PLUS: ProviderRule = { tag: "+" };

/**
 * Providers whose subaddressing is documented, so two forms are known to
 * reach the same inbox. Yahoo's `-keyword` addresses are left out: a
 * hyphen can be part of a real name, and merging two people is worse
 * than missing an alias.
 */
export const KNOWN_PROVIDERS: Readonly<Record<string, ProviderRule>> = {
  "gmail.com": { tag: "+", ignoresDots: true },
  "googlemail.com": { tag: "+", ignoresDots: true, sameAs: "gmail.com" },
  "outlook.com": PLUS,
  "hotmail.com": PLUS,
  "live.com": PLUS,
  "msn.com": PLUS,
  "icloud.com": PLUS,
  "me.com": PLUS,
  "mac.com": PLUS,
  "proton.me": PLUS,
  "protonmail.com": PLUS,
  "pm.me": PLUS,
  "fastmail.com": PLUS,
  "fastmail.fm": PLUS,
};

export type Subaddressing = "known" | "all";

/**
 * The address an email reaches, for comparing accounts: trimmed and
 * lowercased, a trailing dot of the domain removed, and the tags (and,
 * at Gmail, the dots) that the provider ignores removed. With
 * `subaddressing: "all"`, a `+tag` is removed at every domain.
 * `null` for something that isn't an address.
 */
export function normalizeEmailAddress(
  email: string,
  subaddressing: Subaddressing = "known",
): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  while (domain.endsWith(".")) domain = domain.slice(0, -1);
  if (!domain) return null;

  const rule = KNOWN_PROVIDERS[domain] ?? (subaddressing === "all" ? PLUS : undefined);
  if (rule) {
    const tagAt = local.indexOf(rule.tag);
    // `+tag@gmail.com` has nothing before the tag: keep it as it is.
    if (tagAt > 0) local = local.slice(0, tagAt);
    if (rule.ignoresDots) local = local.replaceAll(".", "") || local;
    domain = rule.sameAs ?? domain;
  }
  return `${local}@${domain}`;
}
