/** Trims and lowercases an email, the way better-auth stores user emails. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lowercases a domain and drops a leading `@` and trailing dot. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

/** Whether `email` (normalized) is one of `emails`, or on one of `domains` or their subdomains. */
export function isAllowedEmail(
  email: string,
  allow: { allowEmails: Set<string>; allowDomains: readonly string[] },
): boolean {
  if (allow.allowEmails.has(email)) return true;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1);
  return allow.allowDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}
